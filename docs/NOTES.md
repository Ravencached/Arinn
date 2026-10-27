# Operator notes, conventions and limits

## Names and boundaries

**Ratataskr** is the established project spelling, inspired by Ratatoskr, the
squirrel associated with carrying messages along Yggdrasil in Norse mythology.
The exact repository spelling is intentional: preserve it in theme/plugin names and
component paths unless renaming all consumers. The squirrel and
knotwork assets are branding; they provide no cryptographic/security property.

**Áring** is the calendar/reminder companion. `Aring`/`aring` is its ASCII spelling
for directories, environment variables, services and identifiers. Its branding
evokes a year/seasonal cycle; do not assume it is a standard calendaring protocol
or a historically standardized Old Norse term. The accent belongs in display
text; ASCII identifiers avoid shell/filesystem portability problems. It is an
independent application, database and account system even though it was developed
inside the mail tree. It does not inherit a mail login.

**YggDrive** is the repository/setup name. **YggShare** is the file-service UI and
Windows service-family label. **Ygg** is its tree-guardian mascot, another
Yggdrasil reference. Those names do not identify a required hostname, computer,
Windows account or drive letter. The original deployment's machine names,
personal domains and disk letters are not requirements of the portable setup.
SFTPGo is the actual third-party file/identity server; the static
`components/yggdrive/prototype` is only a design preview with sample files.
The default container uses the maintained upstream SFTPGo interface; the original
guardian artwork and preview are retained for optional branding work.

**Arinn** is the public name for the combined suite. The earlier **Selfhost Suite**
name remains in internal project/image identifiers and contributor attribution.
It does not merge
these apps into one trusted security domain or introduce single sign-on.
Compromise of their shared host/Docker administrator can affect all components.
Use separate hosts if that failure boundary matters.

## Technical conventions worth preserving

| Convention | Meaning and reason |
|---|---|
| `aring` Compose profile/service | Calendar only; separate persistent volume and process |
| `yggdrive` Compose profile/service | Upstream SFTPGo; does not start the Windows invite helper |
| `owner` | Ordinary file user referenced by the optional Windows manager; never the native administrator |
| `ygg-admin` | Default optional-manager administrator name; configurable with `--admin-username` |
| `u_` plus 32 hex digits | Windows invited home name derived from a generated UUID; separates stable private storage identity from user-chosen login names |
| `/Ygg Recovery` | Optional, read-only user mount for same-host version/deletion copies; restore uses copy permission back into the private home |
| `.aringbackup` / `ARING01` | Versioned calendar encrypted backup format: magic header, nonce, streamed AES-256-GCM ciphertext, authentication tag |
| `opId`, revision, receipt, tombstone | Calendar retry identity, optimistic concurrency version, durable retry result, and persistent deletion record |
| `example.test`, `example.invalid`, `com.example.*` | Reserved placeholder identities/endpoints/application IDs; substitute your own before deployment/native packaging |

The small numeric ports are implementation choices to avoid common conflicts,
not universal standards. Change bindings, expected origins, proxy upstreams and
test assumptions together. Loopback boundaries protect against remote access,
not against another sufficiently privileged local user.

Mail code is installed under `/opt/ratataskr-snappymail`; private application
state is under `/var/lib/ratataskr-snappymail`. Optional management configuration
and state use `/etc/ratataskr-aliases` and `/var/lib/ratataskr-aliases`. These names
are stable paths for the supplied host scripts, not mailbox/archive identities.

## Calendar behavior and limits

Timed recurrence preserves the local start time and original duration. Spring
clock gaps shift forward and autumn overlaps use the earlier offset.
Monthly/yearly invalid dates are skipped; January 31 does not become February
28. All-day end dates are exclusive; recurrence end dates are inclusive. Count
includes valid occurrences only. Arbitrary RRULEs, arbitrary weekday sets,
"this and following" edits and shared reminders are not implemented.

One Family calendar supports two explicitly authorized users. Service limits
are 5,000 active items and 4 MiB of serialized active payload per calendar;
tombstones/receipts accumulate separately. Monitor disk space and determine
retention with offline-client safety in mind. Browser sessions last seven days;
native device credentials last 90 days and can be individually revoked.

Android plans a 45-day alert horizon, up to 499 future alerts plus a refill.
Exact alarms need OS permission; denied permission, Doze, force-stop and vendor
battery rules can delay notifications or background sync. Desktop background
alerts are not implemented. Device-only mode has no sharing or synchronization;
export before switching/resetting it. Server backups cannot recover unsynced
device-only data. Browser sign-out removes the active cache: export pending
work first.

## Mail behavior and ownership

Ratataskr Mail is the locally hosted SnappyMail PHP client and custom integration.
Purelymail is the separate provider holding mailbox contents and handling delivery.
The host retains client preferences/contacts/keys and optional alias registry.
There is no local SMTP delivery service or standalone local mail archive engine
in this distribution. Native SnappyMail handles mailbox/compose operations.

Each person needs a separate Purelymail mailbox for private access. Aliases route
to mailboxes; they do not provide isolation. Provider management login, API key,
mailbox password and local SnappyMail administrator password serve different roles.
Use explicit TLS, full mailbox login and app passwords where required by 2FA.

Optional alias receiving status, sending authorization and folder filtering are
separate states. Uncertain writes require reconciliation. Folder rules remain
gated until original-recipient behavior is verified. Invitation onboarding is an
optional gateway-protected workflow, not a requirement for normal local webmail.

## Distribution contract

The source package contains code, synthetic fixtures, example configuration and
selected branding. Receiving families provide credentials, hostnames, provider
accounts, storage and recovery keys. Upstream SnappyMail is fetched as a pinned
release during native installation. No original runtime data, mailbox contents,
keys or signed application releases are supplied.
