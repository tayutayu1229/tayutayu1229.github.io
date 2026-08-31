# Timetable output service

Production source for `https://train.tayunet-traininfo.com/`.

- Every timetable and PDF request requires a Firebase ID token approved by the private timetable API.
- `/api/timetables` reads the complete manifest-backed private timetable bundle.
- `/api/workbase` reads the canonical public Workbase JSON and caches it for one hour.
- `/import` resolves the submitted key back to canonical private data before generating a PDF.
- Generated Google Sheets are deleted after PDF export.

`credentials.json` is intentionally not stored in this repository. Production keeps it beside `app.js` with mode `0600`.

The live PM2 process is `timetable-app`, bound to localhost port 5000 and exposed only through Cloudflare Tunnel. The pre-change production copy from this deployment is stored at `/home/yoshi/timetable-app-backup-20260822-2345`.
