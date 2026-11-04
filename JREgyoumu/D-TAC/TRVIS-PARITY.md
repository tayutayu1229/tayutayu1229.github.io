# D-TAC / TRViS comparison

Reference: TetsuOtter/TRViS main at the revision recorded in TRVIS-NOTICE.md.

Compared against the iPad mini Japanese light/dark screenshots, DTACElementStyles,
VerticalStylePage, PageHeader, VerticalTimetableColumnVisibilityState,
MarkerButton, SelectMarkerPopup, VerticalTimetableRow, and formatter/layout logic.

## Implemented in the existing web viewer

- Full viewport instead of a fixed 768×1024 canvas scaled down on phones.
- TRViS table widths and visibility thresholds: 568/667/736/744/768 px.
- TRViS light/dark colors, header, tab underline, typography and row heights.
- Train number, maximum speed, speed type, traction capacity, car count and destination.
- Expand train information and before-departure instructions without removing the summary.
- Timetable seconds, brackets, pass arrow, end mark, next-day hours, runtime overflow,
  information rows, separate arrival/departure tracks and entry/exit limits.
- Header marker mode, 5 colors, 2 fullwidth/4 halfwidth text limit, row tint,
  click-to-mark/remove, and storage per service date and train.
- Work overview (ハコ), diagram toggle, train selection and next-train button.
- Explicit GPS enable/disable with station coordinates, manual movement when unavailable,
  cleanup on stop/unload, and an error notice on permission/position failure.
- Existing authenticated documents, attachment search and file viewer are retained.

## Data prerequisites and remaining differences

The existing site feed is not a TRViS database. Optional functionality only appears
when its source data exists; no real timetables or coordinates have been invented.

| Optional source field | Behavior |
| --- | --- |
| `workId` (shared, same `startDate`) | Collects the work's trains, enables cross-train Hako and next train. Without it, Hako shows only the selected train. |
| `workName`, `workGroupName` | Work and group labels. |
| `maxSpeed`, `trainInfo`, `beforeDeparture`, `afterRemarks`, `afterArrive` | Additional summary/instructions. |
| `horizontalTimetable` | Electric timetable button; URL or a document descriptor supported by the existing document service. |
| stop `latitude`/`longitude` (also `lat`/`lon`/`lng`) | GPS linkage; disabled without coordinates. |
| stop `isInfoRow`, `isPass`, `driveTimeMM`, `driveTimeSS` | Explicit information rows/passing/runtime overrides. |
| stop `arrivalTrack`, `departureTrack`, `runInLimit`, `runOutLimit` | Separate track/limit values. |

The web page retains Tokyo transport system branding, existing authentication and
its document service. OS status bars, native popovers, the TRViS watermark, native
SQLite/JSON file selection, and TRViS external NetworkSync/AppLink transport are
not reproduced. The Hako diagram is a web adaptation; all native diagram features
and full visual/pixel parity have not been established. Existing protected document
access, actual GPS travel and multi-train work feeds still require integration QA
with authenticated real data. Do not describe this change as complete TRViS parity.

## Verification

- `node --test tests/dtac-logic.test.cjs`
- `node tests/authored-timetable-consumers.test.js`
- `node tests/timetable-consumers.test.js`
- Existing syntax, site-link, UI-action and XSS audits.
- Browser QA with synthetic data: 320, 375, 568, 667, 736, 744, 768 px;
  run/step, marker apply and persistence, Hako selection, expansion, remarks, theme.

Synthetic browser fixtures stay outside this repository and are not deployed.
