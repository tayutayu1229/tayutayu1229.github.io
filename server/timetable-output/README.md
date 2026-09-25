# Timetable output service

Production source for `https://train.tayunet-traininfo.com/`.

- Every timetable and PDF request requires a Firebase ID token approved by the private timetable API.
- `/api/timetables` reads the complete manifest-backed private timetable bundle.
- `/api/workbase` reads the canonical public Workbase JSON and caches it for one hour.
- `/import` resolves the submitted key back to canonical private data before generating a PDF.
- Generated Google Sheets are deleted after PDF export.

Private timetable JSON may include the following optional display fields:

- `footnotes`: an array of lines printed unchanged at the lower-left of the timetable, for example `["列車防護係員省略", "その他の付記"]`. The legacy multiline `footnote` string is also accepted.
- Each `stops[]` item may include `trainType` when the train type changes at that station.
- Each `stops[]` item may include `operationInfo`, `operationTrainNumber`, and `operationKid`. This allows operation information at intermediate stations as well as the legacy endpoint fields `tt1/tr1/kid1` and `tt2/tr2/kid2`.
- `operationInfo` accepts the legacy values `k` and `o`, plus `継走`, `折返`, `分割`, `併合`, `入区`, `出区`, `引上`, `据付`, `滞泊`, `車交`, and `特発`.

`credentials.json` is intentionally not stored in this repository. Production keeps it beside `app.js` with mode `0600`.

The live PM2 process is `timetable-app`, bound to localhost port 5000 and exposed only through Cloudflare Tunnel. The pre-change production copy from this deployment is stored at `/home/yoshi/timetable-app-backup-20260822-2345`.
