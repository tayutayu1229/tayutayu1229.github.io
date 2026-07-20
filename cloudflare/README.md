# ODPT proxy deployment

This Worker removes ODPT credentials from browser-delivered files.

1. Create a Worker named `tayunet-odpt-proxy` and paste `odpt-proxy.js`.
2. Add Worker secrets (not plain text variables):
   - `ODPT_STANDARD_TOKEN`
   - `ODPT_CHALLENGE_TOKEN`
3. Add the route `tayunet-traininfo.com/api/odpt/*`.
4. Publish the Worker.
5. Change every browser call to the matching same-origin URL:
   - Challenge API: `/api/odpt/challenge/...`
   - Standard API: `/api/odpt/standard/...`
6. Rotate the old ODPT credentials after the site has been verified.

The Worker deliberately accepts only `odpt:`, `gtfs/`, and `files/` resources,
removes any credential supplied by a caller, and injects the appropriate secret
only when contacting ODPT.
