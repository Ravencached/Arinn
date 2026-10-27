# Arinn 0.1.0 experimental: publication review

Prepared 2026-10-27 for `Ravencached/Arinn`. This is a source release candidate.
The initial source was approved and pushed on 2026-10-27. It has not been tagged
as a stable release. Hosted status is recorded by [GitHub Actions](https://github.com/Ravencached/Arinn/actions/workflows/ci.yml).

## Completed locally

| Area | Evidence |
|---|---|
| Branding and scope | Arinn README, experimental version/changelog, supported-versus-advanced paths and deployment limits |
| Licensing | Full texts, original-code/art/documentation scope, retained third-party notices and per-file map |
| Security reporting | Root `SECURITY.md`, private-report URL and explicit support boundaries; private reporting enabled on GitHub |
| Contribution guidance | Root `CONTRIBUTING.md`, pull-request template, license/provenance and synthetic-fixture requirements |
| Workflow | actionlint 1.7.12 passed; all three external actions pinned to resolved official v6 commits; read-only permissions and no persisted checkout credentials |
| Source regression checks | 14 tests passed, including deleted-secret detection, shallow-history rejection and deployment-role separation |
| Calendar | 33 tests, locked npm install and web build passed on Node 24.22.1 |
| Mail | Containerized PHP syntax; 49 account-tool, 6 folder, 9 security-boundary and 6 admin-policy checks passed; browser-source/theme checks passed |
| Container integration | Derived images built; independent roles, browser upload/download, account isolation, restart persistence and storage availability with home stopped passed |
| Private data | Current-source checks and complete reachable handoff history checked; local comparisons against known private identifiers/credential values reported no findings |
| Publication history | Clean Arinn checkout prepared with one initial commit, public GitHub noreply identity and no imported app/handoff history |

The workflow's application commands were exercised locally, including the actual
Linux containers. Hosted results are available in Actions; the Linux sandbox
initializes its new bind directory for the service UID and verifies its bytes
using a separate unprivileged reader. The privacy
rules and local known-value comparisons are useful evidence, not a guarantee
against every possible identifying detail or unknown secret format.

## Pending publication and GitHub settings

Owner approval was received and the source is public. Private vulnerability
reporting, secret scanning/push protection, dependency alerts, read-only workflow
permissions and approval for external fork workflows are enabled. Require the
three hosted checks on `main` and wait for success before tagging an experimental release.
See [publishing instructions](PUBLISHING.md) for the exact target and settings.

## Still deployment-specific

Physical two-host networking, real Purelymail IMAP/SMTP, operator-only gateway
rules, MFA enrollment, phone behavior and complete off-host restoration require
the actual receiving installation. CI does not certify those. The package is
not an automatic migration or a promise of exact parity with a live setup.
