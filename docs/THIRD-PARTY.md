# Licensing and upstream foundations

Original code is licensed under AGPL-3.0-or-later; original documentation and
project artwork are CC BY 4.0 to the extent rights are held. See
[license scope](../LICENSING.md), [NOTICE](../NOTICE), the per-file `REUSE.toml`
map and [artwork provenance](ARTWORK.md). Dependencies retain their own terms;
the project default does not replace upstream licenses or notices.

SnappyMail supplies the PHP webmail client and is downloaded from its upstream
release during installation. Purelymail supplies the separate IMAP/SMTP/Sieve
service. Nginx and PHP-FPM supply local hosting. Custom Ratataskr code integrates
branding, UI behavior and optional family account tools with those foundations.

SFTPGo supplies file transfer, identity/MFA and its maintained web interface;
the suite adds configuration and optional Windows administration/recovery tools.
Áring uses Node.js, SQLite/crypto, the Temporal polyfill, Capacitor and Android
APIs. Preserve upstream licenses/notices and review any source-offer obligations
for intended redistribution. Selected artwork conveys no additional trademark
clearance. The source license inventory is not an exhaustive image/APK audit.

| Material | Selected terms and distribution notes |
|---|---|
| SnappyMail 2.38.2 | Upstream AGPLv3; preserve its own notices and corresponding-source obligations |
| SFTPGo 2.7.6 | Upstream AGPLv3; preserve the image/application's own notices and source obligations |
| Capacitor 8.5.3 and scaffold portions | MIT; original Drifty notice retained in `third-party-notices/Capacitor-MIT.txt`; file map identifies modified scaffolds |
| npm lockfile dependencies | 121 declarations: MIT, ISC, BlueOak-1.0.0, Apache-2.0, 0BSD and Unlicense; actual dependency license/NOTICE files remain applicable |
| AndroidX | Apache-2.0, subject to the exact artifact's notices |
| JUnit 4.13.2 | EPL-1.0, test tooling; not part of the intended production APK |
| org.json 20250517 | Selected upstream version declares public domain |
| Node/Debian/PHP/Nginx/OpenSSL and transitive packages | Independent runtime/package terms; retain required notices and inventory any binary release |

Publishing this source repository does not distribute a complete built image or
APK. If distributing those later, inventory the resolved packages and provide
required notices and corresponding source. A link to an upstream project alone
must not be assumed to satisfy every binary/source-offer obligation.

- [SnappyMail source and license](https://github.com/the-djmaze/snappymail)
- [SnappyMail installation](https://github.com/the-djmaze/snappymail/wiki/Installation-instructions)
- [Purelymail protocol settings](https://purelymail.com/docs/setup/technical)
- [Purelymail API](https://news.purelymail.com/api/index.html)
- [SFTPGo source](https://github.com/drakkan/sftpgo)
- [Node.js release status](https://nodejs.org/en/about/previous-releases)
