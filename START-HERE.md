# Arinn: installation and architecture

This repository packages three independent family applications with a common
deployment workflow. Use whichever applications you need. Each installation
has its own accounts, credentials, storage and backups.

The recommended layout uses two computers: **home** runs mail and calendar;
**storage** runs the drive beside its files. This is an evaluation release with
tested container deployment, not an automatic migration of an existing system.

## What runs where

| Application | Software | Location | What it does |
|---|---|---|---|
| Ratataskr Mail | SnappyMail, PHP-FPM and Nginx | Home computer | Provides the browser mail client; Purelymail stores and delivers the actual mail |
| Áring | Node.js and SQLite | Home computer | Provides private calendars, explicit shared events and offline synchronization |
| YggDrive / YggShare | SFTPGo and SQLite | Storage computer | Provides browser file access, separate user homes, quotas and multifactor authentication |

Docker Compose starts the containers and attaches their storage. The Python
management script generates local configuration and calls Compose. Python is a
management tool here, not another web service. There is no separate database
server, central login service or cluster manager.

With all apps selected, home runs three containers: the calendar, the PHP mail
process and the Nginx mail web server. Mail uses one image for those last two
containers. Storage runs one SFTPGo container.

```text
Family device on the private network
  |
  +-- HTTPS --> Home computer
  |               +-- Mail web server --> PHP / SnappyMail
  |               |                         +-- TLS --> Purelymail
  |               +-- Calendar service --> local SQLite database
  |
  +-- HTTPS --> Storage computer
                  +-- SFTPGo --> local user directories
                            +--> local account/configuration database
```

The browser connects directly to storage for drive use. Home does not mount,
copy or relay that directory. The apps page is a generated HTML bookmark page;
it links the addresses without adding another hosted application.

## Before installing

On each computer, install Docker with Compose v2 and Python 3.12 or later. The
recommended host is Linux. Docker Desktop with Linux containers is suitable for
evaluation on Windows. Make sure the operator can run Docker commands.

Choose the app addresses before setup. The recommended private access path is
Tailscale Serve on each computer, with HTTPS and access rules for your family.
The [two-host quick start](docs/TWO-HOST-QUICKSTART.md#1-choose-private-app-addresses)
explains the mapping and commands. The suite does not configure that network,
DNS, certificates or access rules for you.

Examples below use reserved illustrative names. Replace them with the actual
HTTPS names of your machines. A convenient arrangement is mail on the home's
HTTPS port 443, calendar on its HTTPS port 8443, and drive on storage's port 443.
Run only the routes and applications you select.

Extract a copy of the source onto each computer. Keep each copy at its intended
installation path: the generated configuration records absolute paths. Initial
builds need Internet access for the pinned base images, packages and SnappyMail
release. No provider credentials are needed to build the images.

## Run the home role

From the extracted repository directory:

```sh
python3 scripts/suite.py setup --role home \
  --mail-url https://home.example.test \
  --calendar-url https://home.example.test:8443 \
  --drive-url https://storage.example.test
python3 scripts/suite.py check
python3 scripts/suite.py start
```

On Windows, use `python` instead of `python3` if that is your interpreter's name.
On Unix, `./suite` is a convenience wrapper for the same program.

To run only calendar, add `--components aring` during setup and provide its
calendar URL. For mail alone, use `--components mail` and its mail URL. The
drive URL on home is optional and records a link; it does not start a drive.

`check` validates Compose configuration. `start` builds the selected images,
starts their containers and waits for their available health checks. These
commands do not establish working HTTPS, create mailbox accounts or migrate data.

Create calendar users individually, using the hidden password prompt:

```sh
python3 scripts/suite.py account you@example.com "Your Name"
```

For mail, initialize SnappyMail through the separate operator-only HTTPS admin
origin, change its initial password, then configure the family's Purelymail
domain and mailbox settings. Ordinary mail users authenticate with their own
mailbox credentials. A Purelymail management API key is not needed for normal
mail. Follow the [private admin setup](docs/TWO-HOST-QUICKSTART.md#2-configure-and-start-home)
and [provider settings](components/ratataskr/README.md#connect-purelymail) before
entering real credentials.

## Run the storage role

On storage, choose a dedicated new content directory. The container runs as
UID/GID `1000:1000`; that identity must be able to use the directory. On Linux:

```sh
sudo install -d -o 1000 -g 1000 -m 0700 /srv/family-drive
python3 scripts/suite.py setup --role storage \
  --drive-path /srv/family-drive --drive-url https://storage.example.test
python3 scripts/suite.py check
python3 scripts/suite.py start
```

For Docker Desktop, supply the actual dedicated Windows directory and allow
Docker to access it. Do not use an existing installation's live content or
database as an implicit migration. Setup requires the directory to exist and
does not change its ownership or move files.

Initialize the SFTPGo administrator through operator-only access to port 8081.
Then create ordinary users with separate homes, quotas and HTTP multifactor
authentication. Configure the exact trusted HTTPS proxy source, and verify
Secure browser cookies. The [storage instructions](docs/TWO-HOST-QUICKSTART.md#3-configure-and-start-storage)
cover these steps and link the detailed account/proxy configuration.

## Network and trust boundaries

| Host | Local address | Purpose | Intended access |
|---|---|---|---|
| Home | `127.0.0.1:8089` | Mail user interface | Family HTTPS route |
| Home | `127.0.0.1:8088` | Mail administration | Operators only |
| Home | `127.0.0.1:4387` | Calendar web/API | Family HTTPS route |
| Storage | `127.0.0.1:8080` | Drive user interface | Family HTTPS route |
| Storage | `127.0.0.1:8081` | Drive administration/API | Operators only |

`127.0.0.1` means the host's own loopback interface. The host's HTTPS gateway
reaches these ports locally; other devices use the private HTTPS addresses.
Plain HTTP between that gateway and a loopback service is intentional. Mail's
PHP port is available only within its Docker network, not published on the host.

The user mail entry point disables SnappyMail administration before dispatch.
Drive administration is disabled on its user binding. Keep the separate admin
routes private even though administrators still need passwords. A private
network grants reachability, not permission to another family member's account.

Calendar checks the exact configured browser origin. For drive, trust forwarded
HTTPS/client headers only from the actual proxy source seen inside Docker;
do not trust a whole private address range as a shortcut. HTTPS terminates at
the selected gateway. SnappyMail separately verifies outbound provider TLS.

The host administrator and Docker administrators are trusted. They can access
running application data. These applications do not provide encryption that
hides that data from the server operator. Keep private state, host access and
backups protected accordingly. The [security baseline](docs/SECURITY-BASELINE.md)
records certificate-store and runtime requirements, including the eMudhra ECC
G3 distrust policy. Repeat advisory checks when deploying or updating.

## Data, availability and maintenance

| State | Stored on | Recovery requirement |
|---|---|---|
| Mailbox contents | Purelymail | Separate provider-mail backup/recovery plan |
| Webmail settings, contacts, keys, cache and sessions | Home mail volume | Treat the entire volume as mailbox-sensitive |
| Calendar database | Home calendar volume | Verified backup; preserve unsynced device changes separately |
| Drive accounts, MFA/configuration state | Storage state volume | Back up with compatible configuration and encryption material |
| Drive file bytes | Explicit storage directory | Consistent backup of file content as well as account state |

If home is unavailable, direct drive access still works. If storage is
unavailable, calendar and mail can still work. Calendar clients can hold offline
edits, but those edits are not in a server backup until synchronized. Mail needs
provider connectivity; the local web client does not replace Purelymail.

Run maintenance on the computer whose role you want to manage:

```sh
python3 scripts/suite.py status
python3 scripts/suite.py logs
python3 scripts/suite.py stop
python3 scripts/suite.py start
python3 scripts/suite.py update
```

`stop` preserves data. Before `update`, take and verify backups and review
upstream releases. Update rebuilds against the configured image/application
versions and current distribution packages; it does not select newer app
releases automatically. A pinned version identifies a build input, not a promise
that it will remain secure indefinitely.

Configuration lives under ignored `runtime/suite/` on each host. Do not send that
directory with the source. Setup preserves an existing configuration by refusing
to overwrite it. There is no combined backup/restore or migration command in
this release. See [volume identities and recovery notes](docs/TWO-HOST-QUICKSTART.md#4-daily-commands-and-generated-files)
and the [detailed backup instructions](docs/INSTALL.md#9-backups-restore-upgrades-and-removal).

## Included extras and scope

The minimal mail containers include the Ratataskr theme and separate user/admin
entry points. Optional custom mail UI, alias and onboarding tools remain in the
source with native installation instructions; the minimal container setup does
not install them. Windows drive invitation/recovery helpers and the Android
calendar client are additional development paths, not prerequisites for this
stack. The file-sharing prototype is a design example, not the live drive UI.

Accounts remain separate across apps. Áring's current shared **Family** calendar
is explicitly for two granted users per instance; it is not a general household
group-management system. [Naming and behavior notes](docs/NOTES.md) explain
Ratataskr, Áring, YggDrive/YggShare and the intentional account/path conventions.

## What has been tested

The packaged images were built and started in disposable Linux containers.
Checks covered mail user/admin separation, calendar login and origin checks,
drive browser login, a 1 MiB upload/download with matching bytes, account
isolation, restart persistence, and drive operation while home was stopped.
The test used independent Compose projects on one engine with synthetic data.

That does not establish exact parity with an existing installation. Before
using real family data, verify private routing between the actual devices,
operator-only admin access, live IMAP/SMTP, MFA enrollment, browser behavior and
an off-host restoration. Existing apps and data are not automatically migrated.

The [validation record](docs/VALIDATION.md) distinguishes these checks. To
repeat the disposable container test, supply a new private directory outside
the checkout:

```sh
python3 scripts/test_roles_docker.py --workdir /PRIVATE/new-suite-test
```

It removes its own containers and volumes afterward. Synthetic content and
private diagnostics remain in the supplied directory for inspection.
