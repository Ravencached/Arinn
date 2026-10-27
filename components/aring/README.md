# Áring

Independent private calendar/reminder service and offline web/Android client.
The [suite install spec](../../docs/INSTALL.md) covers accounts, Compose,
native/systemd installation, HTTPS and authenticated backups.

For local Node.js 24 development: `npm ci`, `npm test`, `npm run build`,
`npm start`. Normal startup binds loopback and provisions no accounts. The
database defaults to ignored `runtime/aring.sqlite`.

`node scripts/demo.mjs` uses an in-memory database only. Its two synthetic
accounts are `alice@example.test` and `bob@example.test`, both with
`local-demo-aring-2026`. Stop the process to discard server state; clear browser
demo cache before restarting. These are never production accounts.

See the [behavior and naming notes](../../docs/NOTES.md) for recurrence,
Family membership, offline conflict behavior and Android notification limits.
Backups need independently protected keys and verified off-host copies.
