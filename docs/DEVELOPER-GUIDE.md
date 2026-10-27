# Developer walkthrough

## Architecture

For a fresh deployment, start with [two-host roles](TWO-HOST-QUICKSTART.md).
`scripts/suite.py` selects home (mail/calendar) or storage (local drive content)
and generates a role-specific Compose project. It reuses the existing app service
definitions instead of introducing a shared database or remote filesystem.
`compose.mail.yaml`, the mail `Dockerfile` and `container/` configs implement the
unprivileged PHP-FPM/Nginx path. Native installers below are alternatives.

The suite contains three independent family applications. Mail is **Purelymail +
locally hosted SnappyMail PHP**. Calendar is Áring's Node/SQLite service and
offline client. File sharing integrates SFTPGo with family administration tools.

```text
Mail browser -> private HTTPS -> local Nginx -> PHP-FPM / SnappyMail
                                               -> Purelymail IMAP / SMTP / optional Sieve
Calendar client -> offline queue -> membership/revision checks -> SQLite -> encrypted backup
File browser -> private/HTTPS path -> SFTPGo client -> granted home
Administrator -> separate private management interfaces
```

SnappyMail provides the mail client, rendering and protocol implementation;
Purelymail provides mail storage/delivery. Custom Ratataskr work covers theme,
appearance/accessibility, compose docking, optional account/alias workflows and
guarded Sieve integration. SFTPGo similarly supplies the file-service foundation;
the custom drive work covers configuration, invitations and recovery integration.

## Review the mail module

Start in `components/ratataskr`:

1. `server/setup-debian.sh`, `nginx.conf`, `php-pool.conf`: root-owned code, private writable data, loopback origin and PHP worker policy.
2. `themes/ratataskr/`: local theme variables, assets and scoped styling.
3. `plugins/ratataskr-ui/index.php`: hooks into the authenticated SnappyMail account and native views.
4. `ui.js`, `ui.css`, `compose-dock.js`: appearance/accessibility and retained native compose behavior.
5. `AliasService.php`: ownership, address reservations, uncertain-write reconciliation, single-use invitations and managed-filter checks.
6. `tests/account-tools.php`, `tests/folder-response.php`: mock-provider and view-response examples.

Plugin files in items 4–5 live under `plugins/ratataskr-ui/`.

```sh
php tests/account-tools.php
php tests/folder-response.php
node validate.mjs
find server -name '*.sh' -exec bash -n {} \;
```

Tests require no real provider key or mailbox. For the live local-host path,
follow the [mail how-to](../components/ratataskr/README.md). That guide covers
fresh Debian installation, private HTTPS, domain settings and optional tools.
Live IMAP/SMTP tests require the receiving family's own mailbox credentials.

When extending alias tools, derive ownership from the authenticated mailbox,
retain exact/prefix collision checks and exercise uncertain provider outcomes.
Keep receiving aliases, sending identities and private mailbox accounts distinct.
For filters, retain escaping, folder membership and foreign-script/concurrency
checks. Changes to upstream view hooks should be verified against the actual
SnappyMail release in both desktop and phone layouts.

## Run and review Áring

With patched Node.js 24.22.1+ within 24.x:

```sh
cd components/aring
npm ci
npm test
npm run build
npm start
```

The service uses loopback port 4387 and creates no accounts. The component README
documents its separate in-memory demo. Read `shared/calendar.mjs` for validation
and recurrence, `server/store.mjs` for membership/revisions/receipts,
`web/storage.mjs` for offline operations and `server/backup.mjs` for recovery.
Tests demonstrate private/shared calendars, concurrency and stale offline edits.
Native Android source integrates local storage, alarms and synchronization.

## Run and review YggDrive

From the root, with Docker/Compose:

```sh
python scripts/configure.py --components yggdrive
docker compose --profile yggdrive config --quiet
docker compose --profile yggdrive up -d
```

Use port 8081 for private setup/admin and 8080 for the file client. Provision
separate homes and required HTTP MFA. Inspect `scripts/configure.py` and
`compose.yaml` for access/storage boundaries. Optional Windows integrations are
in `components/yggdrive/windows/invites/`; their fixture runners are under
`windows/scripts/`. The static `prototype/` is a visual sample, not authentication
or storage code. Container startup is a receiving-host acceptance step.

## Development and delivery

Use synthetic data for local checks. Run the selected component's tests and
build, preserving account-isolation and retry/conflict checks when changing those
boundaries. Supply independent deployment credentials outside tracked source.
Exercise TLS/private access, backups/restoration and device behavior on the
receiving hardware. Run `python scripts/review_export.py` before creating a
`git archive`. [Validation](VALIDATION.md) records completed checks;
[installation](INSTALL.md) covers deployment choices and recovery.
