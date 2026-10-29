/*
 * GMPI shared module — runs in the browser AND in Node.
 * Holds: document-type definitions, default template text, strict price/percent
 * validation, import header detection, and the layout builder that Word, PDF
 * and the live preview all consume (so they cannot drift apart).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GMPI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TABLE_WIDTH = 10080; // dxa — same total as the original template's product table
  const MIN_COL = 600;       // dxa — smallest allowed column

  // ---------------------------------------------------------------- types
  const DOC_TYPES = {
    'price-list': {
      id: 'price-list',
      name: 'Official Price List',
      title: 'OFFICIAL PRICE LIST',
      fileStem: 'Official Price List',
      // Column headers/widths/alignments copied from SANTE BARLEY.docx
      columns: [
        { key: 'itemNo', label: 'Item No.', width: 600, align: 'center', auto: true }, // numbered 1, 2, 3… automatically
        { key: 'itemDescription', label: 'Item Description', width: 1500, align: 'left' },
        { key: 'packaging', label: 'Packaging', width: 1900, align: 'center' },
        { key: 'genericName', label: 'GENERIC NAME', width: 1500, align: 'left' },
        { key: 'srp', label: 'SRP', width: 950, align: 'right' },
        { key: 'discount', label: 'Discount', width: 900, align: 'center', bold: true },
        { key: 'tradePrice', label: 'Trade Price W/ VAT (PHP)', width: 1250, align: 'left' },
        { key: 'barcode', label: 'Barcode', width: 1480, align: 'center' },
      ],
      required: ['itemDescription'],
      extraFields: [],
      priceFields: ['srp', 'tradePrice'],
      percentFields: ['discount'],
      synonyms: {
        itemNo: ['itemno', 'itemnumber', 'no', 'lineno', 'number', 'seq'],
        itemDescription: ['itemdescription', 'itemcode', 'item', 'sku', 'code', 'itemdesc'],
        packaging: ['packaging', 'productname', 'product', 'productdescription', 'name'],
        genericName: ['genericname', 'generic'],
        srp: ['srp', 'suggestedretailprice', 'retailprice'],
        discount: ['discount', 'disc', 'discountpercent', 'discountrate'],
        tradePrice: ['tradepricewvatphp', 'tradepricewithvat', 'tradepricewvat', 'tradeprice', 'tp', 'tpvat', 'netprice'],
        barcode: ['barcode', 'upc', 'ean', 'bar'],
      },
      defaults: {
        date: '',
        toName: '',
        toAddress: '',
        from: 'Grand Majesty Pharmaceutical Inc.',
        re: 'Official Price Lists',
        salutation: 'Dear Sir/Ma\u2019am,',
        effectivity: '',
        intro: [
          'Good day.',
          'This letter serves as GRAND MAJESTY PHARMACEUTICAL INC. price offer to {customer}.',
          'We are pleased to share our updated official price list for the products effective {effectivity}',
        ],
        noticeLine: 'Price may change without prior notice.',
        additional: [],
        closing: [
          'We look forward to a successful and mutually beneficial partnership.',
          'For any inquiries or clarifications, please contact Donna Belle Ursal at 0916-211-1287 or our Senior Sales Manager, Mr. Gerald Lim, at 0917-714-3459.',
        ],
        // Two signatories, placed at opposite sides of the page (left / right)
        signatories: [
          { label: 'APPROVED BY', name: 'Evona Paula Mariquit', title: 'Merchandising Manager' },
          { label: 'APPROVED BY', name: 'Rashel L. Nacor', title: 'Merchandising Manager' },
        ],
      },
      provisional: false,
    },

    'price-increase': {
      id: 'price-increase',
      name: 'Price Increase Notice',
      title: 'PRICE INCREASE NOTICE',
      fileStem: 'Price Increase Notice',
      // Layout follows the final reference image: eight columns in this exact order.
      columns: [
        { key: 'description', label: 'Item Description', width: 2300, align: 'left' },
        { key: 'packaging', label: 'Packaging', width: 1300, align: 'center' },
        { key: 'uom', label: 'UOM', width: 800, align: 'center' },
        { key: 'uomGroup', label: 'UoM Group Name', width: 1200, align: 'center' },
        { key: 'oldPrice', label: 'Old Price w/VAT', width: 1000, align: 'right' },
        { key: 'newPrice', label: 'New Price w/VAT', width: 1000, align: 'right' },
        { key: 'percent', label: '% Increase', width: 880, align: 'center', bold: true },
        { key: 'effectivity', label: 'GMPI Effectivity', width: 1600, align: 'center' },
      ],
      required: ['description'],
      extraFields: [{ key: 'itemCode', label: 'Item Code' }, { key: 'principal', label: 'Principal' }], // imported/stored per row (not printed as table columns); principal is shown via the document-level Principal field / {principal} token
      priceFields: ['oldPrice', 'newPrice'],
      percentFields: ['percent'],
      synonyms: {
        itemCode: ['itemcode', 'item', 'itemno', 'sku', 'code'],
        description: ['description', 'itemdescription', 'productdescription', 'product', 'productname', 'itemname'],
        packaging: ['packaging', 'packing', 'pack'],
        uom: ['uom', 'unitofmeasure', 'unitofmeasurement', 'unit'],
        uomGroup: ['uomgroupname', 'uomgroup', 'unitofmeasuregroup'],
        oldPrice: ['oldprice', 'currentprice', 'previousprice', 'oldsrp', 'old'],
        newPrice: ['newprice', 'newsrp', 'revisedprice', 'new'],
        percent: ['increase', 'percentincrease', 'increasepercent', 'percentage', 'percent', 'increase%', 'priceincrease'],
        effectivity: ['effectivity', 'effectivedate', 'effectivitydate', 'effective', 'gmpieffectivity', 'gmpieffectivitydate'],
      },
      defaults: {
        date: '',
        toName: '',
        toAddress: '',
        from: 'Grand Majesty Pharmaceutical Inc.',
        re: 'Price Increase Notice',
        principal: '',
        salutation: 'Dear Valued Customers:',
        effectivity: '',
        intro: [
          'Please be advised that the prices of the following products will be updated as indicated below. To help minimize the impact of this price adjustment, we are offering protection orders to secure these items at their current prices.',
          'Kindly refer to the updated pricing details below:',
        ],
        noticeLine: 'UPDATED PRICING DETAILS',
        additional: [],
        closing: ['Thank you for your understanding and continued support.'],
        signatories: [
          { label: 'PREPARED BY', name: 'Brixzel M. Flores', title: 'MMA' },
          { label: 'APPROVED BY', name: 'Rashel L. Nacor / Evona Mariquit', title: 'Merchandising Manager' },
          { label: 'ACKNOWLEDGED BY', name: 'Khrystian Dala / Joseph Paitan', title: 'SAPA/CSR Supervisor' },
        ],
      },
      provisional: false,
    },
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function emptyProduct(type) {
    const p = {};
    DOC_TYPES[type].columns.forEach((c) => (p[c.key] = ''));
    (DOC_TYPES[type].extraFields || []).forEach((f) => (p[f.key] = ''));
    return p;
  }

  function newDocData(type, todayText) {
    const t = DOC_TYPES[type];
    const d = clone(t.defaults);
    d.date = todayText || '';
    d.columns = t.columns.map((c) => ({ key: c.key, label: c.label, width: c.width }));
    d.products = [emptyProduct(type)];
    return d;
  }

  // ---------------------------------------------------------- normalizing
  function str(v) { return v == null ? '' : String(v); }
  function cleanText(s) {
    // strip control chars (illegal in Word XML) but keep \n and \t
    return str(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/\r\n?/g, '\n');
  }

  /** Make sure stored/submitted data has every field with the right type. */
  function normalize(type, data) {
    const t = DOC_TYPES[type];
    if (!t) throw new Error('Unknown document type: ' + type);
    const base = newDocData(type, '');
    const d = Object.assign({}, base, data || {});
    ['date', 'toName', 'toAddress', 'from', 're', 'salutation', 'effectivity', 'noticeLine', 'principal'].forEach((k) => (d[k] = cleanText(d[k])));
    ['intro', 'additional', 'closing'].forEach((k) => {
      d[k] = Array.isArray(d[k]) ? d[k].map(cleanText) : [];
    });
    // columns: always the fixed key set, in template order; labels/widths editable
    const given = Array.isArray(d.columns) ? d.columns : [];
    // drafts saved with the earlier price-list table (no Item No. column) get the new default widths; headings they customised are kept
    const oldLayout = (type === 'price-list' && given.length && !given.some((x) => x && x.key === 'itemNo')) ||
      // notice drafts saved before the 8-column layout (no separate UOM column) get the new headings and widths
      (type === 'price-increase' && given.length && !given.some((x) => x && x.key === 'uom'));
    let cols = t.columns.map((c) => {
      const g = given.find((x) => x && x.key === c.key) || {};
      const w = Math.round(Number(g.width));
      return { key: c.key, label: cleanText(!(type === 'price-increase' && oldLayout) && g.label != null && g.label !== '' ? g.label : c.label), width: !oldLayout && isFinite(w) && w >= MIN_COL ? w : c.width };
    });
    d.columns = fitWidths(cols);
    d.products = (Array.isArray(d.products) ? d.products : []).map((p) => {
      const o = {};
      t.columns.forEach((c) => (o[c.key] = cleanText(p && p[c.key])));
      (t.extraFields || []).forEach((f) => (o[f.key] = cleanText(p && p[f.key])));
      return o;
    });
    // automatic numbering: 1, 2, 3 … over the non-blank product rows (blank rows get no number)
    renumber(type, d.products);
    d.importLog = (Array.isArray(d.importLog) ? d.importLog : []).slice(-50).map((x) => ({ hash: str(x && x.hash), name: cleanText(x && x.name), sheet: cleanText(x && x.sheet), at: str(x && x.at), imported: Number(x && x.imported) || 0 }));
    let sg = Array.isArray(d.signatories) ? d.signatories : [];
    // drafts saved with an older signature layout (different count) use the current defaults
    if (sg.length !== t.defaults.signatories.length) sg = [];
    const keepBlank = type !== 'price-increase'; // notice: signatories left blank by earlier drafts take the defaults
    d.signatories = t.defaults.signatories.map((s, i) => ({
      label: s.label,
      name: cleanText(sg[i] && sg[i].name != null && (keepBlank || sg[i].name !== '') ? sg[i].name : s.name),
      title: cleanText(sg[i] && sg[i].title != null && (keepBlank || sg[i].title !== '') ? sg[i].title : s.title),
    }));
    // notice drafts still holding the earlier placeholder wording take the new default wording
    if (type === 'price-increase') {
      const OLD = { salutation: 'Dear Sir/Ma\u2019am,', intro: ['Good day.', 'Please be advised of the following price adjustments, effective {effectivity}.'] };
      if (d.salutation === OLD.salutation) d.salutation = t.defaults.salutation;
      if (JSON.stringify(d.intro) === JSON.stringify(OLD.intro)) { d.intro = clone(t.defaults.intro); if (!d.noticeLine) d.noticeLine = t.defaults.noticeLine; }
    }
    return d;
  }

  /** Fills every `auto` column (Item No.) with 1, 2, 3 … in row order; blank rows stay empty. Mutates and returns rows. */
  function renumber(type, rows) {
    const auto = DOC_TYPES[type].columns.filter((c) => c.auto);
    if (!auto.length) return rows;
    let n = 0;
    rows.forEach((r) => { const blank = isBlankRow(type, r); if (!blank) n++; auto.forEach((c) => (r[c.key] = blank ? '' : String(n))); });
    return rows;
  }

  /** Scale widths so they sum to TABLE_WIDTH exactly (keeps proportions). */
  function fitWidths(cols) {
    const sum = cols.reduce((a, c) => a + c.width, 0);
    if (sum === TABLE_WIDTH) return cols;
    let acc = 0;
    cols.forEach((c, i) => {
      if (i < cols.length - 1) { c.width = Math.max(MIN_COL, Math.round((c.width * TABLE_WIDTH) / sum)); acc += c.width; }
      else c.width = TABLE_WIDTH - acc;
    });
    return cols;
  }

  // ----------------------------------------------------- price / percent
  /** Strict. Only "1234", "1234.50", "1,234", "1,234.50" (optionally prefixed PHP / ₱). */
  function parsePrice(raw) {
    const s0 = str(raw).trim();
    if (s0 === '') return { empty: true };
    const s = s0.replace(/^(?:PHP|PhP|Php|\u20B1)\s*/, '');
    if (/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(s)) return { ok: true, value: parseFloat(s.replace(/,/g, '')) };
    if (/^-/.test(s)) return { ok: false, reason: 'Negative price' };
    if (/,/.test(s) || /\.\d*\./.test(s)) {
      return { ok: false, reason: 'Ambiguous number format (use 1,234.50 or 1234.50)' };
    }
    return { ok: false, reason: 'Not a valid price' };
  }

  /** Strict. Requires a % sign: "30%", "26.54%", "26.54 %". */
  function parsePercent(raw) {
    const s = str(raw).trim();
    if (s === '') return { empty: true };
    if (/^\d+(?:\.\d+)?\s*%$/.test(s)) return { ok: true, value: parseFloat(s) };
    if (/^\d+(?:\.\d+)?$/.test(s)) return { ok: false, reason: 'Missing % sign (e.g. ' + s + '%)' };
    return { ok: false, reason: 'Not a valid percentage' };
  }

  function isBlankRow(type, row) {
    return DOC_TYPES[type].columns.every((c) => c.auto || str(row[c.key]).trim() === '');
  }

  /** Validate one row. Errors block import; warnings do not. */
  function validateRow(type, row) {
    const t = DOC_TYPES[type];
    const errors = [], warnings = [];
    t.required.forEach((k) => {
      if (str(row[k]).trim() === '') errors.push({ field: k, msg: 'Required: ' + labelOf(t, k) });
    });
    t.priceFields.forEach((k) => {
      const r = parsePrice(row[k]);
      if (!r.empty && !r.ok) errors.push({ field: k, msg: labelOf(t, k) + ': ' + r.reason });
    });
    t.percentFields.forEach((k) => {
      const r = parsePercent(row[k]);
      if (!r.empty && !r.ok) errors.push({ field: k, msg: labelOf(t, k) + ': ' + r.reason });
    });
    if (type === 'price-increase' && isBadDate(row.effectivity)) errors.push({ field: 'effectivity', msg: 'Effectivity: invalid date (' + str(row.effectivity).trim() + ')' });
    if (type === 'price-list') {
      const bc = str(row.barcode).trim();
      if (bc && !/^\d{8}$|^\d{12,14}$/.test(bc)) warnings.push({ field: 'barcode', msg: 'Barcode is not 8 or 12\u201314 digits' });
    }
    if (type === 'price-increase') {
      const o = parsePrice(row.oldPrice), n = parsePrice(row.newPrice), p = parsePercent(row.percent);
      if (o.ok && n.ok && p.ok && o.value > 0) {
        const calc = ((n.value - o.value) / o.value) * 100;
        if (Math.abs(calc - p.value) > 0.01)
          warnings.push({ field: 'percent', msg: 'Entered % (' + p.value + '%) differs from prices (' + calc.toFixed(2) + '%)' });
      }
      if (o.empty && !n.empty) warnings.push({ field: 'oldPrice', msg: 'Old price is empty' });
    }
    return { errors, warnings };
  }

  function labelOf(t, k) { const c = t.columns.find((x) => x.key === k); return c ? c.label : k; }

  /** Validate a list of rows; adds cross-row warnings. Returns [{errors,warnings,blank}] */
  function validateRows(type, rows) {
    const out = rows.map((r) => (isBlankRow(type, r) ? { errors: [], warnings: [], blank: true } : Object.assign(validateRow(type, r), { blank: false })));
    if (type === 'price-list') {
      const seen = {};
      rows.forEach((r, i) => {
        const bc = str(r.barcode).trim();
        if (!bc) return;
        (seen[bc] = seen[bc] || []).push(i);
      });
      Object.keys(seen).forEach((bc) => {
        if (seen[bc].length > 1)
          seen[bc].forEach((i) => out[i].warnings.push({ field: 'barcode', msg: 'Barcode shared with row ' + seen[bc].filter((x) => x !== i).map((x) => x + 1).join(', ') }));
      });
    }
    return out;
  }

  // --------------------------------------------------- header detection
  const norm = (s) => str(s).toLowerCase().replace(/[^a-z0-9%]/g, '');
  const BAD_DATE = /^\s*(0?1\/0?0\/1900|0?0\/0?1\/1900|1900-01-00|0?0\/0?0\/0?0{0,2}1900|1\/0\/00)\s*$/;
  function isBadDate(v) { return BAD_DATE.test(str(v)); }

  /** Rules identify a column by its MEANING (keywords), most specific first. */
  const has = (n, ...w) => w.some((x) => n.includes(x));
  const RULES = {
    'price-increase': [
      ['oldPrice', (n) => has(n, 'old', 'previous', 'current', 'existing') && has(n, 'price', 'net', 'wholesale', 'srp', 'cost')],
      ['newPrice', (n) => has(n, 'new', 'revised', 'proposed') && has(n, 'price', 'net', 'wholesale', 'srp', 'cost')],
      ['effectivity', (n) => has(n, 'effectiv', 'effectivedate')],
      ['uomGroup', (n) => has(n, 'uomgroup', 'unitofmeasuregroup', 'groupname')],
      ['uom', (n) => has(n, 'uom', 'unitofmeasure', 'unitofmeasurement')],
      ['principal', (n) => has(n, 'principal', 'supplier', 'vendor')],
      ['percent', (n) => has(n, 'percent', 'increase', 'pct', 'inc%') || n === '%' || n.endsWith('%')],
      ['itemCode', (n) => has(n, 'itemno', 'itemcode', 'itemnumber', 'itemnum', 'sku', 'materialno', 'productcode') || n === 'item' || n === 'code'],
      ['description', (n) => has(n, 'description', 'itemname', 'productname', 'product', 'itemdesc')],
      ['packaging', (n) => has(n, 'packaging', 'packing', 'packsize')],
    ],
    'price-list': [
      ['genericName', (n) => has(n, 'generic')],
      ['barcode', (n) => has(n, 'barcode', 'upc', 'ean', 'gtin') || n === 'bar'],
      ['discount', (n) => has(n, 'discount') || n === 'disc'],
      ['srp', (n) => has(n, 'srp', 'retailprice', 'suggestedretail')],
      ['tradePrice', (n) => has(n, 'trade', 'netprice', 'wholesale', 'tpvat') || n === 'tp'],
      ['packaging', (n) => has(n, 'packaging', 'productname')],
      ['itemNo', (n) => has(n, 'itemno', 'itemnumber', 'lineno') || n === 'no' || n === 'number'],
      ['itemDescription', (n) => has(n, 'itemdescription', 'itemcode', 'description', 'sku') || n === 'item'],
    ],
  };

  /** All fields a column can be mapped to (table columns + hidden extras). */
  function importFields(type) {
    const t = DOC_TYPES[type];
    return t.columns.map((c) => ({ key: c.key, label: c.label + (c.auto ? ' (numbered automatically)' : '') })).concat((t.extraFields || []).map((f) => ({ key: f.key, label: f.label + ' (document field)' })));
  }
  function fieldLabel(type, key) { const f = importFields(type).find((x) => x.key === key); return f ? f.label : key; }

  /** header text -> field key or null (exact synonym / label first, then meaning rules) */
  function matchHeader(type, text) {
    const t = DOC_TYPES[type], n = norm(text);
    if (!n) return null;
    for (const key of Object.keys(t.synonyms)) if (t.synonyms[key].includes(n) || norm(labelOf(t, key)) === n) return key;
    for (const [key, test] of RULES[type]) if (test(n)) return key;
    return null;
  }

  /** Header text per column when the header spans `span` rows starting at `row`. */
  function combinedHeaders(matrix, row, span) {
    const w = matrix.reduce((m, r) => Math.max(m, r.length), 0), out = [];
    for (let c = 0; c < w; c++) {
      const parts = [];
      for (let k = 0; k < span; k++) { const v = str(matrix[row + k] && matrix[row + k][c]).trim(); if (v) parts.push(v); }
      out.push(parts.join(' '));
    }
    return out;
  }
  function mapFromHeaders(type, headers) {
    const mapping = {}, used = {};
    headers.forEach((h, ci) => { const k = matchHeader(type, h); if (k && !used[k]) { mapping[ci] = k; used[k] = true; } });
    return mapping;
  }

  /** Finds the real product table header (titles / blank rows above are skipped).
   *  Returns {headerRow, headerRows, mapping, score} — headerRow -1 when nothing recognisable. */
  function detectHeaders(type, matrix, maxScan) {
    let best = { headerRow: -1, headerRows: 1, mapping: {}, score: 0 };
    const limit = Math.min(matrix.length, maxScan || 60);
    for (let r = 0; r < limit; r++) {
      for (let span = 1; span <= 3; span++) {
        if (r + span > matrix.length) break;
        const mapping = mapFromHeaders(type, combinedHeaders(matrix, r, span)), score = Object.keys(mapping).length;
        // higher score wins; on a tie prefer the SHORTER header (the real header row, not titles above it)
        if (score > best.score || (score === best.score && score > 0 && span < best.headerRows)) best = { headerRow: r, headerRows: span, mapping, score };
      }
    }
    if (best.score < 2) return { headerRow: -1, headerRows: 1, mapping: {}, score: best.score };
    // don't let the header "start" on a blank row
    while (best.headerRows > 1 && !(matrix[best.headerRow] || []).some((v) => str(v).trim())) { best.headerRow++; best.headerRows--; }
    return best;
  }

  /** Normalised identity of a product row, used to prevent duplicate entries. */
  function rowKey(type, row) {
    const f = type === 'price-list' ? ['itemDescription', 'packaging', 'genericName', 'barcode'] : ['itemCode', 'description', 'uomGroup', 'oldPrice', 'newPrice'];
    return f.map((k) => str(row[k]).toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
  }

  // ----------------------------------------------------------- layout
  function fillTokens(text, d) {
    const cust = str(d.toName).trim();
    return str(text)
      // avoid "Inc.." when the template sentence ends with a period right after {customer}
      .replace(/\{customer\}\./gi, cust + (cust.endsWith('.') ? '' : '.'))
      .replace(/\{customer\}/gi, cust)
      .replace(/\{principal\}/gi, str(d.principal).trim())
      .replace(/\{effectivity\}/gi, str(d.effectivity).trim())
      .replace(/\{date\}/gi, str(d.date).trim());
  }

  /** Splits "3rd Floor" so renderers can superscript the ordinal like the template does. */
  function ordinalSegments(text) {
    const out = []; const re = /(\d)(st|nd|rd|th)(?=\W|$)/g; let last = 0, m;
    while ((m = re.exec(text))) {
      out.push({ t: text.slice(last, m.index + 1) });
      out.push({ t: m[2], sup: true });
      last = m.index + 1 + m[2].length;
    }
    out.push({ t: text.slice(last) });
    return out.filter((s) => s.t !== '');
  }

  /** Everything every renderer needs, already resolved. */
  function buildLayout(type, rawData) {
    const t = DOC_TYPES[type];
    const d = normalize(type, rawData);
    const addrLines = d.toAddress.split('\n').map((x) => x.trim()).filter(Boolean);
    const headRows = [
      { label: 'DATE', lines: [{ text: d.date, bold: true }] },
      { label: 'TO', lines: [{ text: d.toName, bold: true, big: true }].concat(addrLines.map((a) => ({ text: a, bold: true, ordinals: true }))) },
      { label: 'FROM', lines: [{ text: d.from, bold: true }] },
      { label: type === 'price-increase' ? 'RE:' : 'RE:', lines: [{ text: d.re, bold: true }] },
    ];
    const rows = d.products.filter((p) => !isBlankRow(type, p));
    // optional columns with no data in any row are left out of the document (widths re-fit to the same total)
    let cols = d.columns.map((c, i) => Object.assign({}, c, { align: t.columns[i].align, bold: !!t.columns[i].bold }));
    const kept = cols.filter((c, i) => !t.columns[i].optional || rows.some((r) => str(r[c.key]).trim() !== ''));
    if (kept.length !== cols.length) cols = fitWidths(kept.map((c) => Object.assign({}, c))); else cols = kept;
    return {
      type,
      docTitle: t.title,
      fileStem: t.fileStem,
      headRows,
      salutation: d.salutation,
      intro: d.intro.map((p) => fillTokens(p, d)).filter((p) => p.trim() !== ''),
      noticeLine: d.noticeLine.trim() ? d.noticeLine : '',
      columns: cols,
      rows,
      additional: d.additional.map((p) => fillTokens(p, d)).filter((p) => p.trim() !== ''),
      closing: d.closing.map((p) => fillTokens(p, d)).filter((p) => p.trim() !== ''),
      signatories: d.signatories,
      customer: d.toName,
      data: d,
    };
  }

  /** Safe download file name. */
  function fileName(type, data, ext) {
    const t = DOC_TYPES[type];
    const cust = str(data && data.toName).replace(/[\\/:*?"<>|\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[. ]+$/, '');
    return (t.fileStem + (cust ? ' - ' + cust : '')) + '.' + ext;
  }

  /** Signatory fields whose template default is non-empty are "locked". */
  function signatoriesChanged(type, data) {
    const defs = DOC_TYPES[type].defaults.signatories;
    const sg = normalize(type, data).signatories;
    const changed = [];
    defs.forEach((def, i) => {
      if (def.name && sg[i].name !== def.name) changed.push(def.label + ' name');
      if (def.title && sg[i].title !== def.title) changed.push(def.label + ' title');
    });
    return changed;
  }

  return {
    TABLE_WIDTH, MIN_COL, DOC_TYPES, newDocData, normalize, fitWidths, emptyProduct,
    parsePrice, parsePercent, isBlankRow, validateRow, validateRows, detectHeaders, matchHeader, combinedHeaders, mapFromHeaders, importFields, fieldLabel, rowKey, isBadDate,
    buildLayout, renumber, ordinalSegments, fillTokens, fileName, signatoriesChanged, cleanText,
  };
});
