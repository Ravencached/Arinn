# Arinn

**Experimental v0.1.0 — source release candidate.** A modular family home-server
suite with independent home and storage roles. This is not an automatic migration
or a certified production deployment. See [tested scope](docs/VALIDATION.md).

**License:** original code AGPL-3.0-or-later; original documentation and artwork
CC BY 4.0. Third-party exceptions and attribution are in [LICENSING.md](LICENSING.md).

Three optional applications for independent family installations: **Ratataskr
Mail**, **Áring**, and **YggDrive / YggShare**. Each family supplies its own
accounts, storage, credentials and recovery keys.

| Component | Stack and purpose |
|---|---|
| Ratataskr Mail | Locally hosted SnappyMail PHP client on Nginx/PHP-FPM, using Purelymail for IMAP/SMTP; custom theme, UI and optional alias/account tools |
| Áring | Independent Node.js/SQLite calendar and reminders, offline web/Android client, explicit Family sharing and encrypted backups |
| YggDrive / YggShare | SFTPGo-based private file sharing, separate administration and optional Windows invitation/recovery integration |

The implementation emphasizes account boundaries, offline consistency, native
integration and practical family administration. Each application can be adopted
independently. Mail stays provider-backed: the local host serves the PHP client
and application state, while Purelymail stores and delivers messages.

## Start here

- [Contributing](CONTRIBUTING.md), [security reporting](SECURITY.md) and [release preparation](docs/PUBLISHING.md).
- [Handoff guide](START-HERE.md): stack explanation, commands, network boundaries and recovery requirements.
- [Two-host quick start](docs/TWO-HOST-QUICKSTART.md): recommended preliminary home/storage deployment.
- [Developer walkthrough](docs/DEVELOPER-GUIDE.md): architecture and source entry points.
- [Installation spec](docs/INSTALL.md): select components and configure your host.
- [Mail how-to](components/ratataskr/README.md): Purelymail, SnappyMail, PHP and optional tools.
- [Security design](docs/SECURITY-REVIEW.md) and [current security baseline](docs/SECURITY-BASELINE.md): family trust, certificate stores and runtime policy.
- [Naming and behavior](docs/NOTES.md) and [validation](docs/VALIDATION.md).

## One repo, two deployment roles

Use Python 3.12+ and Docker/Compose v2 on each machine. Home runs optional mail
and calendar; storage runs the drive on the computer containing its disk space.
There is no network filesystem through home and no additional database service.

On home, substitute your real private HTTPS addresses:

```sh
python3 scripts/suite.py setup --role home \
  --mail-url https://home.example.test \
  --calendar-url https://home.example.test:8443 \
  --drive-url https://storage.example.test
python3 scripts/suite.py check
python3 scripts/suite.py start
```

On storage, supply an existing dedicated content directory writable by UID 1000:

```sh
python3 scripts/suite.py setup --role storage \
  --drive-path /srv/family-drive --drive-url https://storage.example.test
python3 scripts/suite.py check
python3 scripts/suite.py start
```

Both machines use the same `status`, `logs`, `stop`, `start` and `update` commands.
Generated local configuration is preserved and excluded from the source archive.
Setup does not migrate installed services or configure HTTPS/accounts. Complete
the [quick start](docs/TWO-HOST-QUICKSTART.md) for private access, admin setup and
backups before real use. Native mail and Windows helpers remain advanced options.

## Evaluation and distribution

The validation record distinguishes mock-provider/source checks from actual
host, browser, provider and device acceptance. Supplied examples contain no
production accounts or credentials. Use `python scripts/review_export.py` and
`python scripts/check_licenses.py` before `git archive` when distributing source.
See [license scope](LICENSING.md) and [third-party notices](docs/THIRD-PARTY.md).

Arinn is the public suite name. Component names, `selfhost-*` Compose project
names and existing volume identifiers are retained for deployment compatibility;
renaming the repository does not migrate or rename stored data.
