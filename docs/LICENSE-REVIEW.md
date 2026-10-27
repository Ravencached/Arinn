# Public-release license review

Reviewed 2026-10-27 against the 189-file handoff. This is a license recommendation
and inventory review, not complete copyright clearance. The owner subsequently
approved this policy on 2026-10-27; the operative grant and scope are in
[LICENSING.md](../LICENSING.md). Previously generated ZIPs remain unchanged.

## Recommendation

Use **AGPL-3.0-or-later** for original application code, plugins, scripts and
configuration that the project owner has the right to license. Retain all
third-party licenses and notices unchanged. Give documentation and cleared
illustrations explicit terms, preferably **CC BY 4.0**, with a path-based asset
manifest. The owner has confirmed the project artwork's origin, and the adopted
grant now covers the image paths recorded in the map, to the extent rights exist.

This policy suits a community-maintained family server: others can run, modify,
redistribute and commercially use the code, while covered modified versions
served over a network must offer corresponding source to their remote users.
It does not require publication of passwords, private mail, user files or other
application data. It does not prohibit charging for hosting or support.

AGPL is a recommendation for the original code, not a conclusion that simply
running these independent services together makes every component AGPL. Section
5 of the license distinguishes independent aggregates from combined works.
The RainLoop/SnappyMail plugin integration deserves particular attention because
it subclasses the upstream plugin class and uses its internal hooks.

The alternative, if unrestricted commercial reuse of independent original code
is the main priority, is Apache-2.0 for that independent code and AGPL-compatible
terms for the SnappyMail integration. That adds component-level distinctions.
Choosing Apache or MIT cannot remove obligations on upstream covered code.

## Findings by component

| Material | Evidence reviewed | Public-release treatment |
|---|---|---|
| SnappyMail 2.38.2 | Tagged upstream license is AGPLv3; release is downloaded during build/install | Preserve its license, attribution and corresponding-source obligations for distributed covered builds |
| Ratataskr UI/plugin and PHP integration | Plugin extends `RainLoop\\Plugins\\AbstractPlugin`; original code lacks explicit project license headers | Recommend AGPL for original contributions; check any adapted upstream portions and restore applicable notices |
| SFTPGo 2.7.6 | Tagged upstream license is AGPLv3; custom image derives from upstream | Preserve upstream terms; Docker packaging does not waive them |
| Drive Python/PowerShell helpers and prototype | Separate source/configuration communicating with SFTPGo | AGPL is a coherent project choice; ordinary API integration alone does not establish derivative-work status |
| Aring Node/browser/native Java source | Custom source, npm lockfile and Gradle declarations | Recommend AGPL for original work; preserve dependency/template notices separately |
| Capacitor and generated Android scaffold | Selected Capacitor license is MIT; scaffold/template files are present | Include Drifty/Capacitor notices for copied or substantially adapted portions |
| npm dependencies | All 121 non-root lockfile entries declare a license | Metadata inventory below; preserve actual package license/NOTICE files in redistributed builds |
| AndroidX | Upstream project uses Apache-2.0 | Preserve applicable notices; inventory the exact resolved Android release dependencies before publishing APKs |
| JUnit 4.13.2 | Tagged license is EPL-1.0 | Test dependency, not ordinary application runtime; keep its terms if redistributing it and keep test tooling separate from the shipped app |
| org.json 20250517 | Tagged upstream license says public domain | Record the selected version/provenance; do not assume older JSON-java license history applies |
| Docker OS/runtime packages | Debian, Node, PHP, Nginx, OpenSSL and transitive packages installed during builds | Their own terms remain; a source-repo review is not a complete container license inventory |
| Purelymail and Tailscale | External provider/network integrations, not bundled service source | Their service terms and branding are separate from this repository's code license |
| Documentation | No project-wide license currently granted | Recommend CC BY 4.0 for original documentation, with an explicit path rule |
| Artwork | 35 PNG and 6 SVG paths, including generated Android variants | Asset-by-asset provenance/permission review still needed; counts are paths, not unique original works |

The lockfile declares 95 MIT, 12 ISC, 10 BlueOak-1.0.0, 2 Apache-2.0, 1 0BSD
and 1 Unlicense package. No non-root entry lacks license metadata. These are
permissive declarations, not verification of every file in every downloaded
tarball or a guarantee about unlisted embedded material.

The Android inventory is limited to source/build declarations and selected
upstream licenses. A resolved dependency/notice inventory for a release APK,
and a package inventory for published container images, remain release work.
In particular, the permissive npm inventory does not describe the separate
EPL-licensed Java test dependency.

## Artwork and attribution

`components/yggdrive/prototype/assets/Ygg-character-prompt.md` records image
generation for the Ygg guardian. The same guardian appears in the Windows helper.
This is useful provenance, not proof of exclusive copyright or trademark rights.
The owner subsequently confirmed all project branding images were created for
the project using image generation. [ARTWORK.md](ARTWORK.md) records that
confirmation and the derivative paths. This is an owner-supplied provenance
record, not an independent guarantee of exclusive rights.

Before granting reuse rights, record each source asset, creator/source, whether
it was generated or adapted, the applicable permission/license, and derivative
paths. For an uncertain asset, establish its provenance or replace it with an
asset cleared for the intended use. A project license does not cure missing
third-party rights. Document branding/endorsement policy separately from code
reuse; permission to fork should not imply official affiliation.

## Source release and future binary release practices

For this source release, full license texts, an explicit file map, retained
Capacitor notices and owner-confirmed artwork provenance are now present.
The following practices also apply to future contributions and binary releases:

1. Confirm the copyright holder's chosen public attribution and rights to the
   material being licensed. Preserve other authors' notices.
2. Add the full license text and a clear scope statement. Use SPDX identifiers
   on original code where practical. Upstream files retain their own exact terms;
   do not silently upgrade them to an "or later" grant.
3. Replace the current private-evaluation paragraph in `THIRD-PARTY.md` and add
   actual third-party license/notice texts for redistributed copied material.
4. Add the artwork manifest and explicit documentation/art terms. Resolve or
   replace uncertain assets before publicly distributing them.
5. For released images/APKs, collect exact dependency versions, licenses and
   notices. Supply corresponding source where required; the repository alone
   must not be assumed to contain all upstream source for a binary release.
6. Keep JUnit/test tooling outside the production APK and check the release's
   actual packaged contents. Keep source publication and binary compliance
   records distinct.

The owner approved the reciprocal AGPL recommendation for original code, CC BY
4.0 for original documentation/artwork, and preservation of upstream terms.
License texts and the source file map have been added. Binary release inventory
and corresponding-source compliance remain specific to each future image/APK.

## Sources

- [SnappyMail 2.38.2 license](https://github.com/the-djmaze/snappymail/blob/v2.38.2/LICENSE)
- [SFTPGo 2.7.6 license](https://github.com/drakkan/sftpgo/blob/v2.7.6/LICENSE)
- [AGPLv3 text and overview](https://choosealicense.com/licenses/agpl-3.0/)
- [Apache-2.0 text and overview](https://choosealicense.com/licenses/apache-2.0/)
- [Capacitor 8.5.3 license](https://github.com/ionic-team/capacitor/blob/8.5.3/LICENSE)
- [AndroidX license](https://github.com/androidx/androidx/blob/androidx-main/LICENSE.txt)
- [JUnit 4.13.2 license](https://github.com/junit-team/junit4/blob/r4.13.2/LICENSE-junit.txt)
- [JSON-java 20250517 license](https://github.com/stleary/JSON-java/blob/20250517/LICENSE)
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
