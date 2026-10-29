# GMPI Document Automation  (v2.0)

Generates **Official Price Lists** and **Price Increase Notices** from a form or from your Excel/CSV files — live preview,
browser printing, genuine editable **.docx** and real **A4 PDF** — with saved records, reference numbers, edit history,
search, backups and (optionally) logins so it can run online.

> **Version 2.1 — online-ready.** The same program now runs as a secure website (Render + PostgreSQL) that works on phones, tablets and PCs.
> Start with **`DEPLOY.md`** (step-by-step, beginner level) and **`MOBILE-TEST-CHECKLIST.md`**. Document layouts, calculations and the
> Official Price List are unchanged from 2.0. The PC (Windows) way of running it, described below, still works exactly as before.

> **Read first — what is and is not verified.** See `TESTING.md` for exactly what was tested. In particular: the Price Increase
> Notice layout/wording is **provisional** (that template was never received), the Excel importer was tested on **synthetic**
> workbooks built from your column names (your real workbooks were never received), and **nothing has been deployed to a public
> URL** — see `DEPLOY.md` for the remaining steps that need your hosting account.

## 1. Run it on your Windows PC (local mode)
1. Install **Node.js 22 LTS** (22.13 or newer 22.x — it has SQLite built in, so there is nothing else to compile or download) from https://nodejs.org (once).
2. Unzip to e.g. `C:\GMPI-Docs`. Double-click **install.bat** (once; downloads packages from the npm registry).
3. Double-click **start.bat** — the browser opens http://localhost:3000. Keep the black window open.
   **Other PCs on the office network:** see `NETWORK-ACCESS.md` (run `allow-network-access.bat` once as administrator; the start window prints the address, e.g. `http://192.168.1.25:3000`). Login is required for network use.
4. **No more manual starting:** double-click **install-autostart.bat** once. The app then starts silently every time you sign in to
   Windows; just open http://localhost:3000 (or `open-app.bat`). Remove it with `uninstall-autostart.bat`.

```
cd C:\GMPI-Docs
npm install
npm start
```

### Where your records live (and why they used to "disappear")
Records are stored in a real database file **outside the program folder**:
`%LOCALAPPDATA%\GMPI-Document-Automation\gmpi.db` (Windows) — so unzipping a new version, moving the folder or re-running
`install.bat` can **never** delete them. (The first version kept drafts inside the program folder, so replacing the folder lost them.)
Records saved by the first version (`data\drafts\*.json`) are **imported automatically** the first time v2 starts, once, without overwriting anything.
Change the location with `dataDir` in `config.json` or the `GMPI_DATA_DIR` environment variable.

## 2. Using it
* **Pick a type → fill in the form → Save Draft.** Each document gets a reference number (`PL-2026-0001`, `PIN-2026-0001`).
* **Import Excel / CSV** (see §3). Review, edit, confirm.
* **Preview** (full-width; *Exact PDF view* shows real pagination) · **Print** · **Download Word** · **Download PDF**.
  Downloading saves the document first and **keeps a copy of the generated file** (Versions & files → Download again).
* **Saved drafts & history:** search (customer, reference no., product, principal), open, duplicate, delete; **Versions & files**
  shows every saved version (restore any into the editor) and every generated Word/PDF.
* **Saving never overwrites newer work:** if the document was changed in another tab/computer you are told and can save yours as a copy.

## 3. Excel / CSV import
Supports `.xlsx .xlsm .xlsb .xls .ods .csv .tsv`. The wizard:
1. Lists every worksheet and pre-selects the one whose headers match best (you can change it).
2. Finds the real header row under title/blank rows (also headers spread over 2–3 rows). Click any row number to choose another.
3. Matches columns **by header meaning, not position** (a file's own “Item No.” column is recognised but its values are replaced by the automatic numbers — non-numeric ones like `TI-123` are flagged; map such a column to *Item Description* if it is a product code) (e.g. “Old Wholesale Net Price”, “GMPI Effectivity Date”, “Item No.”) and lets you correct each column; unmapped columns that contain data are reported, never silently dropped.
4. Shows **every** row for review: invalid rows are listed with the reason and cannot be imported until corrected (edit the cell) — you must acknowledge any that you leave out. Duplicates (within the file or already in the document) are flagged and unticked. Re-selecting a workbook you already imported warns you.
5. Reads real Excel data: merged cells (e.g. Principal) are filled down, hidden columns/rows are flagged and included, formulas use Excel’s saved result (a formula with **no** saved result is reported, not invented), Excel dates become “Month DD, YYYY”, a zero date (Excel’s “1/0/1900”) becomes blank, leading zeros in text and zero-padded numeric codes/barcodes are kept, 13-digit barcodes and 26.54 % are never rounded.
6. **Price Increase Notice:** `% Increase` is calculated from old/new price **only** when the row has no valid percentage (optional tick-box, always flagged ℹ in review). A bare `0.05`/`5` is never guessed — it is flagged unless you choose “fractions” or “whole percents” for the file.
7. Finishes with an **import report**: file, worksheet, header row, rows detected, valid rows imported, skipped rows with reasons, column mapping, document fields filled (Principal / effectivity only when they were empty).
Limits: 100,000 rows × 200 columns per sheet; a larger sheet is **refused with a clear message** — never half-imported. The editor shows 200 rows per page; all rows are saved, printed and exported.
Prices accept `1234`, `1,234.50`, `PHP 1,234.50`; anything else (e.g. `1.470,00`) is flagged, never converted. Percentages need a `%`.

## 4. Accounts and online use
* **Local mode (default on your own PC):** no login — the server only listens on this computer (`127.0.0.1`).
* **Login mode** turns on automatically when you set `DATABASE_URL`, `NODE_ENV=production`, or a non-local `HOST`; or force it with `AUTH_REQUIRED=true`.
  Roles: **admin** (everything, users, backups) · **editor** (create/edit/export) · **viewer** (read, download, print).
  Passwords are stored as salted scrypt hashes; sessions are HttpOnly cookies; failed logins are rate-limited. There is **no default password**:
  the first admin comes from `ADMIN_USERNAME` / `ADMIN_PASSWORD` (≥10 chars). Add users in the app (**Users**) or `npm run create-user -- name editor`.
* **Approver names** (Prepared/Approved/Acknowledged) that have template defaults stay locked until unlocked with `signatoryPin` (`config.json` / `SIGNATORY_PIN`; **change the default `gmpi-admin`** — online mode refuses to start with it).
* Full step-by-step for a public website: **`DEPLOY.md`**. Database design: `docs/schema.sql`.
* **Online safety rules built in:** production mode refuses to start without `DATABASE_URL` (no temporary storage) or without a private `SIGNATORY_PIN`; the API needs login; large uploads are only accepted after login; other websites cannot send requests to it; admin recovery without a shell via `ADMIN_RESET` (see `DEPLOY.md` Part 6).
* **Moving PC records online:** admin → **Backup → Add records from a backup file** (only adds; never deletes/overwrites; never imports user accounts).

## 5. Backups and restore
* Local mode writes an automatic **daily backup ZIP** to `%LOCALAPPDATA%\GMPI-Document-Automation\backups` (last 14 kept). **Backup** (admin) in the app shows status and downloads a full backup any time. `npm run backup` makes one on demand.
* A backup ZIP contains all documents, every saved version, generated files and users. **It is confidential — store it privately.**
* **Restore** (replaces everything in the current database; a `gmpi-before-restore-…zip` safety copy is written first):
  ```
  npm run restore -- C:\path\to\gmpi-backup-20261027-110831700.zip
  ```
  then type `RESTORE`. For an online PostgreSQL install, run the same command with `DATABASE_URL` set.
* Copy the backup folder to another drive or cloud storage regularly — a backup on the same disk does not protect against a dead disk.

## 6. Layout / exports
* **Official Price List table:** `Item No. | Item Description | Packaging | GENERIC NAME | SRP | Discount | Trade Price W/ VAT (PHP) | Barcode`. **Item No.** is numbered automatically (1, 2, 3 … over the product rows; blank rows get no number) in the editor, import review, preview, print, Word and PDF. The old **Packing** column is removed; if a workbook still has one, the import tells you it was not imported. Drafts saved with the old table open in the new layout (their Packing text is not shown; earlier saved versions in *Versions & files* still contain it).
* **Word**: your original `SANTE BARLEY.docx` package is the base (logo, footer artwork, styles, A4 margins); header row repeats on every page, rows never split.
  The Price List signature block shows two approvers at opposite margins (Evona Paula Mariquit left, Rashel L. Nacor right); the Notice keeps three blocks.
* **PDF**: generated by the server (pdfmake), same margins/colours/widths. **Print** uses the browser dialog and prints only the document.
* All 8 table columns can be resized (width % box or drag in the preview); widths carry into Word, PDF and print.
* In the Notice, the optional **Packaging** column is left out of the document when no row has packaging data.

## 7. Commands
`npm start` · `npm test` · `npm run backup` · `npm run restore -- <zip>` · `npm run create-user -- <name> [admin|editor|viewer]` · `npm run reset-password -- <name>` · `npm run users` · `npm run status`
Backend integration test against a real database: `node server/test-backend.js` (SQLite) or `DATABASE_URL=postgres://… node server/test-backend.js`.

## 8. Known limitations
* Dependency note: the Excel reader (`xlsx` 0.18.5, SheetJS community edition) has published, unfixed-on-npm security advisories (prototype pollution / ReDoS when reading a *maliciously crafted* workbook). Only signed-in **admin/editor** accounts can upload files, so give those roles only to trusted staff. Upgrading the reader would risk changing how your files import, so it was left as is.
* Phones cannot show a PDF inside a web page, so the *Exact PDF view* switch is hidden on small screens; use **Download PDF** there.
See `TESTING.md` §Limitations. Highlights: provisional Notice template; real workbooks untested; not deployed; Windows install of the SQLite native module and the auto-start scripts untested on Windows; PDF cells are top-aligned (Word centres them).
