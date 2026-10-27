# Current deployment baseline

Reviewed 2026-10-26 for independent family installations. The controls here are
deployment requirements and code-level boundaries, not an attestation about a
host that has not been inspected. Repeat the upstream checks when installing.

## Certificate trust: eMudhra / emSign

The eMudhra incident concerns compromised intermediate CA keys, including
extremely small private scalar values. A client retaining the affected trust
paths can accept an attacker's forged certificate. Setting certificate and
hostname verification to true does not repair a compromised trust anchor.
This affects outbound IMAP/SMTP/HTTPS clients as well as browsers; choosing a
different certificate for one's own website alone does not repair client trust.

The Debian 13 mail-host policy requires `ca-certificates >= 20250419+deb13u1`.
It also inspects the effective default PEM bundle for the distrusted emSign ECC G3 root,
because local imports can undo package distrust. PHP-FPM's OpenSSL and cURL
defaults use `/etc/ssl/certs/ca-certificates.crt`. Domain/plugin overrides and
custom CA files require independent inspection. Update browser/OS stores and
restart long-lived processes after the applicable trust update.

Calendar and drive images now build from the pinned base manifests, update
distribution CA/OpenSSL packages and run `deploy/verify-system-trust.sh` before
the application is used. Node is configured to use the updated OpenSSL/system
bundle rather than its separate bundled-root snapshot. Rebuild images when
updating trust; changing a host CA file does not update an existing container.
`--use-system-ca` can add trust to bundled roots; it is not interchangeable
with replacing them via `--use-openssl-ca` in this Linux image policy.

Node's October 21 security release also includes an eMudhra CA update and TLS
hostname-validation fixes. Keep the selected Node runtime current independently
of the system bundle. The explicit system-bundle policy gives this deployment a
single auditable Linux trust source; it is not a claim that every emSign-named
certificate remaining in a patched Node bundle is compromised.

The derived images were built and started in disposable Linux Docker containers
for the two-role evaluation. Repeat the build on the receiving engine and inspect
its own network and trust configuration. Updating image OS packages does not patch a
statically linked Go/Node application binary; those need their own upstream
runtime/image updates. Base digests identify inputs, not a complete immutable
post-update output or proof that all dependencies are vulnerability-free.

Sources: [Mozilla incident](https://bugzilla.mozilla.org/show_bug.cgi?id=2083449),
[Debian distrust update](https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=1151413),
[Debian CA package status](https://security-tracker.debian.org/tracker/source-package/ca-certificates),
[Node CA options](https://nodejs.org/api/cli.html#--use-bundled-ca--use-openssl-ca).
See also [Node October security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

## Runtime package policy

`components/ratataskr/server/security-baseline.sh` is read-only and targets the
documented native Debian 13 mail host. The fresh installer and host verifier
call it; the Debian-based mail container also calls it during its build. It
fails if a known required update is missing:

| Package | Debian 13 minimum recorded for this review | Relevant review |
|---|---|---|
| ca-certificates | `20250419+deb13u1` | eMudhra/emSign distrust |
| php8.4-common, php8.4-fpm, php8.4-cli | `8.4.27-1~deb13u1` | PHP request-handling RCE fixes; also newer than the hostname-verification fix |
| nginx | `1.26.3-3+deb13u10` | Current Debian Nginx security backports |
| openssl | `3.5.7-1~deb13u3` | Current Debian OpenSSL security package baseline |

Package comparisons use Debian revisions and backports, not just the apparent
upstream version string. PHP CLI used for tests is not proof that FPM is patched;
the policy checks both packages. A PHP 8.4 major/minor check alone is insufficient.
Installation requires the current security repository and fails closed if its
packages do not meet policy. Existing installations require explicit package
updates, service restart and re-verification; this ZIP does not modify them.

The PHP request-handling issues CVE-2026-109618 and CVE-2026-109619 require runtime
patches, not just PHP settings. CVE-2026-91769 concerns SAN/CN hostname fallback
in PHP streams, directly relevant to IMAP/SMTP TLS. The selected PHP package
floor covers the published fixes. Native Nginx serves a loopback FastCGI origin;
HTTP/3, AIO and client-certificate TLS are not configured by these templates,
but the package baseline still follows current distribution security updates.

Sources: [PHP request handling](https://security-tracker.debian.org/tracker/CVE-2026-109618),
[second PHP issue](https://security-tracker.debian.org/tracker/CVE-2026-109619),
[PHP certificate hostname validation](https://security-tracker.debian.org/tracker/CVE-2026-91769),
[Nginx package status](https://security-tracker.debian.org/tracker/source-package/nginx),
[OpenSSL package status](https://security-tracker.debian.org/tracker/source-package/openssl).

## Administrator and onboarding boundaries

The optional port 8089 user origin executes `server/user-entry.php` as its
FastCGI entry point. It initializes SnappyMail in API mode, then disables the
administrator panel in the request's configuration before dispatch. The port
8088 private admin origin continues to use the upstream entry point. This
policy is independent of query-string formatting and configurable admin path
names. The Nginx query checks are an additional early rejection, not the sole
authorization boundary. Upstream core files remain unchanged.

Six fixture checks verify the override before dispatch, including alternate,
encoded and slash-based queries. An isolated checksum-verified SnappyMail 2.38.2
release was also exercised through its real PHP dispatcher: both the admin page
and slash-based admin JSON route returned 403, and a separate private-admin
request retained its enabled configuration. This is not a full Nginx/FPM/browser
deployment; verify proxy and cookie behavior after install.

Invitation onboarding remains optional and requires a separately verified
Access tunnel with exact JWT audience enforcement. Its installation switch
records an operator prerequisite; it does not itself validate a JWT or configure
Cloudflare. The email header is trusted only across that authenticated boundary.
Normal private SnappyMail/IMAP/SMTP access does not require the onboarding portal.

## Storage and recovery boundaries

Purelymail is the authoritative mailbox provider. That does not mean the local
webmail host never processes or caches mail. Treat the entire private SnappyMail
state, cache, sessions, temporary attachments and backups as mailbox-sensitive.
The custom account-provisioning registry does not persist submitted mailbox
passwords; SnappyMail still manages its own account/session state. A trusted
host administrator can access running application data.

Calendar server backups cannot include edits that have not synchronized. Drive
recovery copies do not survive loss of their host. Off-host encryption, key
custody, actual restoration and account-isolation checks remain receiving-host
acceptance work. A local passing test suite is evidence for the tested boundaries,
not a substitute for deployment acceptance.

## Scope of upstream checks

SnappyMail 2.38.2 is newer than its published 2.38.0 mXSS sanitizer fix. SFTPGo
2.7.6's release records fixes for stored WebClient XSS, source-copy permission
checks and share revocation. These are selected known-advisory/version checks,
not a comprehensive binary/SBOM assessment of every transitive dependency.

Sources: [SnappyMail advisory](https://github.com/the-djmaze/snappymail/security/advisories/GHSA-2rq7-79vp-ffxm),
[SFTPGo release](https://github.com/drakkan/sftpgo/releases/tag/v2.7.6).
