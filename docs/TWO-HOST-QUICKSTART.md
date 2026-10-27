# Two computers, one family suite

The recommended preliminary deployment uses the same repository and commands on
two computers. The **home** role runs Ratataskr webmail and/or Áring. The
**storage** role runs YggDrive beside its local files. A saved drive address links
the apps; the home host does not mount, copy or relay the drive directory.
Either role can run while the other is stopped. Purelymail remains external.

Use Linux Docker Engine/Compose v2 and Python 3.12+ on each host. Docker Desktop
Linux containers can evaluate the roles on Windows; a native Windows SFTPGo
installation remains an advanced alternative. Do not run a container over an
existing SFTPGo database or point it at an existing user's home as a migration.
Setup creates configuration only and refuses an existing role configuration.

## 1. Choose private app addresses

Recommended family access is Tailscale Serve on each host, with HTTPS enabled
and device/user access rules restricted to your family. Use each machine's actual
Tailscale DNS name, not the illustrative names below. The mail and calendar can
share the home hostname on different HTTPS ports. The storage hostname serves
the drive directly. No public ingress or router port forwarding is required.

For example, substitute your real origins for:

| App | Illustrative origin | Origin on its own host |
|---|---|---|
| Mail | `https://home.example.test` | `http://127.0.0.1:8089` |
| Calendar | `https://home.example.test:8443` | `http://127.0.0.1:4387` |
| Drive | `https://storage.example.test` | `http://127.0.0.1:8080` |

On the home machine, after reviewing existing Serve configuration:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8089
tailscale serve --bg --https=8443 http://127.0.0.1:4387
```

On storage:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8080
```

Run only commands for apps you enable. These are operator actions, not commands
the suite runs for you. Inspect `tailscale serve status`, enable HTTPS according
to the current [Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve),
and verify actual access rules. Do not use Funnel. Admin ports are excluded from
these family routes. Setup URLs do not configure DNS, certificates or Tailscale.

## 2. Configure and start home

From a copy of the repository on the home machine:

```sh
python3 scripts/suite.py setup --role home \
  --mail-url https://home.example.test \
  --calendar-url https://home.example.test:8443 \
  --drive-url https://storage.example.test
python3 scripts/suite.py check
python3 scripts/suite.py start
python3 scripts/suite.py account you@example.com "Your Name"
```

Replace all three URLs with your actual addresses before setup. Use
`--components aring` or `--components mail` to select one home app; provide its
URL. The drive URL is optional on home and is only a link. The Unix convenience
launcher `./suite` runs the same Python program.

Mail runs as two unprivileged containers, Nginx and PHP-FPM, built from one
Debian image. Writable SnappyMail state is a private named volume mounted only
by PHP. The theme is included; select it through SnappyMail Admin. The minimal
container path does not install the optional native alias/onboarding/UI tools.
Those remain advanced integrations described in the mail component guide.

Complete SnappyMail's private administrator setup and configure your Purelymail
domains as described in the [mail guide](../components/ratataskr/README.md).
Use the separate `127.0.0.1:8088` admin origin through operator-only HTTPS;
the user origin rejects administration. If temporarily using an additional
Tailscale Serve admin port, first grant that port to operators only, verify a
normal family account is denied, and remove the route when finished. Never
publish that origin using the family mail route. After the initial admin data
request, read the generated password locally in a private terminal:

```sh
docker compose --env-file runtime/suite/compose.env -p selfhost-home \
  -f runtime/suite/compose.json --profile '*' exec -T mail-php \
  cat /var/lib/ratataskr-snappymail/_data_/_default_/admin_password.txt
```

Change it immediately. Do not copy passwords into logs or the handoff archive.

## 3. Configure and start storage

Create a **dedicated new directory** on the storage computer. It will contain
`data/Users/` and backup/export subdirectories. Set ownership/ACLs so the container's
UID/GID `1000:1000` can use it. Setup neither creates the content directory nor
recursively changes its permissions. On a new Linux directory, for example:

```sh
sudo install -d -o 1000 -g 1000 -m 0700 /srv/family-drive
python3 scripts/suite.py setup --role storage \
  --drive-path /srv/family-drive --drive-url https://storage.example.test
python3 scripts/suite.py check
python3 scripts/suite.py start
```

Use a dedicated existing directory and suitable Docker Desktop file-sharing
permissions when evaluating on Windows. A missing bind source fails instead of
silently creating an empty drive. No SMB/NFS mount through the home host is used.

Configure the initial SFTPGo administrator via operator-only access to
`127.0.0.1:8081`. Create separate ordinary users, isolated homes, quotas and HTTP
MFA before family access. See [drive account setup](INSTALL.md#drive-accounts-and-mfa).
The provider database lives in this role's named `yggdrive-state` volume;
file bytes live in the explicit bind directory. Preserve both for recovery.

For HTTPS, edit `runtime/suite/drive/sftpgo.json`: configure the client binding's
`security.https_proxy_headers` and exact trusted `proxy_allowed` source as
described in [proxy configuration](INSTALL.md#4-remoteprivate-access-and-https).
The proxy source observed inside Docker may be a bridge gateway. Verify Secure
cookies and header spoof rejection on your actual host. The generator configures
the allowed drive hostname but cannot infer the trusted proxy's address.

## 4. Daily commands and generated files

Run these on the machine whose role you want to manage:

```sh
python3 scripts/suite.py status
python3 scripts/suite.py logs
python3 scripts/suite.py stop
python3 scripts/suite.py start
python3 scripts/suite.py update
```

`stop` preserves state. `update` rebuilds with current distribution security
packages and recreates containers; first take verified backups and review
upstream advisories/pins. It does not automatically select newer app releases.
There is no unattended upgrade or combined backup/restore command in this
preliminary version. Use the [backup and restore procedures](INSTALL.md#9-backups-restore-upgrades-and-removal)
per role. Never assume a source checkout contains your data backup.

For the default role project names, preserve `selfhost-home_mail-state` and
`selfhost-home_aring-data` on home, and `selfhost-storage_yggdrive-state` plus the
entire selected content directory on storage. Preserve each role's private
configuration too. Stop the relevant role for consistent filesystem snapshots;
keep any volume exports on encrypted private storage and test restoration into
separate volumes. Mail's volume includes its cache/session state, not a backup
of the authoritative Purelymail mailbox. Custom `--project` names change volume
prefixes. The native mail backup script uses native host paths and is not a
container-volume backup command.

Generated files are under ignored `runtime/suite/`: `settings.json`,
`compose.json`, `compose.env`, storage configuration and `apps.html`. The HTML is
a local bookmark page, not an extra hosted service or shared-login system.
The two machines need separate configurations; do not copy the storage path
configuration onto home. Accounts remain per app. Home outages do not prevent
direct drive access; storage outages do not stop calendar or mail.

Keep your checkout at its configured path: generated Compose definitions contain
absolute paths. For a move or migration, preserve backups and existing project/
volume identities, then deliberately review/recreate configuration. Setup does
not overwrite or migrate existing deployments. Legacy native/Compose instructions
remain available in `INSTALL.md`; choose one installation path per app.

## 5. Disposable evaluation

Configuration tests need no daemon:

```sh
python3 -m unittest discover -s tests -p test_roles.py -v
```

For real containers, give the integration runner a **new** private directory
outside the checkout. It uses unique projects and available loopback test ports,
synthetic accounts and only that directory's storage. It removes its own
containers, networks and named volumes afterward; private diagnostics and the
synthetic content remain in the supplied directory.

```sh
python3 scripts/test_roles_docker.py --workdir /PRIVATE/new-suite-test
```

This tests two independent Compose roles on one engine. It does not demonstrate
physical two-host networking, live Purelymail delivery, Tailscale access rules or
an off-host restore. Repeat those receiving-host acceptance checks separately.
