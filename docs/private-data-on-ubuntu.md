# Moving editable data off public GitHub Pages

## What a server can and cannot hide

If an unauthenticated browser needs a JSON file to render a public page, that
browser can always view the downloaded JSON. Moving the file to Ubuntu hides it
from the public GitHub repository, but does not make a public response secret.

## Recommended arrangement

Use a **private GitHub data repository** for collaborator editing and deploy its
`data/` directory to Ubuntu with GitHub Actions and a restricted SSH deploy key.
The public Pages repository keeps only the UI. Ubuntu (Nginx) serves selected
public JSON under a dedicated data hostname or `/data/` path.

For data that must also be hidden from site visitors, expose an authenticated
API instead. The API should verify the Firebase ID token and return data only to
approved users; the JSON must not be copied into GitHub Pages at all.

## Migration order

1. Inventory every JSON file: public, authenticated, or private.
2. Create the private data repository and give collaborators write access there.
3. Add a GitHub Actions deployment key with access only to a dedicated Ubuntu
   deploy account.
4. Deploy a copy to Ubuntu and switch one page at a time to its new endpoint.
5. Verify each page, then remove the source JSON from the public repository.

This preserves GitHub-based collaboration while keeping the published UI and
the editable data separate.
