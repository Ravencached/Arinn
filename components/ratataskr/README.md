# Ratataskr Mail: Purelymail + SnappyMail

The mail stack is a locally hosted **SnappyMail PHP client**, served by
**Nginx + PHP-FPM**, using **Purelymail** for mailbox storage and mail delivery.
The host runs webmail and its private application state; Purelymail runs IMAP,
SMTP and optional ManageSieve. Each family uses its own provider account/domain.

```text
Family browser -> private HTTPS -> local Nginx -> PHP-FPM / SnappyMail
                                                    -> Purelymail IMAP / SMTP
                                                    -> optional ManageSieve
```

Custom source includes the Ratataskr theme, appearance/accessibility plugin,
docked compose integration, alias/invitation administration and guarded filter
integration. SnappyMail supplies the PHP mail client and Purelymail supplies
mailbox/transport services. The source distribution downloads the pinned upstream
SnappyMail release at installation rather than bundling runtime or user data.

## Recommended: home role containers

The [two-host quick start](../../docs/TWO-HOST-QUICKSTART.md) runs Nginx and PHP-FPM
as unprivileged containers from one image, with private persistent mail state.
No native Nginx/PHP installation is needed for that path. It includes the theme
and separate user/admin origins; optional UI/account/onboarding installers below
target the native installation. Choose one path, then use the Purelymail and
account instructions in this guide. No provider credentials are bundled.

## Alternative: fresh native Debian 13 host

Review `server/setup-debian.sh` before running it. It installs Nginx/PHP packages,
verifies the SnappyMail 2.38.2 release against its recorded SHA-256, places code
under `/opt/ratataskr-snappymail`, and keeps writable data under
`/var/lib/ratataskr-snappymail`. It refuses an existing application or Nginx setup.

```sh
cd components/ratataskr
sudo bash server/setup-debian.sh
sudo bash server/verify-debian.sh
```

The origin listens at `127.0.0.1:8088`. Configure a trusted private HTTPS proxy
before signing in: the supplied PHP pool requires Secure cookies and the Nginx
FastCGI configuration assumes that trusted HTTPS entry. The origin's HTTP health
page is not the intended credential-entry URL. Tailscale Serve or a host HTTPS
proxy can provide this private entry; a Cloudflare service is not required for
normal mail access.

Open `/?admin` through the private HTTPS origin. Allow the initial AdminAppData
request to complete, then retrieve the generated initial administrator password
locally from `/var/lib/ratataskr-snappymail/_data_/_default_/admin_password.txt`.
Do not copy that value into source/logs. Set a unique admin password immediately.
Administrative login and ordinary mailbox login are separate.

## Connect Purelymail

Create separate mailbox users in your own Purelymail account. Configure each
mailbox domain in SnappyMail Admin -> Domains:

| Protocol | Server | Port | Encryption |
|---|---|---|---|
| IMAP | `imap.purelymail.com` | 993 | Implicit TLS |
| SMTP | `smtp.purelymail.com` | 465 | Implicit TLS |
| SMTP alternative | `smtp.purelymail.com` | 587 | STARTTLS |
| ManageSieve, optional | `mailserver.purelymail.com` | 4190 | STARTTLS |

Enable certificate and hostname verification. Use the full mailbox address as the
username and a provider app password when two-factor authentication requires it.
For a custom domain, add that domain to SnappyMail and use Purelymail's server
settings; do not assume that adding `purelymail.com` authorizes another domain.
Provider account management credentials are not mailbox credentials. Aliases are
addresses for a mailbox, not separate private accounts.

Confirm IMAP login, read/search/folders, SMTP delivery, attachments and a separate
recipient's account. Set your own domain's DNS records in Purelymail according to
its account instructions. The local host does not accept Internet SMTP or run a
local mail-delivery/storage server.

Official protocol settings: [Purelymail technical setup](https://purelymail.com/docs/setup/technical).

## Theme and UI integration

Choose `ratataskr` as the base theme through the private SnappyMail administrator.
To install the custom UI plugin after setup:

```sh
sudo bash server/install-ui.sh
```

Enable plugins and Ratataskr UI in the private admin panel, clear the application
cache and reload. The plugin supports Light/Dark/System appearance, local
branding, compose docking and accessibility labels. These integrate with native
SnappyMail views rather than replacing message rendering or mail transport.
Recheck view bindings and compose behavior when upgrading SnappyMail.

## Optional alias/account tools

Normal mailbox use needs no Purelymail management API key. To enable the optional
tools, use a private domain controlled by your own provider account. Install the
disabled example at `/etc/ratataskr-aliases/config.json` (root:www-data 0640), fill
in your domain and explicit `owners`/`administrators`, and create private writable
state at `/var/lib/ratataskr-aliases` (www-data 0700). Keep the key outside the web
root at `/etc/ratataskr-aliases/api-key` (root:www-data 0640). The hidden key-entry
script performs a read-only domain check before enabling provider operations.

For alias management without onboarding, after installing the UI plugin:

```sh
sudo install -d -o root -g www-data -m 0750 /etc/ratataskr-aliases
sudo install -d -o www-data -g www-data -m 0700 /var/lib/ratataskr-aliases
sudo install -o www-data -g www-data -m 0600 /dev/null /var/lib/ratataskr-aliases/state.lock
sudo install -o root -g www-data -m 0640 server/aliases-config.example.json /etc/ratataskr-aliases/config.json
# Edit that private configuration with your domain and enrolled mailbox addresses.
sudo bash server/set-api-key.sh
```

Do not overwrite an existing private config when upgrading. New aliases route to
the authenticated enrolled mailbox. A receiving alias does not automatically
grant sending permission: configure the provider and SnappyMail sending identity
separately. Uncertain provider writes remain reserved for reconciliation instead
of blindly retrying.

Optional invitation onboarding uses `portal/account-setup.php` and the separate
loopback 8089 origin. Its identity comes from a verified Cloudflare Access tunnel;
install it only after that tunnel enforces the exact application JWT audience
and allowlist for every request. Merely forwarding an email header is not
authentication. Do not enable onboarding behind an ordinary unverified proxy.
`server/install-cloudflare-origin.sh` installs only the second local origin;
`server/install-account-tools.sh` requires explicit Access verification before
installing the portal (`sudo env RATATASKR_ONBOARDING_ACCESS_VERIFIED=1 bash server/install-account-tools.sh` after verification). No provider users or DNS records are created by installers.

Keep `recipientVerified=false` until original-recipient matching has been tested
for To/Cc/Bcc/forwarding on the actual provider. Only then enable the verified
envelope/header mode. Managed Sieve scripts are checked for concurrent/external
changes and do not replace a foreign active script. Existing mail is not moved.

## Tests and source tour

```sh
php tests/account-tools.php
php tests/folder-response.php
php tests/security-boundaries.php
php tests/user-origin.php
node validate.mjs
find server -name '*.sh' -exec bash -n {} \;
```

PHP tests use mock providers and disposable state; they make no live provider
calls. `plugins/ratataskr-ui/AliasService.php` contains ownership, reservations,
invitations and filter logic. `index.php` binds it to the authenticated SnappyMail
account; `ui.js` and `compose-dock.js` implement the interface integration.

## Operations

Back up the private SnappyMail data directory, including application keys/salts,
preferences and contacts, plus custom configuration and optional alias state.
These are separate from mail stored at Purelymail; decide independently how to
back up provider mail. `server/backup-debian.sh` creates an encrypted application
snapshot using your GPG public key and briefly stops PHP-FPM for consistency.
Keep the private recovery key elsewhere, copy snapshots off-host and test restore
in isolation. Backups may contain provider/tunnel credentials and must stay
encrypted. The source ZIP contains neither runtime data nor credentials.

SnappyMail 2.38.2 is the integration baseline, with a pinned release hash. Check
current upstream security/support information before deployment; stage an upgrade
and verify the plugin/theme against its actual release. SHA-256 verifies the
selected artifact; it is not independent release-signature verification.

The dedicated PHP pool uses a private session directory, strict cookie-only
sessions, bounded workers and a 120-second termination limit. Provider API
responses are limited to 1 MiB; private management state is bounded to 4 MiB.
Concurrent account operations return a busy result instead of queuing blocked
PHP workers. These controls target a small family deployment. Use current
distribution security packages for PHP 8.4+ and Nginx.

Run `sudo bash server/security-baseline.sh` once the required packages are installed
and after updates. The fresh installer runs it before downloading/starting the
application. See the suite [security baseline](../../docs/SECURITY-BASELINE.md)
for package floors and CA-store requirements.
