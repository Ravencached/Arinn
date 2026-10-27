# Security policy

Arinn is experimental family self-hosting software. There is no supported stable
release or production-security certification. Fixes are considered against the
current `main` branch; older handoff ZIPs and development snapshots do not receive
promised backports. SnappyMail, SFTPGo, runtimes and operating systems have their
own support policies. Keep them updated independently.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/Ravencached/Arinn/security/advisories/new).
Private reporting is enabled for `Ravencached/Arinn`. Maintainers of forks must
enable it separately; the link alone does not enable it. If no private report form is available, open
an issue asking for a private contact method **without technical exploit details,
secrets, logs or affected personal data**. Do not disclose a vulnerability in a
public issue or pull request before coordinated review.

Include the affected commit/version, selected deployment role, minimal synthetic
reproduction, expected versus actual behavior, and likely impact. Remove tokens,
hostnames and personal records. Test only systems you own or have permission to
test. Do not send real mailbox contents or family files.

Reports are handled on a best-effort basis; no response-time SLA or bounty is
promised. Upstream-only problems should also follow that project's private
reporting policy. Avoid duplicate public disclosures while coordination proceeds.

## Deployment boundaries

- Use private HTTPS; keep admin interfaces operator-only.
- Separate user accounts and verify isolation on the actual receiving hosts.
- Host/Docker administrators are trusted and can access running app data.
- Full-history/source scans and CI are checks, not guarantees against all flaws.
- Live provider access, physical two-host routing, MFA enrollment and off-host
  restoration require deployment acceptance; see [validation](docs/VALIDATION.md).

The integration workflow uses synthetic accounts and disposable containers on a
hosted runner. It never needs production provider credentials. Do not add those
credentials to CI secrets or upload private sandbox diagnostics as artifacts.
