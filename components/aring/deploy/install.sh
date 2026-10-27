#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then echo 'Run as root after reviewing this installer.' >&2; exit 1; fi
if ! /usr/bin/node -e 'const [a,b,c]=process.versions.node.split(".").map(Number);if(a!==24||b<22||(b===22&&c<1))process.exit(1)' 2>/dev/null; then echo 'Install official Node.js 24.22.1 or newer patched 24.x at /usr/bin/node first.' >&2; exit 1; fi
base=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test -f "$base/dist/index.html"
# Installation fails instead of overwriting an existing Áring deployment.
test ! -e /opt/aring/current
test ! -e /etc/systemd/system/aring.service
if ! id aring >/dev/null 2>&1; then useradd --system --home-dir /var/lib/aring --shell /usr/sbin/nologin aring; fi
install -d -o root -g root -m 0755 /opt/aring /opt/aring/releases
install -d -o aring -g aring -m 0700 /var/lib/aring /var/backups/aring
install -d -o root -g aring -m 0750 /etc/aring
release=/opt/aring/releases/0.1.0
test ! -e "$release"
install -d -o root -g root -m 0755 "$release"
cp -R "$base/server" "$base/shared" "$base/dist" "$base/deploy" "$base/package.json" "$base/package-lock.json" "$release/"
cd "$release"
npm ci --omit=dev --ignore-scripts --no-fund
chown -R root:root "$release"
chmod 0755 "$release/deploy/backup.sh"
ln -s "$release" /opt/aring/current
install -m 0644 deploy/aring.service deploy/aring-backup.service deploy/aring-backup.timer /etc/systemd/system/
if [ ! -e /etc/aring/backup.key ]; then node server/backup.mjs keygen /etc/aring/backup.key; chown root:aring /etc/aring/backup.key; chmod 0640 /etc/aring/backup.key; fi
systemctl daemon-reload
systemctl enable --now aring.service aring-backup.timer
echo 'Áring installed on loopback. Provision accounts, verify backup/restore and configure a dedicated HTTPS origin before publishing.'
echo 'No Nginx, tunnel or DNS configuration was changed.'
