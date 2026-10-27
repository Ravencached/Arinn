# Validation and reproducibility

For the Arinn publication candidate, see the additional 2026-10-27
[release-readiness record](RELEASE-READINESS.md). It records local workflow
validation and separates it from pending hosted GitHub checks.

Recorded 2026-10-26. Scope: the packaged Purelymail/SnappyMail integration,
Áring and YggDrive. Source/mock checks do not establish a receiving family's
provider connectivity or host acceptance.

| Check | Recorded result |
|---|---|
| SnappyMail custom PHP files | PHP syntax checks passed on PHP 8.4.27 CLI |
| Mail account/alias/invitation/filter logic | 49 mock-provider assertions passed; no live provider calls |
| Mail folder-response integration | 6 checks passed |
| User-origin administration override | 6 API-stub policy checks passed; upstream request initialization reviewed |
| Actual upstream admin dispatch | Verified SnappyMail 2.38.2 artifact: admin page and slash-based JSON route denied by user entry; separate private-admin policy unchanged |
| PHP certificate verification | Synthetic loopback TLS checks: trusted matching SAN accepted; matching CN with mismatching SAN rejected; untrusted issuer rejected on PHP 8.4.27/OpenSSL 3.0.22 |
| Mail security-boundary assertions | 9 passed: provider-response/status/size/depth rejection, no raw error disclosure, nonblocking lock contention and oversized-state rejection |
| Mail theme/artifact checks | Passed; local assets, expected loopback origin and six configured contrast pairs >= 4.5:1 |
| Mail host scripts | Bash syntax checks passed; no installer executed on the development host |
| Mail browser scripts | JavaScript syntax checks passed |
| Áring service/offline/calendar/backup/security | 33 tests passed; web build passed |
| Áring Android | 12 unit tests passed; debug compilation and lint passed |
| Drive manager quota/admin boundaries | 2 tests passed |
| SFTPGo integration | Account isolation, file operations/quotas, MFA/replay, logout, rate limits and client/admin separation passed |
| Windows drive invitations/recovery | Disposable native invitation, ownership, revocation and recovery/retention checks passed |
| Drive transfer | 1 MiB upload/download with matching SHA-256 |
| Generated drive configuration | Native SFTPGo fixture verified private initial admin setup and absent admin/API on client binding |
| Home/storage role configuration | 6 regression tests passed: component separation, explicit content path, URL rejection and preserved configuration |
| Role container integration | Actual derived mail/calendar/drive images built and started on Docker Desktop's Linux engine; read-only filesystems and loopback publications checked |
| Container mail boundary | Nginx/FPM serves user/admin pages on separate origins; user admin page/API denied; bootstrap file denied |
| Container calendar | Synthetic account login, Secure cookie, wrong-origin denial and account persistence after home stop/start passed |
| Storage role | Synthetic browser login with general API disabled; 1 MiB browser upload lands in storage bind directory and downloads unchanged; second account/guessed traversal do not disclose owner bytes |
| Independent role operation | Drive still serves bytes while home is stopped; storage restart preserves account/content |
| Source archive | Export/identifier checks and committed-content comparison repeated on the corrected archive |
| Source license coverage, 2026-10-27 | Explicit per-file map checked; full code/documentation/art license texts and retained Capacitor notices present; provenance confirmation recorded |

The PHP runtime was downloaded separately and checked against official release
metadata. It is not bundled or installed system-wide. Mail tests use mocks and
temporary state; they do not send mail, create provider users or modify real
aliases. Contrast calculations assess configured colors, not full rendered UI
accessibility. Áring checks used Node.js 24.22.1 and the recorded Android toolchain;
drive checks used SFTPGo 2.7.6 fixtures. Existing calendar/drive results remain
applicable to their unchanged source components.

## Reproduce mail checks

From `components/ratataskr`:

```sh
php tests/account-tools.php
php tests/folder-response.php
php tests/security-boundaries.php
node validate.mjs
find server -name '*.sh' -exec bash -n {} \;
```

Lint custom PHP with `php -l` and JavaScript with `node --check`. The Node validator
has no npm dependencies. Base production mail hosting uses Nginx/PHP-FPM.

For Áring, run `npm ci`, `npm test` and `npm run build` in its component directory.
At the root run `python -m unittest discover -s tests -v`,
`python scripts/review_export.py` and the selected Compose configuration check.
The optional drive fixture runners are documented in its component/install guide.

## Target-host acceptance

Native Debian installation, Nginx/PHP-FPM startup/configuration, rendered
SnappyMail login/session/theme/compose behavior, actual Purelymail TLS login,
IMAP/SMTP delivery, attachments, optional provider API/Sieve operations and an
encrypted off-host restore require the receiving installation. No live provider
credentials are supplied or used during source validation.

Production HTTPS/private-network routing across two physical computers,
physical-phone behavior, real-data recovery and native release signing remain
hardware-specific
acceptance work. Upstream PHP/SnappyMail/package security/support status must be
reviewed when installing. Recorded syntax/mock tests are not a comprehensive
audit of the upstream PHP client, OS packages or provider service.

Current certificate/runtime policy and its validation limits are documented in
[Security baseline](SECURITY-BASELINE.md). The actual role builds passed their
Debian package-floor/default CA checks. Repeat those checks on the receiving
host; the development host's native Debian installer was not executed.

## Reproduce the preliminary two-role evaluation

Follow [the quick start](TWO-HOST-QUICKSTART.md#5-disposable-evaluation). The Docker
runner creates unique projects and random available loopback ports, provisions
synthetic accounts, exercises actual HTTP/browser-cookie flows, and removes
only its own containers/networks/volumes. The production generator never enables
test bootstrap accounts. The sandbox's HTTP transport checks application
behavior; it does not certify an HTTPS gateway, Tailscale policy, MFA enrollment
or a physical storage host. Diagnostics and synthetic bind content stay in the
private test directory, outside the source archive.
