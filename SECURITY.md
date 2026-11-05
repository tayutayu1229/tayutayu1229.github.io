# Security operations

## Firestore rules

`firestore.rules` is the source copy of the rules published in the Firebase
console. The rules protect the user-approval workflow: new users cannot create
an administrator record, and only administrators can list users or access the
finance collections.

## Public browser credentials

Firebase web configuration values are designed to be public; their protection
comes from Firebase Authentication, Firestore rules, authorised domains, and
API restrictions.

The ODPT consumer credential currently appears in browser-delivered pages. A
credential embedded in a static site cannot be kept secret. Move ODPT requests
behind a Cloudflare Worker, store the replacement credential as a Worker secret,
then revoke and reissue the currently exposed credential at ODPT.

## Ubuntu managed databases

Incident, legacy accounting, and vehicle-operation data are served by the Ubuntu
managed database API. Firebase login and current Firestore approval are required;
writes and all legacy accounting access require administrator approval.
The browser receives no database password or internal service-role token.
Original Supabase SQL and backups are historical recovery material, not current
deployment instructions. Do not re-enable the old external notification trigger.

## Public JSON classification

- `T-time/timetables*.json`, `T-time/timetables-manifest.json`, and `T-time/station.json` are private and must never
  be published again. CI rejects them.
- `unnyou/data.json` and `JREgyoumu/workdata/workbase.json` remain public until
  their owners classify them; do not add personal data or credentials to them.
- `JREgyoumu/JRchr/incidents.json` is a legacy public snapshot. The live system
  uses the Firebase-protected Ubuntu API, so it should be removed after confirming no consumer needs it.
