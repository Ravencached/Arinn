#!/usr/bin/env bash
# Manual encrypted backup. Requires an independently stored GPG private key.
# Stops PHP-FPM briefly for a consistent application-data snapshot.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ $# == 3 ]] || { echo 'Usage: backup-debian.sh PUBLIC_KEY_FILE FINGERPRINT OUTPUT.gpg' >&2; exit 1; }
key_file=$(realpath -e -- "$1")
fingerprint=$2
output=$3
[[ $fingerprint =~ ^[A-Fa-f0-9]{40}$ || $fingerprint =~ ^[A-Fa-f0-9]{64}$ ]] || exit 1
[[ $output == /* && $output == *.gpg && ! -e $output ]] || { echo 'Use a new absolute .gpg output path.' >&2; exit 1; }
command -v gpg >/dev/null
phpver=${RATATASKR_PHP_VERSION:-$(php -r 'echo PHP_MAJOR_VERSION,".",PHP_MINOR_VERSION;')}
[[ $phpver =~ ^[0-9]+\.[0-9]+$ ]] || exit 1
umask 077
work=$(mktemp -d /tmp/ratataskr-backup.XXXXXX)
restart=false
cleanup() {
  if $restart; then systemctl start "php${phpver}-fpm"; fi
  rm -rf -- "$work"
}
trap cleanup EXIT
export GNUPGHOME="$work/keyring"
mkdir -m 0700 "$GNUPGHOME"
gpg --batch --quiet --import "$key_file"
gpg --batch --list-keys "$fingerprint" >/dev/null
systemctl is-active --quiet "php${phpver}-fpm"
restart=true
systemctl stop "php${phpver}-fpm"
extra_paths=()
for extra in etc/ratataskr-aliases var/lib/ratataskr-aliases etc/nginx/sites-available/ratataskr-cloudflare etc/ratataskr-tunnel.token; do
  if [[ -e /$extra ]]; then extra_paths+=("$extra"); fi
done
tar --acls --xattrs -C / -czf - \
  var/lib/ratataskr-snappymail opt/ratataskr-snappymail \
  etc/nginx/sites-available/ratataskr-snappymail \
  "etc/php/$phpver/fpm/pool.d/ratataskr.conf" \
  "${extra_paths[@]}" \
  | gpg --batch --yes --trust-model always --recipient "$fingerprint" \
      --encrypt --output "$work/backup.gpg"
systemctl start "php${phpver}-fpm"
restart=false
# Atomic no-clobber publication when output resides on the same filesystem
# is not assumed; noclobber refuses overwriting a preexisting destination.
(set -o noclobber; cat "$work/backup.gpg" > "$output")
chmod 0600 "$output"
sha256sum "$output"
echo 'Encrypted backup created. Copy off-device and perform a restore test.'
