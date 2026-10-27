#!/usr/bin/env bash
# Install reviewed Ratataskr assets/plugin without enabling plugins or touching accounts.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
script_path=$(readlink -f -- "$0")
base=$(cd -- "$(dirname -- "$script_path")/.." && pwd)
theme=/opt/ratataskr-snappymail/themes/ratataskr
plugin=/var/lib/ratataskr-snappymail/_data_/_default_/plugins/ratataskr-ui
[[ -f $theme/styles.css && -d /var/lib/ratataskr-snappymail/_data_/_default_ ]] || exit 1
php -l "$base/plugins/ratataskr-ui/index.php"
stamp=$(date +%Y%m%d-%H%M%S)
cp -p "$theme/styles.css" "$theme/styles.css.before-$stamp"
if [[ -d $plugin ]]; then cp -a "$plugin" "$plugin.before-$stamp"; fi
install -d -o root -g root -m 0755 "$plugin"
for file in index.php ui.js ui.css compose-dock.js AliasService.php aliases.js RatataskrAliases.html; do
  install -o root -g root -m 0644 "$base/plugins/ratataskr-ui/$file" "$plugin/$file"
done
for file in logo-repaired.png knotwork-leaf-divider.png squirrel-reader.png squirrel-restful.png knotwork-divider-clean.svg runework.png; do
  install -o root -g root -m 0644 "$base/themes/ratataskr/images/$file" "$theme/images/$file"
done
install -o root -g root -m 0644 "$base/themes/ratataskr/styles.css" "$theme/styles.css.next"
mv -f "$theme/styles.css.next" "$theme/styles.css"
echo 'Installed. Enable Ratataskr UI in SnappyMail Admin > Plugins, then clear cache.'
echo 'Existing plugin/account settings were not modified.'
