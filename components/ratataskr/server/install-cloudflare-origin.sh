#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
base=$(dirname -- "$(readlink -f -- "$0")")
php -l "$base/user-entry.php"
install -o root -g root -m 0644 "$base/user-entry.php" /opt/ratataskr-snappymail/user-entry.php
site=/etc/nginx/sites-available/ratataskr-cloudflare
link=/etc/nginx/sites-enabled/ratataskr-cloudflare
[[ ! -e $site && ! -e $link ]] || { echo 'Origin configuration already exists; inspect before replacing.' >&2; exit 1; }
install -o root -g root -m 0644 "$base/nginx-cloudflare.conf" "$site"
ln -s "$site" "$link"
if ! nginx -t; then rm -- "$link" "$site"; exit 1; fi
systemctl reload nginx
for path in '/?admin' '/?admin/0/Json/' '/?q=/AdminAppData' '/data/' '/include.php'; do
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:8089$path")
  [[ $status == 403 || $status == 404 ]] || { echo "Protection failed: $path ($status)" >&2; rm -- "$link"; systemctl reload nginx; exit 1; }
done
[[ $(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8089/) == 200 ]]
echo 'Separate localhost:8089 origin verified. Tailscale origin unchanged. No tunnel or public DNS activated.'
