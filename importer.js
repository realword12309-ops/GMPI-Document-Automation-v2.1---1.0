'use strict';
/*
 * Spreadsheet import — reads the REAL workbook structure and returns a matrix of strings
 * exactly as the person sees them in Excel, plus per-cell notes.
 *
 *  - .xlsx / .xlsm / .xlsb / .xls / .ods via SheetJS; .csv / .tsv via our own RFC-4180 parser
 *    (CSV cells stay literal text, nothing is reinterpreted).
 *  - Every sheet is listed; the sheet with the best-recognised product header is pre-selected.
 *  - Rows/columns are counted from the sheet's real USED range (not Excel's formatting range).
 *  - Merged cells: a value merged down a column (e.g. Principal) is filled into every row it spans.
 *  - Hidden rows / columns are read (flagged, never dropped).
 *  - Formulas use Excel's cached result; a formula with no cached result is reported, never invented.
 *  - Excel dates become "Month DD, YYYY"; a zero / invalid date (Excel's "1/0/1900") becomes blank + note.
 *  - Numeric cells keep the displayed text when lossless; otherwise the exact stored value is used
 *    (26.54% shown as "27%", a 13-digit barcode shown as 4.8065E+12) and the cell is flagged.
 *  - No silent truncation: if a sheet is beyond the supported size the import is REFUSED with a clear message.
 */
const crypto = require('crypto');
const XLSX = require('xlsx');
const G = require('../shared/gmpi');

const MAX_ROWS = 100000, MAX_COLS = 200;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ------------------------------------------------------------------ CSV
function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('windows-1252').decode(buf); } // Excel "CSV (comma delimited)" on Windows
}

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const first = (text.split(/\r?\n/).find((l) => l.trim() !== '') || '');
  let best = ',', bestN = -1;
  [',', ';', '\t', '|'].forEach((d) => {
    let n = 0, q = false;
    for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch === d) n++; }
    if (n > bestN) { best = d; bestN = n; }
  });
  const rows = []; let row = [], cell = '', q = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { q = true; i++; continue; }
    if (ch === best) { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = ''; i++; continue;
    }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { rows, delimiter: best, unterminatedQuote: q };
}

// ------------------------------------------------------------------ XLSX cells
// Full double precision for plain numbers (barcodes, prices); strip binary float noise only for percentages.
const exact = (x, pct) => String(Number(x.toPrecision(pct ? 12 : 15)));

function isDateFmt(z) { try { return !!z && XLSX.SSF.is_date(z); } catch (e) { return false; } }

function numericText(cell) {
  const v = cell.v, w = cell.w == null ? '' : String(cell.w);
  if (isDateFmt(cell.z)) {
    if (!(v >= 1)) return { text: '', note: { level: 'info', msg: 'Date value ' + v + ' (Excel displays it as 1/0/1900) was treated as blank.' } };
    const d = XLSX.SSF.parse_date_code(v);
    if (!d || !d.y || d.y < 1900) return { text: '', note: { level: 'error', msg: 'Invalid Excel date value ' + v + '.' } };
    return { text: MONTHS[d.m - 1] + ' ' + String(d.d).padStart(2, '0') + ', ' + d.y };
  }
  const pct = /%/.test(cell.z || '') || /%$/.test(w);
  const shown = parseFloat(w.replace(/[,%\s]/g, '').replace(/^[^\d.\-]+/, ''));
  const target = pct ? v * 100 : v;
  const tol = 1e-9 * Math.max(1, Math.abs(target));
  if (w && isFinite(shown) && Math.abs(shown - target) <= tol && !/[eE][+-]?\d/.test(w)) return { text: w.trim() };
  const t = exact(target, pct) + (pct ? '%' : '');
  return { text: t, note: { level: 'info', msg: 'Displayed value "' + w + '" was rounded/abbreviated in Excel; exact stored value ' + t + ' used.' } };
}

function cellValue(cell) {
  if (!cell) return { text: '' };
  const hasFormula = cell.f !== undefined && cell.f !== null && cell.f !== '';
  // a formula cell stored without a result is read by SheetJS as an empty "stub" (t:'z') carrying only the formula
  const noResult = cell.t === 'z' || cell.v === undefined || cell.v === null || cell.v === '';
  if (cell.t === 'z' && !hasFormula) return { text: '' };
  if (hasFormula && noResult) return { text: '', note: { level: 'error', msg: 'Formula =' + String(cell.f).slice(0, 60) + ' has no calculated value saved in the file. Open the workbook in Excel, let it calculate, save, then import again.' } };
  if (cell.t === 'n') return numericText(cell);
  if (cell.t === 'b') return { text: cell.v ? 'TRUE' : 'FALSE' };
  if (cell.t === 'e') return { text: '', note: { level: 'error', msg: 'The cell contains an Excel error value (' + (cell.w || '#ERROR') + ').' } };
  if (cell.t === 'd') return { text: cell.w != null ? String(cell.w) : String(cell.v) };
  return { text: String(cell.v == null ? '' : cell.v) };
}

/** Used range from the actual cells (Excel's !ref can span a million formatted-but-empty rows). */
function usedRange(ws) {
  let maxR = -1, maxC = -1;
  for (const k of Object.keys(ws)) {
    if (k[0] === '!') continue;
    const cell = ws[k]; if (!cell) continue;
    if ((cell.v === undefined || cell.v === null || cell.v === '') && !cell.f) continue;
    const a = XLSX.utils.decode_cell(k); if (a.r > maxR) maxR = a.r; if (a.c > maxC) maxC = a.c;
  }
  return { rows: maxR + 1, cols: maxC + 1 };
}

function sheetMatrix(ws, limitRows) {
  const used = usedRange(ws);
  if (used.rows > MAX_ROWS) throw new Error('This sheet has ' + used.rows.toLocaleString() + ' rows, above the supported limit of ' + MAX_ROWS.toLocaleString() + '. Nothing was imported. Split the workbook into smaller sheets and try again.');
  if (used.cols > MAX_COLS) throw new Error('This sheet has ' + used.cols + ' columns, above the supported limit of ' + MAX_COLS + '. Nothing was imported.');
  const nr = limitRows ? Math.min(used.rows, limitRows) : used.rows;
  // merged cells: fill a merged value DOWN the merge's first column
  const fill = {};
  (ws['!merges'] || []).forEach((m) => {
    if (m.e.r > m.s.r) for (let r = m.s.r + 1; r <= m.e.r; r++) fill[r + ',' + m.s.c] = { r: m.s.r, c: m.s.c };
  });
  const matrix = [], notes = {};
  for (let r = 0; r < nr; r++) {
    const line = [];
    for (let c = 0; c < used.cols; c++) {
      let src = XLSX.utils.encode_cell({ r, c }); const f = fill[r + ',' + c];
      if (f) src = XLSX.utils.encode_cell(f);
      const o = cellValue(ws[src]);
      if (o.note) notes[r + ',' + c] = o.note;
      line.push(G.cleanText(o.text).replace(/^\s+|\s+$/g, ''));
    }
    matrix.push(line);
  }
  const hiddenCols = [], hiddenRows = [];
  (ws['!cols'] || []).forEach((c, i) => { if (c && c.hidden && i < used.cols) hiddenCols.push(i); });
  (ws['!rows'] || []).forEach((r, i) => { if (r && r.hidden && i < nr) hiddenRows.push(i); });
  return { matrix, notes, hiddenCols, hiddenRows, merges: (ws['!merges'] || []).length };
}

function readWorkbook(buf, sheetName, type) {
  let wb;
  try { wb = XLSX.read(buf, { type: 'buffer', cellText: true, cellNF: true, cellDates: false, cellFormula: true, sheetStubs: true, cellStyles: true }); }
  catch (e) { throw new Error('The workbook could not be read (' + e.message + '). If it is password-protected, remove the protection in Excel and try again.'); }
  const names = wb.SheetNames.slice();
  if (!names.length) throw new Error('The workbook has no worksheets.');
  const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
  const sheets = names.map((n, i) => {
    const u = usedRange(wb.Sheets[n] || {});
    return { name: n, rows: u.rows, cols: u.cols, hidden: !!(meta[i] && meta[i].Hidden) };
  });
  // auto-pick the sheet whose first rows contain the best-recognised product header
  sheets.forEach((s) => {
    try { s.score = G.detectHeaders(type, sheetMatrix(wb.Sheets[s.name] || {}, 60).matrix).score; } catch (e) { s.score = 0; }
  });
  let pick = sheetName && names.includes(sheetName) ? sheetName : null, auto = false;
  if (!pick) {
    const vis = sheets.filter((s) => !s.hidden && s.rows > 0), pool = vis.length ? vis : sheets;
    pick = pool.reduce((a, b) => (b.score > a.score ? b : a), pool[0]).name; auto = true;
  }
  return Object.assign({ sheets, sheet: pick, autoSheet: auto }, sheetMatrix(wb.Sheets[pick] || {}));
}

/** @returns parse result for the UI (matrix, notes, sheets, detected header + mapping, hash …) */
function parseUpload(buffer, filename, type, sheetName) {
  if (!G.DOC_TYPES[type]) throw new Error('Unknown document type.');
  if (!buffer || !buffer.length) throw new Error('The uploaded file is empty.');
  const ext = (String(filename).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const isOle = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  let out;
  if (['xlsx', 'xlsm', 'xlsb', 'ods'].includes(ext)) {
    if (!isZip && ext !== 'xlsb') throw new Error('This file is not a valid .' + ext + ' workbook (it may be corrupted or have the wrong extension).');
    out = Object.assign({ format: 'xlsx' }, readWorkbook(buffer, sheetName, type));
  } else if (ext === 'xls') {
    if (!isOle && !isZip) throw new Error('This file is not a valid .xls workbook (it may be corrupted or have the wrong extension).');
    out = Object.assign({ format: 'xls' }, readWorkbook(buffer, sheetName, type));
  } else if (['csv', 'tsv', 'txt'].includes(ext)) {
    if (isZip || isOle) throw new Error('This looks like an Excel file renamed to .' + ext + '. Upload it with its real extension (.xlsx or .xls).');
    const p = parseCsv(decode(buffer));
    if (p.rows.length > MAX_ROWS) throw new Error('This CSV has ' + p.rows.length.toLocaleString() + ' rows, above the supported limit of ' + MAX_ROWS.toLocaleString() + '. Nothing was imported.');
    const matrix = p.rows.map((r) => r.map((c) => G.cleanText(c).replace(/^\s+|\s+$/g, '')));
    out = { format: 'csv', sheets: [], sheet: '', autoSheet: false, matrix, notes: {}, hiddenCols: [], hiddenRows: [], delimiter: p.delimiter, warning: p.unterminatedQuote ? 'The file ends inside a quoted value — the last row may be incomplete.' : undefined };
  } else {
    throw new Error('Unsupported file type ".' + ext + '". Upload .xlsx, .xls or .csv.');
  }
  const width = out.matrix.reduce((m, r) => Math.max(m, r.length), 0);
  out.matrix = out.matrix.map((r) => { const x = r.slice(); while (x.length < width) x.push(''); return x; });
  if (!out.matrix.some((r) => r.some(Boolean))) throw new Error('The selected sheet is empty.');
  const det = G.detectHeaders(type, out.matrix);
  Object.assign(out, { hash, filename, headerRow: det.headerRow, headerRows: det.headerRows, mapping: det.mapping, rowCount: out.matrix.length });
  return out;
}

module.exports = { parseUpload, parseCsv, MAX_ROWS, MAX_COLS };
