# Publishing Arinn

Target: `Ravencached/Arinn`, public source repository. Initial version:
**0.1.0 experimental**. Initial source publication was approved and pushed on
2026-10-27. Private reporting, secret scanning/push protection, dependency alerts
and restricted Actions permissions are enabled. This document retains the
repeatable publication procedure and branch/release requirements.

## Prepared source

Use the clean `Arinn` checkout prepared from the sanitized source tree. It has
its own `main` branch and initial commit, without importing the original app
repositories or earlier handoff history. Run source checks from that directory:

```sh
python3 scripts/review_export.py
python3 scripts/review_history.py
python3 scripts/check_licenses.py
python3 scripts/check_docs.py
python3 -m unittest discover -s tests -v
```

The publication identity is `Ravencached`, using GitHub's public noreply address
`200016995+Ravencached@users.noreply.github.com`. This is intentionally public
GitHub attribution, not a private contact address. Project-wide existing
attribution remains Selfhost Suite contributors as documented in `LICENSING.md`.

History scans inspect every reachable blob/commit/tag and flag non-placeholder,
non-GitHub-noreply commit addresses. The deterministic rules do not prove absence
of every identifying detail or secret. The preparation also compares against
known private material locally; those private comparison values are not shipped.
Never push the original working directories or their Git histories instead.

## Publication and remote settings

Publication requires the owner's final approval of the prepared source. There
is no remote credential or automatic publishing token in this repository.
If using the official GitHub CLI after approval, from the clean checkout:

```sh
gh auth status
gh repo create Ravencached/Arinn --public --source . --remote origin --push \
  --description "Experimental modular family self-hosting: mail, calendar and independent storage"
```

Check whether the repository name exists before creating it. Do not replace or
force-push an existing repository. A connected source-reading GitHub app alone
does not necessarily have repository creation/admin permissions.

Before announcing the repository, complete these settings as its administrator:

- Enable [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).
  Confirm the form linked in `SECURITY.md` actually works.
- Enable GitHub secret scanning/push protection and dependency alerts where
  available for the account/repository. Existing scans are not a replacement.
- Set Actions workflow permissions to read-only and prohibit Actions from
  approving pull requests. The supplied workflow also requests only contents read.
- Require approval before running workflows from outside contributors, according
  to the repository's Actions settings. Use GitHub-hosted runners, not a family
  machine or a runner with access to private networks/production credentials.
- After the initial Actions run passes, protect `main` against force pushes and
  deletion and require the three checks: **Source and policy checks**,
  **Calendar and browser source**, **Disposable home and storage integration**.
  Configure pull-request review rules appropriate to the actual maintainer team.

The workflow runs on pushes to `main`, pull requests and manual dispatch. Actions
are pinned to full commit IDs and checkout does not persist credentials. Test
jobs use no production secrets. Disposable diagnostics are not uploaded because
they can contain synthetic bootstrap credentials. Dependabot proposes npm and
Actions updates; native package floors and Docker digest updates remain reviewed
maintainer work. Local test results are not a hosted Actions result.

## First release

Wait for hosted checks to pass. Then tag the reviewed commit and publish a source
release labelled experimental, carrying the license texts and notices. Do not
mark it stable or describe it as an exact replica of an existing installation.
Keep the tested/unverified boundaries in `START-HERE.md` and `docs/VALIDATION.md`.
Built container images and APKs require their own dependency/license inventory,
corresponding-source arrangements and, where applicable, signing process.

Physical two-computer routing, live Purelymail acceptance, operator-only admin
access, MFA enrollment and a complete off-host restore remain deployment work.
Their absence does not change the experimental source license; it limits the
deployment claims and support scope.
