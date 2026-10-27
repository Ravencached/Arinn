#!/usr/bin/env bash
# Read-only Debian 13 mail-host policy, reviewed 2026-10-26.
# Package floors are distribution revisions, including security backports.
set -euo pipefail
source /etc/os-release
[[ $ID == debian && ${VERSION_ID:-} == 13 ]] || {
  echo 'This automated mail-host policy targets Debian 13; review other distributions separately.' >&2; exit 1;
}
minimum() {
  local package=$1 floor=$2 installed
  installed=$(dpkg-query -W -f='${Version}' "$package" 2>/dev/null) || {
    echo "Missing required package: $package" >&2; return 1;
  }
  dpkg --compare-versions "$installed" ge "$floor" || {
    echo "Security update required: $package ($installed; minimum $floor)" >&2; return 1;
  }
  printf 'PASS package floor: %s %s\n' "$package" "$installed"
}
minimum ca-certificates '20250419+deb13u1'
minimum php8.4-common '8.4.27-1~deb13u1'
minimum php8.4-fpm '8.4.27-1~deb13u1'
minimum php8.4-cli '8.4.27-1~deb13u1'
minimum nginx '1.26.3-3+deb13u10'
minimum openssl '3.5.7-1~deb13u3'
# Inspect the effective default bundle as well: a local CA import can undo a
# distribution distrust update. This is not a scan of every application's store.
subjects=$(openssl crl2pkcs7 -nocrl -certfile /etc/ssl/certs/ca-certificates.crt |
  openssl pkcs7 -print_certs -noout)
if grep -Fiq 'emSign ECC Root CA - G3' <<<"$subjects"; then
  echo 'The distrusted emSign ECC G3 root remains in the system CA bundle.' >&2
  exit 1
fi
echo 'PASS known mail-host package floors and default CA bundle. Review custom stores and running processes separately.'
