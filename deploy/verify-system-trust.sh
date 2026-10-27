#!/bin/sh
# Read-only baseline for the suite's Debian 12/13 container bases, 2026-10-26.
set -eu
. /etc/os-release
test "$ID" = debian || { echo 'Review trust policy for this image distribution.' >&2; exit 1; }
case "$VERSION_ID" in
  12) ca_floor='20250419~deb12u2'; ssl_floor='3.0.22-1~deb12u2' ;;
  13) ca_floor='20250419+deb13u1'; ssl_floor='3.5.7-1~deb13u3' ;;
  *) echo 'Unsupported Debian container baseline; review security package floors.' >&2; exit 1 ;;
esac
for spec in "ca-certificates:$ca_floor" "openssl:$ssl_floor"; do
  package=${spec%%:*}; floor=${spec#*:}
  installed=$(dpkg-query -W -f='${Version}' "$package")
  dpkg --compare-versions "$installed" ge "$floor" || { echo "Update required: $package" >&2; exit 1; }
done
subjects=$(openssl crl2pkcs7 -nocrl -certfile /etc/ssl/certs/ca-certificates.crt | openssl pkcs7 -print_certs -noout)
if printf '%s\n' "$subjects" | grep -Fiq 'emSign ECC Root CA - G3'; then
  echo 'The distrusted emSign ECC G3 root remains in the system trust bundle.' >&2
  exit 1
fi
echo 'Known system-trust baseline satisfied; repeat advisory checks at deployment.'
