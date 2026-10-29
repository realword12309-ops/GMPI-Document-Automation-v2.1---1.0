# Version 2.1 (online deployment) — what was tested in this round

Environment: Linux sandbox, Node 22.23, PostgreSQL 16.15, headless Chromium (Playwright, device emulation for iPhone 13, Pixel 5, iPad, 1366×768 desktop). **Not deployed to Render/GitHub (no access); no real phone or Windows PC was used.**

| Check | Result |
|---|---|
| `npm test` (importer, validation, Word + PDF generation for both document types) | 16 / 16 |
| `node server/test-backend.js` on SQLite | 23 / 23 |
| same on PostgreSQL 16 (production engine) | 22 / 22 (legacy-file migration is SQLite-only) |
| Production mode started like Render does (`NODE_ENV=production`, assigned `PORT`, `DATABASE_URL`, secrets from environment, `node server/index.js`) from a clean checkout of only the files GitHub would hold + `npm ci --omit=dev` | starts; `/healthz` ok; login required; admin created from env |
| Refuses to start online without `DATABASE_URL`, without `SIGNATORY_PIN`, or with the default PIN | verified |
| Browser e2e (login, wrong password, import Excel, save, preview, Word + PDF download, history, Users, Backup dialogs, reload, sign-out) on iPhone 13, Pixel 5, iPad and desktop viewports; no horizontal page scrolling on any screen | 36 / 36, no console errors (the one 401 per run is the deliberate wrong-password try) |
| Records persist: 14 documents + 36 generated files survived a server restart (graceful SIGTERM shutdown) in PostgreSQL | verified |
| Move PC records online through the Backup dialog (real SQLite backup from the ORIGINAL 2.0 app → online PostgreSQL): added 2 documents + 4 generated files, renumbered 2 clashing reference numbers, second run added 0, no users imported | verified |
| Emergency `ADMIN_RESET`: old password rejected, new accepted, other sessions ended | verified |
| **Official Price List / Price Increase Notice unchanged:** the same inputs were run through your original 2.0 app and 2.1 side by side: Word `document.xml` identical, PDF text and page counts identical (2 and 7 pages), live-preview sheet pixel-identical; `shared/gmpi.js`, `docx-gen.js`, `pdf-gen.js`, `importer.js` and the Word template are byte-identical to the original; the original CSS is untouched (responsive rules were only appended) | verified |

## What changed in 2.1 (everything else is as in 2.0)
* `server/index.js`: online start-up (listens on Render’s `PORT`, all interfaces), refuses production without `DATABASE_URL`, graceful shutdown, keep-alive tuning, big uploads only accepted after login, merge-import endpoint, quieter 4xx logging.
* `server/auth.js`: `ADMIN_RESET` recovery. `server/store.js` + `backup.js`: non-destructive merge import; restoring a backup that contains no users no longer deletes the online accounts.
* `server/db.js`: TLS auto-detected for Render addresses. `server/config.js`: online host default.
* `public/style.css` (appended responsive rules only), `public/index.html` (theme colour, icon), `public/app.js` (backup-import button).
* New/updated: `render.yaml`, `.env.example`, `.gitignore`, `DEPLOY.md`, `MOBILE-TEST-CHECKLIST.md`, package version/engines (Node 22), `body-parser` security update in the lock file.

## NOT verified in this round
* An actual Render deployment, the public URL, HTTPS/custom domain, Render’s Blueprint screen and plan prices on your account (plan names and prices were read from Render’s documentation on 28 Oct 2026).
* A real iPhone/Android device, Safari specifically, Microsoft Word / Adobe Reader opening the files, a printer.
* The Docker image build (no Docker daemon in the sandbox).
* Your real Excel workbooks (still only synthetic and the two sample files).
* Remaining known advisory: SheetJS `xlsx` (no fix on npm) — see README §8.

---

# What was tested (and what was not)

All tests were run in a Linux sandbox (Node 22, headless Chromium, LibreOffice for Word rendering, PostgreSQL 16 and SQLite).
Nothing was run on Windows, in Microsoft Word, or in Adobe Reader.

## Important honesty notes
1. **Your real Excel workbooks were never received** (only `SANTE_BARLEY.docx` and two screenshots arrived). The importer was tested on
   **synthetic workbooks I built** (`samples/synthetic/`) from the column names you listed, with the messy structure real files have
   (title rows, merged cells, hidden column, formulas without saved results, Excel dates incl. zero date, leading zeros, 2-row header,
   several sheets, `.xls`, 12,000 rows). Passing on them does **not** prove your actual files import perfectly — send them and I will verify each value against the source.
2. **The Price Increase Notice template was never received**, so its layout and default wording remain my provisional version.
3. **Not deployed.** No public URL exists. See `DEPLOY.md`.

## Automated results (all passing at packaging time)
| Suite | Result |
|---|---|
| `npm test` (self-test: validation, header matching, importer on all synthetic files, new price-list table, auto numbering, old-draft migration, Word/PDF generation) | 16 / 16 |
| `node server/test-backend.js` on **SQLite (node:sqlite)** (login, roles, save, conflict, history, stored exports, search, duplicate, backup+restore, legacy migration, restart persistence) | 16 / 16 |
| same on **PostgreSQL 16** | 15 / 15 (legacy-migration check is SQLite-only) |
| Browser: Notice import from title-row workbook, review, duplicates, report, export, restart persistence, stale-save protection, Price List import in different column order, 12,000-row import | 45 / 45 |
| Browser regression of existing features (manual editing of every field, old sample files, print dialog + print layout, Word/PDF, drafts, signatory lock, column resize, start new) | 41 / 41, no console errors |
| Browser: Price List with restored table (Item No. auto-numbering incl. blank rows/delete/add, Excel + CSV import, Packing reported not silent, preview, print, Word, PDF, save/reopen, old-format draft, Notice unchanged) | 35 / 35 |
| Browser: login screen, wrong password, sign-out, viewer restrictions, user creation, backup download | 12 / 12 |

## Verified by inspecting generated files
* Word output passes the OOXML validator; opens/renders via LibreOffice with the same page count and row breaks as the PDF; contains every imported product with leading zeros, prices, `5.03 %`, `26.46 %`, `November 01, 2026`; contains no `1900`, no invalid/duplicate rows.
* Browser print layout (A4, header/footer on every page, only the document visible) matches the PDF.
* Signature blocks: Price List = two approvers at opposite margins; Notice = three blocks (unchanged).

## Bugs found by testing and fixed during this work
* Header matching was exact-synonym only, so real headers like “Old Wholesale Net Price” never mapped.
* SheetJS drops formula cells with no saved result and hidden-column info unless asked (`sheetStubs`, `cellStyles`) — formulas were invisible before.
* Backup safety copy could overwrite the backup being restored (data-loss path) — fixed and regression-tested.
* Stale print copy of a previous document broke column dragging in the next document.
* Earlier: 13-digit barcodes rounded; signature block CSS clash; PIN box blocked typing.

## Limitations / not verified
* Windows: `install.bat`, `start.bat`, `install-autostart.bat` (Task Scheduler) and `run-hidden.vbs` are untested on Windows. Local mode uses Node's built-in SQLite (needs Node 22.13+), deliberately avoiding any native module that could fail to install.
* Docker image build, Render blueprint, HTTPS, custom domain, second-computer access: untested (no Docker/hosting here). The PostgreSQL code path itself *was* tested.
* Importing 12,000 rows takes a few seconds in the browser; the review table pages 100 rows at a time.
* Excel formulas whose results were never saved (files generated by scripts, never opened in Excel) cannot be read — the app reports them and asks you to open/save the file in Excel.
* Leading zeros cannot be recovered from numeric Excel cells that have no zero-padding format.
* PDF table text is top-aligned (Word centres it); the HTML preview and PDF/Word are rendered separately, so line breaks in very narrow cells can differ slightly (use *Exact PDF view*).
* Backups on the same disk do not protect against disk failure — copy them elsewhere.
