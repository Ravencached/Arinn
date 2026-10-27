# Security design for family installations

Each family runs its own instances, credentials and backups. A trusted operator
administers the host; family members receive private accounts with explicit
sharing grants. Default web origins/admin ports remain on loopback and are
reached through the chosen private HTTPS path.

The recommended role deployment separates home (mail/calendar) from storage
(drive). Only HTTPS addresses connect their user experience; there is no shared
database, credential store or remote filesystem. Each host's state and recovery
remain independent. Rootless mail workers run with read-only code, private PHP
state and bounded temporary storage. The family mail route disables upstream
administration before dispatch; a separate operator-only origin provides it.

## Mail

SnappyMail authenticates separate mailbox users to Purelymail. IMAP/SMTP and
optional ManageSieve require explicit TLS with certificate/hostname verification.
Use provider app passwords when two-factor authentication requires them. A
receiving alias is not an independent account or an automatic sending grant.

The local host keeps webmail state private outside the document root. Application
code is root-owned; PHP-FPM owns only writable state. The Nginx configuration
executes explicit PHP entry points and denies private/bootstrap paths. Secure
cookies assume a trusted HTTPS entry; do not use plain HTTP for credentials.
Keep the SnappyMail administrator password separate from mailbox credentials.
The PHP pool uses a private session directory, strict cookie-only sessions,
HttpOnly/Secure cookies, bounded workers and a termination timeout. Exception
arguments are excluded from PHP traces. Provider responses are capped at 1 MiB,
management state at 4 MiB, and contended state locks fail promptly.

Optional alias tools are disabled by default with no enrolled users. The
management API key stays outside the web root and browser. Ownership derives
from the authenticated mailbox, and pending writes reconcile without issuing
duplicate provider mutations. Invitation state stores hashed single-use tokens;
mailbox passwords are not persisted by the custom provisioning service. Optional
web onboarding requires a separately verified Access gateway: an email header
alone is not proof of identity. Ordinary mail access requires no such gateway.

Managed filters remain gated until original-recipient matching is verified at
the actual provider. The implementation checks escaped inputs, mailbox folder
membership and concurrent/external edits before activating its own script.

## Calendar

Áring uses salted scrypt passwords, HttpOnly/SameSite browser sessions, Secure
cookies on HTTPS and separately revocable device tokens. Host/Origin checks,
bounded requests and process-local login tracking protect the small service.
Membership precedes record disclosure; revisions, receipts and tombstones retain
offline consistency. It has no application-level MFA: use unique passwords and
private access appropriate to the family installation.

Snapshots use AES-256-GCM and authenticated SQLite verification before restore;
restored sessions are revoked. Keep the backup key separately and copy encrypted
snapshots off-host. Server backups cannot contain unsynced device changes.

## Drive

SFTPGo supplies the transfer/identity implementation. Separate client/admin
bindings, isolated homes, quotas, TOTP, defender/rate limits and disabled extra
protocols form the file-service configuration. Require/enroll HTTP MFA per user.
Keep the administrator upstream private and restrict Docker network membership.
Configure only an exact trusted proxy source for forwarded headers.

The optional Windows manager uses DPAPI, scoped private state, generated home IDs
and single-use invitations. Recovery hooks, monitoring and quota overrides are
explicit options. These platform-specific features are separate from the Linux
container deployment.

## Host trust and operational acceptance

The host/Docker administrator and selected providers are trusted; these apps do
not hide data from their operator. Apply host permissions and disk encryption.
SnappyMail application backups cover private client state, not all provider-held
mail; plan Purelymail mailbox recovery independently. Drive recovery folders are
same-host copies and do not cover host loss.

Before real family use, verify listeners, two-account separation, sharing grants,
HTTPS/session behavior, MFA where supported, revocation and off-host restore.
Exercise actual phones and restarts where applicable. Review upstream releases
and advisories at deployment time. [Validation](VALIDATION.md) distinguishes
source/mock checks from target-host/provider/device acceptance.

The upstream release/advisory review on 2026-10-26 confirms the selected 2.38.2
baseline is newer than the 2.38.0 sanitizer patch documented in
[the upstream mXSS advisory](https://github.com/the-djmaze/snappymail/security/advisories/GHSA-2rq7-79vp-ffxm).
This is a check of the published advisory and release range, not proof that
every upstream component is free of unknown vulnerabilities. Maintain the
underlying PHP/Nginx packages and verify distribution security updates on the host.

See [Current deployment baseline](SECURITY-BASELINE.md) for the eMudhra trust-store policy, PHP/Nginx/OpenSSL package requirements and application-level user-origin admin boundary.
