#!/usr/bin/env bash
# Installs code/configuration only. Does not create provider users, aliases or filters.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ ${RATATASKR_ONBOARDING_ACCESS_VERIFIED:-0} == 1 ]] || {
  echo 'Invitation portal requires a verified Cloudflare Access tunnel for this origin.' >&2
  echo 'After verifying JWT audience enforcement, rerun with RATATASKR_ONBOARDING_ACCESS_VERIFIED=1.' >&2
  exit 1
}
script_path=$(readlink -f -- "$0")
base=$(cd -- "$(dirname -- "$script_path")/.." && pwd)
site=/etc/nginx/sites-available/ratataskr-cloudflare
[[ -f $site && -S /run/php/ratataskr-snappymail.sock ]] || { echo 'Expected mail origin is missing.' >&2; exit 1; }
grep -q 'listen 127.0.0.1:8089' "$site" || { echo 'Unexpected origin; review before installation.' >&2; exit 1; }
for file in "$base/plugins/ratataskr-ui/AliasService.php" "$base/plugins/ratataskr-ui/index.php" "$base/portal/account-setup.php"; do php -l "$file"; done
php "$base/tests/account-tools.php"
php "$base/tests/folder-response.php"
install -d -o root -g www-data -m 0750 /etc/ratataskr-aliases
install -d -o www-data -g www-data -m 0700 /var/lib/ratataskr-aliases
if [[ ! -e /var/lib/ratataskr-aliases/state.lock ]]; then install -o www-data -g www-data -m 0600 /dev/null /var/lib/ratataskr-aliases/state.lock; fi
if [[ ! -e /etc/ratataskr-aliases/config.json ]]; then
  install -o root -g www-data -m 0640 "$base/server/aliases-config.example.json" /etc/ratataskr-aliases/config.json
fi
"$base/server/install-ui.sh"
php -l "$base/server/user-entry.php"
install -o root -g root -m 0644 "$base/server/user-entry.php" /opt/ratataskr-snappymail/user-entry.php
for file in account-setup.php account-setup.css account-setup.js; do
  install -o root -g root -m 0644 "$base/portal/$file" "/opt/ratataskr-snappymail/$file"
done
install -o root -g root -m 0755 "$base/server/set-api-key.sh" /usr/local/sbin/ratataskr-set-api-key
# Preserve the actual origin configuration rather than replacing it wholesale.
stamp=$(date +%Y%m%d-%H%M%S)
backup="$site.before-accounts-$stamp"
cp -p -- "$site" "$backup"
python3 - "$site" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
text = text.replace('SCRIPT_FILENAME /opt/ratataskr-snappymail/index.php;', 'SCRIPT_FILENAME /opt/ratataskr-snappymail/user-entry.php;')
if 'location = /account-setup.php' not in text:
    marker = '    location ~ \\.php(?:/|$) { return 404; }'
    if text.count(marker) != 1:
        raise SystemExit('Unexpected nginx configuration; no changes made.')
    location = '''    # Ratataskr invitation form; Access JWT validation is enforced by the tunnel.
    location = /account-setup.php {
        client_max_body_size 8k;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME /opt/ratataskr-snappymail/account-setup.php;
        fastcgi_param HTTPS on;
        fastcgi_param SERVER_PORT 443;
        fastcgi_pass unix:/run/php/ratataskr-snappymail.sock;
        fastcgi_read_timeout 120s;
    }
'''
    text = text.replace(marker, location + marker)
if 'location = /app ' not in text:
    marker = '    location ~ \\.php(?:/|$) { return 404; }'
    if text.count(marker) != 1:
        raise SystemExit('Unexpected nginx configuration; no changes made.')
    text = text.replace(marker, '    location = /app { return 302 /$is_args$args; }\n    location = /app/ { return 302 /$is_args$args; }\n' + marker)
text = text.replace('location = /app { return 302 /$is_args$args; }', 'location = /app { absolute_redirect off; return 302 /$is_args$args; }')
text = text.replace('location = /app/ { return 302 /$is_args$args; }', 'location = /app/ { absolute_redirect off; return 302 /$is_args$args; }')
path.write_text(text)
PY
if ! nginx -t; then
  cp -p -- "$backup" "$site"
  echo 'Origin validation failed; its configuration was restored.' >&2
  exit 1
fi
systemctl reload nginx
echo 'Account tools installed. Refresh Mail, then open Settings > Aliases & folders.'
echo 'Enter the provider key locally with: sudo ratataskr-set-api-key'
echo 'Folder sorting remains disabled until original-recipient matching is verified.'
