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

## Supabase incident policies

The browser anon key is not an administrator credential. Apply
`supabase/incidents-rls.sql` in the Supabase SQL editor so authenticated users
can read incidents while only the two incident administrator accounts can
insert, update, or delete them. Keep the existing login IDs and passwords in
Supabase Authentication; do not store passwords in this repository.

## Public JSON classification

- `T-time/timetables.json` and `T-time/station.json` are private and must never
  be published again. CI rejects them.
- `unnyou/data.json` and `JREgyoumu/workdata/workbase.json` remain public until
  their owners classify them; do not add personal data or credentials to them.
- `JREgyoumu/JRchr/incidents.json` is a legacy public snapshot. The live system
  uses Supabase, so it should be removed after confirming no consumer needs it.
