#!/usr/bin/env bash
# Run locally on mail-host. The key is read silently, never passed as an argument.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
[[ -f /etc/ratataskr-aliases/config.json ]] || { echo 'Install account tools first.' >&2; exit 1; }
umask 077
read -r -s -p 'Purelymail API key (hidden): ' provider_key </dev/tty
printf '\n' >/dev/tty
[[ -n $provider_key ]] || { echo 'No key entered.' >&2; exit 1; }
exec 9<>/var/lib/ratataskr-aliases/state.lock
flock -x 9
key_file=$(mktemp /etc/ratataskr-aliases/.api-key.XXXXXX)
key_backup=$(mktemp /etc/ratataskr-aliases/.api-key-backup.XXXXXX)
if [[ -f /etc/ratataskr-aliases/api-key ]]; then cp -p -- /etc/ratataskr-aliases/api-key "$key_backup"; else rm -f -- "$key_backup"; fi
trap 'rm -f -- "$key_file" "$key_backup"; unset provider_key' EXIT
printf '%s' "$provider_key" > "$key_file"
chown root:www-data "$key_file"
chmod 0640 "$key_file"
mv -f -- "$key_file" /etc/ratataskr-aliases/api-key
unset provider_key
if ! php -r 'require "/var/lib/ratataskr-snappymail/_data_/_default_/plugins/ratataskr-ui/AliasService.php"; try { $c=json_decode(file_get_contents("/etc/ratataskr-aliases/config.json"),true,32,JSON_THROW_ON_ERROR); $c["enabled"]=true; $s=new RatataskrAliasService($c,"/var/lib/ratataskr-aliases"); $r=$s->connectionCheck(); echo "Provider key verified for ".$r["domain"].PHP_EOL; if($r["symbolicSubaddressing"]) echo "Symbolic subaddressing is enabled. Review it in Purelymail before exact alias creation.".PHP_EOL; } catch(Throwable $e) { fwrite(STDERR,"Provider verification failed. Connection remains unchanged; inspect the key/domain in Purelymail.".PHP_EOL); exit(1); }'; then
  if [[ -f $key_backup ]]; then mv -f -- "$key_backup" /etc/ratataskr-aliases/api-key; else rm -f -- /etc/ratataskr-aliases/api-key; fi
  exit 1
fi
php -r '$p="/etc/ratataskr-aliases/config.json"; $c=json_decode(file_get_contents($p),true,32,JSON_THROW_ON_ERROR); $c["enabled"]=true; $t=tempnam(dirname($p),".config-"); file_put_contents($t,json_encode($c,JSON_PRETTY_PRINT|JSON_THROW_ON_ERROR)); chown($t,"root"); chgrp($t,"www-data"); chmod($t,0640); rename($t,$p);'
echo 'Key stored outside the website; provider connection enabled. No aliases or users were created.'
