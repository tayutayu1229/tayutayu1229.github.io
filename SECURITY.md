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
