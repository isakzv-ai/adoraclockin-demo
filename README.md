# Clockwise time-tracking demo

A static, client-side clock-in/out prototype. The hosted demo uses only synthetic employee records. The real employee CSV is not part of the demo bundle.

## Run locally

From this directory:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open <http://127.0.0.1:4173/>. The app loads `data/demo-timesheet.csv` on first visit and saves edits in that browser’s localStorage. Try clock in/out, **Needs review**, editing a flagged shift (add a reason), employee CSV import, and CSV export.

## Demo data and privacy

`data/demo-timesheet.csv` is fabricated test data. Local employee imports are ignored by Git. Do not force-add or publish employee attendance data. The GitHub Pages site is intended to be publicly viewable but contains only synthetic records.

## Important limitations

This is a front-end prototype: there is no server, employee authentication, role separation, or cross-device sync. localStorage is not a reliable source for payroll or legal records. Before live use across personal phones and a shared clock-in device, add a secured shared backend, employee authentication, manager permissions, backups, and an approval trail.

## Correction notes

Saving a record keeps its existing notes. A new correction reason is appended to
those notes and recorded in audit history, including when only a note is added.
Changing a date or time still requires a new reason.

To check this behavior locally, install Playwright for Python and its Chromium
browser, start the local server above, then run:

```sh
python3 tests/test_shift_notes.py http://127.0.0.1:4173/
```

The check uses synthetic records in isolated browser contexts at phone and desktop widths.
