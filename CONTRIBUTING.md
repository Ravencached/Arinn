# Contributing to Arinn

Keep changes focused on independent family installations and explain their user
or operator benefit. Discuss large changes before implementation. Treat native
mail tools, Android and Windows helpers as advanced paths; the recommended
home/storage deployment should remain understandable and independently usable.

## Before a pull request

1. Describe the concrete behavior changed, the component/role affected and how
   you tested it. Distinguish source tests from real provider/device testing.
2. Use synthetic fixtures. Never commit credentials, live configuration, real
   emails, private domains, mailbox exports, file content or signing keys.
3. Run the checks relevant to the change. Source/policy checks are:

   ```sh
   python3 scripts/review_export.py
   python3 scripts/review_history.py
   python3 scripts/check_licenses.py
   python3 scripts/check_docs.py
   python3 -m unittest discover -s tests -v
   ```

   Calendar checks are `npm ci --ignore-scripts`, `npm test`, and `npm run build`
   in `components/aring`. Mail PHP checks and the actual container integration
   are documented in [validation](docs/VALIDATION.md) and `.github/workflows/ci.yml`.
4. For new files, add exact paths to the appropriate group in `REUSE.toml`.
   Original code is AGPL-3.0-or-later; original docs/art are CC BY 4.0. Preserve
   upstream notices and record the source/permission of added artwork. Do not
   apply project terms to code you do not have permission to contribute.
5. Document configuration, state or migration changes. Preserve existing data
   and avoid changing internal volume names as a cosmetic rename.

By submitting a contribution, you confirm you have the right to contribute it
under the applicable project license. No ownership transfer is requested. Code
and documentation contributions retain the distinct license scopes described
in [LICENSING.md](LICENSING.md). A GitHub noreply address can keep your private
email out of commit metadata. The history check currently accepts GitHub noreply
addresses (including GitHub automation) and reserved fixture addresses. Use your
GitHub noreply address for contributions; agree any other intentional public
identity with the maintainer before changing the scanner policy.

Use [SECURITY.md](SECURITY.md) for vulnerabilities rather than public pull
requests. There is no commitment to accept every feature or support every
deployment platform. The package's limitations should stay visible and accurate.
