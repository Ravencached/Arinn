#!/usr/bin/env bash
# Fresh isolated install only. Does not configure mail accounts, DNS or Tailscale.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo on the installed Debian system.' >&2; exit 1; }
source /etc/os-release
[[ $ID == debian && ${VERSION_ID:-} == 13 ]] || { echo 'This installer targets Debian 13.' >&2; exit 1; }
base=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
root=/opt/ratataskr-snappymail
data=/var/lib/ratataskr-snappymail
[[ ! -e $root && ! -e $data ]] || { echo 'Existing installation found; refusing to overwrite it.' >&2; exit 1; }
[[ ! -e /etc/nginx/sites-enabled/default ]] || { echo 'Review and disable the default Nginx site first; it can listen publicly.' >&2; exit 1; }
if command -v nginx >/dev/null; then
  echo 'Existing Nginx detected; review its sites manually rather than using fresh setup.' >&2
  exit 1
fi
# Prevent the Debian package from starting its public default site during install.
systemctl mask nginx.service
apt-get update
apt-get install -y nginx php8.4-fpm php8.4-cli php8.4-mbstring php8.4-xml php8.4-curl php8.4-zip php8.4-intl php8.4-gd php8.4-sqlite3 ca-certificates openssl curl
update-ca-certificates
bash "$base/server/security-baseline.sh"
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  unlink /etc/nginx/sites-enabled/default
fi
phpver=$(php -r 'echo PHP_MAJOR_VERSION,".",PHP_MINOR_VERSION;')
php -r 'if (PHP_VERSION_ID < 80400) {fwrite(STDERR,"Use a maintained PHP 8.4+ package with current distribution security updates.\n"); exit(1);}'
[[ -d /etc/php/$phpver/fpm/pool.d ]] || { echo 'PHP CLI/FPM version mismatch.' >&2; exit 1; }
php -r 'foreach (["mbstring","zlib","json","libxml","dom","openssl","sodium","fileinfo"] as $e) { if (!extension_loaded($e)) {fwrite(STDERR,"Missing extension: $e\n"); exit(1);} }'
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
curl --fail --location --proto '=https' --tlsv1.2 \
  https://github.com/the-djmaze/snappymail/releases/download/v2.38.2/snappymail-2.38.2.tar.gz \
  -o "$work/release.tar.gz"
# Pin of the artifact retrieved from upstream HTTPS, not a signature verification.
echo "71f1d8a9065cc9cf7ddd064f5c47cc7b255cb70e6a56713647fc73d4b79e33ec  $work/release.tar.gz" | sha256sum --check --status
mkdir "$work/extracted"
tar --extract --gzip --file "$work/release.tar.gz" --directory "$work/extracted" --no-same-owner
[[ -f $work/extracted/index.php && -d $work/extracted/snappymail/v/2.38.2 ]] || exit 1
install -d -m 0755 "$root"
cp -a "$work/extracted/." "$root/"
install -d -m 0755 "$root/themes"
cp -a "$base/themes/ratataskr" "$root/themes/"
printf '%s\n' '<?php' "define('APP_DATA_FOLDER_PATH', '/var/lib/ratataskr-snappymail/');" > "$root/include.php"
install -m 0644 "$base/server/user-entry.php" "$root/user-entry.php"
chown -R root:root "$root"
find "$root" -type d -exec chmod 0755 {} +
find "$root" -type f -exec chmod 0644 {} +
install -d -o www-data -g www-data -m 0700 "$data"
install -d -o www-data -g www-data -m 0700 "$data/php-sessions"
install -m 0644 "$base/server/php-pool.conf" "/etc/php/$phpver/fpm/pool.d/ratataskr.conf"
install -m 0644 "$base/server/nginx.conf" /etc/nginx/sites-available/ratataskr-snappymail
ln -s /etc/nginx/sites-available/ratataskr-snappymail /etc/nginx/sites-enabled/ratataskr-snappymail
"php-fpm$phpver" -t
nginx -t
systemctl unmask nginx.service
systemctl enable --now "php$phpver-fpm" nginx
systemctl reload "php$phpver-fpm" nginx
echo 'Origin prepared on 127.0.0.1:8088. Configure private HTTPS before logging in.'
