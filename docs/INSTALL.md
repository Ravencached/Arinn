# Installation and configuration

For a new installation, begin with the [two-host quick start](TWO-HOST-QUICKSTART.md).
It provides one command interface for home and storage. This document retains
advanced component-level/native paths and detailed account, proxy and recovery
requirements. Choose one path per component; do not start both on the same ports.

## Deployment choices

Each family operates an independent installation. Choose any subset of mail,
calendar and drive; their accounts and data remain separate.

| Component | Primary deployment | Persistent state |
|---|---|---|
| Mail | Home role: containerized Nginx + PHP-FPM + SnappyMail 2.38.2; native Debian 13 alternative | Private webmail state/cache/contacts/keys; authoritative mailbox at Purelymail |
| Calendar | Patched Node.js 24.22.1+ within 24.x, natively or Compose | SQLite, device caches, encrypted snapshots |
| Drive | Storage role: SFTPGo 2.7.6 beside its local content; advanced Windows alternative | Provider database, file content and MFA state |

Mail requires no local SMTP delivery server, mail daemon, cloud Worker or provider
API key for normal IMAP/SMTP access. Follow the [mail how-to](../components/ratataskr/README.md)
for installation, TLS proxying, mailbox setup, theme/plugin installation, optional
alias tools and encrypted application backups. The installers target fresh paths
and refuse to overwrite existing host services blindly.

For development, PHP CLI runs the plugin's mock-provider tests; Node.js is needed
only for its static theme/artifact check. The production mail application is PHP.

## Capacity and network

Choose a small host with storage for private application state, logs and backups.
Calendar/drive Compose caps are 384 MiB and 512 MiB respectively; the mail PHP
pool starts workers on demand, up to three with 128 MiB PHP allocation each.
These are process limits, not measured total-host memory requirements. Allow
additional OS/proxy/container overhead and actual file storage.

Mail origin: `127.0.0.1:8088`. Optional separated user origin: `127.0.0.1:8089`.
Calendar: `127.0.0.1:4387`. Drive client/admin: ports 8080/8081. Normal remote
family use requires the selected private HTTPS/access path. Do not publish admin
interfaces. Purelymail connections must verify TLS certificates and hostnames.


## 2. Local containers

From the repository root:

```sh
python scripts/configure.py --components aring yggdrive
docker compose --profile aring --profile yggdrive config --quiet
docker compose --profile aring --profile yggdrive up -d --build
docker compose --profile aring --profile yggdrive ps
```

The configuration generator preserves existing `.env` and
`runtime/yggdrive/sftpgo.json`. Changing command-line hostnames on a later run
does not overwrite them; review those files explicitly. No secrets are needed
to generate the configuration. Container startup does not create users.
The default Node.js and SFTPGo base images are pinned to multi-platform manifest
digests, resolved anonymously from the public registry and hash-verified on
2026-10-26; see `IMAGE-PINS.json`. If overriding them, select trusted current
digests in `.env`. Scan the chosen images before a lasting deployment; pinning
provides reproducibility, not a vulnerability or publisher-signature assessment.

| Host address | Purpose | Publish through HTTPS? |
|---|---|---|
| `127.0.0.1:4387` | Áring web/API | Yes, on its own calendar hostname |
| `127.0.0.1:8080` | SFTPGo WebClient | Yes, on its own drive hostname |
| `127.0.0.1:8081` | SFTPGo WebAdmin and administrative API | Keep private |
| `127.0.0.1:8091` | Optional Windows invitation manager | Keep private |
| `127.0.0.1:8090` | Optional Windows invitation redemption only | Only the documented `/join` routes |

The `0.0.0.0` addresses inside containers are necessary for Docker's port
forwarding. The host publications remain `127.0.0.1`. Unpublished container
ports can still be reachable by peers on the same Docker network; do not put
untrusted containers on that network. Docker/root administrators can read data.

### Áring accounts and Family calendar

```sh
python scripts/aring_account.py you@example.com "Your Name"
docker compose --profile aring exec aring node server/admin.mjs list
```

Passwords are 14–512 characters and read through a hidden terminal prompt;
they are passed to the container on stdin. Use unique generated passwords.
Create a second account independently if desired, then use the printed IDs:

```sh
docker compose --profile aring exec aring node server/admin.mjs family USER_ID_1 USER_ID_2
```

Family means exactly two explicitly granted active users and one shared event
calendar per service instance. Private reminders cannot be moved into Family.
Account IDs and calendar IDs are UUIDs, not email addresses. Administrative
disable/password reset revokes sessions. `unshare CALENDAR_ID USER_ID` removes
calendar membership. Do not remove tombstones or retry receipts casually: they
prevent stale offline clients from replaying changes.

### Drive accounts and MFA

Open the private administrator URL and create a new administrator with a long
unique password. Enroll administrator TOTP and store recovery codes separately.
Create ordinary users with separate homes under `/srv/sftpgo/data/Users/NAME`,
explicit `/` file-operation permissions, a storage quota (start with 100 GiB),
and required HTTP two-factor authentication. Disable share creation unless you
have deliberately reviewed that feature. Do not give ordinary users
administrative permissions or arbitrary virtual-folder mappings.

The file client is on port 8080; WebAdmin/general administrative APIs are
disabled there. A second user must not be able to list or access the first
user's home even when given a physical path or guessed filename. Complete
enrollment before enabling remote access. SFTP, FTP, WebDAV and telemetry
listeners are disabled in the generated configuration.

## 3. Native/local Áring without Docker

```sh
cd components/aring
npm ci
npm test
npm run build
npm start
```

This binds `127.0.0.1:4387` and uses ignored `runtime/aring.sqlite`. Choose the
database path with `ARING_DB`; set `ARING_ORIGIN` to the exact browser origin,
without a trailing slash. Non-loopback HTTP origins are rejected. Use
`node scripts/account.mjs EMAIL DISPLAY_NAME` with a password on private stdin,
or `node server/admin.mjs create EMAIL DISPLAY_NAME PRIVATE_PASSWORD_FILE` with
an access-restricted file outside Git. The Compose password helper targets the
container and is not used for a native service.

The optional Linux `deploy/install.sh` uses a dedicated `aring` user, root-owned
program files and a hardened systemd service. Review it before running as root;
it refuses an existing installation. It requires `/usr/bin/node`, `npm`,
systemd and a completed web build. Set `/etc/aring/service.env` with
`ARING_ORIGIN=https://calendar.your-domain` before remote browser use, then
restart the service. The installer starts a loopback service and backup timer;
it does not configure an HTTPS proxy or off-host backup. Choose either this
native path or Compose; both use port 4387 and must not run simultaneously.

`node scripts/demo.mjs` creates only an in-memory demo. Its documented synthetic
accounts are evaluation fixtures and must never be used for real data. The
normal service seeds no accounts.

## 4. Remote/private access and HTTPS

For initial evaluation, use SSH forwarding or an authenticated private network.
For example, tunnel a remote host's loopback calendar port to the same port on
your local machine, keeping `ARING_ORIGIN=http://127.0.0.1:4387`. Browser origins
must match exactly, including port. Multiple apps use different ports.

For HTTPS, adapt `deploy/Caddyfile.example` on the host. Supply real hostnames,
trusted certificates, DNS and firewall rules. Set `ARING_ORIGIN` to its exact
HTTPS hostname and recreate the calendar container. Add the drive hostname to
the client binding's `security.allowed_hosts` in the ignored drive config. Keep
the administrative binding's hosts limited to loopback. Restart the drive.

Before enabling a lasting HTTPS drive deployment, configure the client binding's
`security.https_proxy_headers` as `[{"key":"X-Forwarded-Proto","value":"https"}]`
and its `proxy_allowed` with the **exact** trusted proxy source address/CIDR as
seen by SFTPGo. On Docker this may be a bridge gateway, not host loopback. Inspect
your actual network rather than trusting an entire RFC1918 range. If client-IP
forwarding is enabled, set `client_ip_proxy_header` to `X-Forwarded-For` and
`client_ip_header_depth` to `0`; verify the proxy overwrites spoofed headers.
Confirm browser cookies are Secure on HTTPS, and that client-IP defenses see
the real visitor. Treat these as deployment acceptance requirements.

Áring ignores forwarded IP headers by default. Native deployments can opt into
`ARING_TRUST_PROXY=true` only when the immediate peer is loopback and the proxy
overwrites `X-Forwarded-For` with one valid IP. The supplied Compose deployment
leaves it false, so proxy users share an address-level login budget. Use private
access and edge rate limiting; do not enable blanket forwarding trust to
resolve a lockout. The service is a small private application, not a public
identity service with distributed abuse defenses.

Disable proxy/CDN caching for authenticated pages and APIs. Never forward drive
administration publicly. Verify unauthenticated denial, cross-account isolation,
MFA and certificate renewal from another device before using real data.



## Calendar Android

Áring Android uses Capacitor 8, JDK 21, SDK 36 and compatible Gradle 8.13+.
In `components/aring`, run `npm ci`, `npm run android:sync` and native tests/lint.
On Windows `scripts/build-android.ps1 -DebugBuild` uses installed Gradle.
Release signing uses your own `ARING_KEYSTORE`, `ARING_SIGNING_PASSWORD` and
optional `ARING_KEY_ALIAS` (default `aring`). Replace example package identifiers
and endpoint allowlists before signing. Test notifications, permissions, offline
sync and background behavior on an actual phone.


## 8. Optional Windows invitation/recovery service

`components/yggdrive/windows` contains the invitation manager and a generic
loopback configuration generator, not an automatic Windows service installer.
Use official SFTPGo portable files, a dedicated restricted Windows service
identity, explicit NTFS ACLs, and separate state/content directories. Supply
`-RuntimePath`, `-StatePath`, `-OutputPath`, `-ContentPath` and optional
`-PublicHost` to `scripts/New-YggShareConfig.ps1`. Never use `-TestApi` for a
real installation: it weakens the fixture's password/defender settings.

Create an ordinary `owner` account, require/enroll HTTP MFA and create a separate
administrator (`ygg-admin` by default; configurable). Run the helper with your
own paths, for example:

```powershell
python invites/server.py --data C:/ServiceState/YggShare/Invites --home-base D:/Drive/Users --public-origin https://drive.your-domain --admin-username ygg-admin
```

Run under a dedicated service account with only invitation-state access and
access to the private native API; it should not have drive file permissions.
Use the manager on loopback port 8091. Proxy only `/join` and `/join/*` to 8090,
overwriting client-IP/HTTPS headers. Do not proxy the manager or native admin
API. The default Compose drive has no invitation helper and needs no `/join`
route.

The helper defaults to preserving owner quotas. `--unlimit-owner` is a deliberate
override. Recovery-hook provisioning (`--enable-recovery`) and outbound health
checks (`--monitor`) are separately opt-in. Recovery also requires scoped NTFS
ACLs, the synchronous native event/command hooks and a retention job: copying
Python files alone does not install those. `Service.cs` is a wrapper source
reference; no precompiled service or SYSTEM scheduled task is supplied.

DPAPI invitation blobs are machine-bound and rely on Windows filesystem ACLs;
they are not portable encrypted backups. Use new invitations after moving hosts
and keep those state files private. Generated `u_` UUID home names are an
intentional authorization boundary, explained in the naming guide.


## 9. Backups, restore, upgrades and removal

For Áring, generate a private 32-byte key and take an authenticated snapshot:

```sh
node server/backup.mjs keygen /PRIVATE/backup.key
node server/backup.mjs create /PRIVATE/aring.sqlite /PRIVATE/calendar.aringbackup /PRIVATE/backup.key
node server/backup.mjs restore /PRIVATE/calendar.aringbackup /PRIVATE/new.sqlite /PRIVATE/backup.key
```

Run these within `components/aring` natively, or with `docker compose exec aring`
and private volume paths such as `/data/backup.key`. Restore to a **new** path
while the service is stopped before selecting that database. Restore validates
AES-GCM and SQLite integrity and revokes old browser/device sessions. For a
container, place snapshots in `/data`, copy each encrypted snapshot out with
`docker compose cp aring:/data/FILE PRIVATE_DESTINATION`, and securely extract
the key to a separate recovery location as well. Do not send it to a terminal
log, source archive or the same off-host destination as the snapshots. Browser
exports include unsynced work; server backups cannot include changes that have
never reached the server.

For the drive, preserve **both** named state/content volumes and any deployment
configuration/MFA encryption material; take a consistent backup with the service
stopped or a supported provider snapshot. Test restoration on an isolated
instance with private listeners. SFTPGo exports alone do not back up file bytes.
Recovery folders are same-host copies, subject to disk exhaustion, and are not
a backup. Off-host encryption/retention and monitoring are operator work.

For mail, back up SnappyMail application data/keys, preferences, contacts,
local configuration and optional alias state. Mailbox contents remain at Purelymail;
choose a separate provider-mail backup strategy. See the component's encrypted
application-backup instructions. Never put unencrypted runtime state in this ZIP.

Before upgrades, take and verify a backup, review upstream advisories, update
locked dependencies/images, test in isolation, then repeat authentication,
isolation, MFA and restore checks. Schema migrations may prevent downgrades;
roll back by restoring a compatible backup, not just replacing a binary.
Compose `down` retains named volumes; `down --volumes` destroys them. No command
in this guide should be run against a preexisting operator installation without
an explicit migration plan. Use supported component migration procedures for existing state.

Rebuild derived calendar/drive images after security policy or trust updates:

```sh
docker compose --profile aring --profile yggdrive build --pull --no-cache
docker compose --profile aring --profile yggdrive up -d --force-recreate
```

The derived builds update CA/OpenSSL packages and check the
[security baseline](SECURITY-BASELINE.md). Pinning a base digest alone is not
freshness verification. Select only the profiles deployed by the family.
