#!/usr/bin/env bash
# Read-only origin checks; no credentials and no mailbox operations.
set -euo pipefail
base=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
bash "$base/security-baseline.sh"
origin=http://127.0.0.1:8088
status=$(curl --silent --show-error -o /dev/null -w '%{http_code}' "$origin/")
[[ $status == 200 ]] || { echo "Login page returned $status" >&2; exit 1; }
for path in /data/ /include.php /snappymail/v/2.38.2/include.php /.git/config; do
  status=$(curl --silent --show-error -o /dev/null -w '%{http_code}' "$origin$path")
  [[ $status == 403 || $status == 404 ]] || { echo "Protected path $path returned $status" >&2; exit 1; }
done
listeners=$(ss -H -ltn 'sport = :8088' | awk '{print $4}')
[[ $listeners == '127.0.0.1:8088' ]] || { echo 'Unexpected origin listener; keep it loopback-only.' >&2; exit 1; }
[[ $(stat -c '%U:%G:%a' /var/lib/ratataskr-snappymail) == 'www-data:www-data:700' ]] || { echo 'Private application-data ownership/mode needs review.' >&2; exit 1; }
[[ $(stat -c '%U:%G:%a' /var/lib/ratataskr-snappymail/php-sessions) == 'www-data:www-data:700' ]] || { echo 'Private PHP session ownership/mode needs review.' >&2; exit 1; }
[[ -z $(find /opt/ratataskr-snappymail -xdev -type f -perm /022 -print -quit) ]] || { echo 'Application code must not be group/world writable.' >&2; exit 1; }
ss -ltnp 'sport = :8088'
echo 'Origin responds; protected URLs rejected. Check listener is 127.0.0.1 only.'
echo 'Private HTTPS, admin restrictions and mailbox checks remain separate.'
