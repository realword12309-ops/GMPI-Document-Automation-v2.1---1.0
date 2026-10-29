'use strict';
/* Quick automated self-test (no browser, no database needed):  npm test
 * Uses the bundled SYNTHETIC workbooks in samples/synthetic (built from the column names of the real files). */
const fs = require('fs'), path = require('path'), assert = require('assert'), JSZip = require('jszip');
const G = require('../shared/gmpi');
const { buildDocx } = require('./docx-gen');
const { buildPdf } = require('./pdf-gen');
const { parseUpload } = require('./importer');
const S = path.join(__dirname, '..', 'samples', 'synthetic');
const rd = (f) => fs.readFileSync(path.join(S, f));
let pass = 0; const t = async (n, f) => { try { await f(); pass++; console.log('PASS', n); } catch (e) { console.log('FAIL', n, '-', e.message); process.exitCode = 1; } };
(async () => {
  await t('validation: strict prices, percentages, bad dates', () => {
    assert(G.parsePrice('2,100.00').ok && G.parsePrice('1470').ok && G.parsePrice('').empty);
    ['1.470,00', '1,47', 'abc', '12,34,567'].forEach((x) => assert(!G.parsePrice(x).ok, x));
    assert(G.parsePercent('26.54%').ok && !G.parsePercent('30').ok); assert(G.isBadDate('1/0/1900') && !G.isBadDate('November 01, 2026'));
  });
  await t('header names matched by meaning (Old/New Wholesale Net Price, Percentage Increase, GMPI Effectivity Date…)', () => {
    const m = G.mapFromHeaders('price-increase', ['Principal', 'Item No.', 'Item Description', 'UoM Group Name', 'Old Wholesale Net Price', 'New Wholesale Net Price', 'Percentage Increase', 'GMPI Effectivity Date']);
    assert.deepStrictEqual(Object.values(m), ['principal', 'itemCode', 'description', 'uomGroup', 'oldPrice', 'newPrice', 'percent', 'effectivity']);
  });
  await t('import notice workbook: auto sheet, header under titles, hidden column, formula + date handling', () => {
    const r = parseUpload(rd('notice-ampalay-like.xlsx'), 'n.xlsx', 'price-increase');
    assert.strictEqual(r.sheet, 'Price Increase'); assert.strictEqual(r.headerRow, 4); assert.deepStrictEqual(r.hiddenCols, [3]);
    assert.strictEqual(r.matrix[5][1], '000123'); assert.strictEqual(r.matrix[5][5], '1,470.00'); assert.strictEqual(r.matrix[5][7], '5.03%'); assert.strictEqual(r.matrix[5][8], 'November 01, 2026');
    assert(r.notes['6,7'] && r.notes['6,7'].level === 'error' && /Formula/.test(r.notes['6,7'].msg)); assert.strictEqual(r.matrix[10][8], ''); assert(!JSON.stringify(r.matrix).includes('1900'));
  });
  await t('import: two-row header on another sheet; .xls; recalculated workbook', () => {
    const a = parseUpload(rd('notice-ampalay-like.xlsx'), 'n.xlsx', 'price-increase', 'Alt layout'); assert.strictEqual(a.headerRows, 2); assert.strictEqual(a.mapping[2], 'oldPrice');
    const x = parseUpload(rd('notice-legacy-format.xls'), 'n.xls', 'price-increase'); assert.strictEqual(x.headerRow, 4); assert.strictEqual(x.matrix[5][1], '000123');
    const c = parseUpload(rd('notice-recalculated-by-libreoffice.xlsx'), 'n.xlsx', 'price-increase'); assert(!c.notes['6,7']);
  });
  await t('import price list: any column order, barcodes exact incl. leading zeros', () => {
    const r = parseUpload(rd('pricelist-different-order.xlsx'), 'p.xlsx', 'price-list'), m = r.matrix;
    assert.strictEqual(r.mapping[0], 'barcode'); assert(!Object.values(r.mapping).includes('packing')); assert.deepStrictEqual([m[4][0], m[5][0], m[6][0]], ['4806520800627', '0012345678905', '0000012345678']); assert.strictEqual(m[7][1], '');
  });
  await t('price list table = Item No. | Item Description | Packaging | GENERIC NAME | SRP | Discount | Trade Price | Barcode (no Packing), widths total 10080', () => {
    const c = G.DOC_TYPES['price-list'].columns; assert.deepStrictEqual(c.map((x) => x.label), ['Item No.', 'Item Description', 'Packaging', 'GENERIC NAME', 'SRP', 'Discount', 'Trade Price W/ VAT (PHP)', 'Barcode']);
    assert.strictEqual(c.reduce((a, x) => a + x.width, 0), 10080); assert(c.every((x) => x.key !== 'packing'));
  });
  await t('price list import: Item No. recognised, Packing left unmapped, headers by meaning', () => {
    const r = parseUpload(rd('pricelist-with-itemno.xlsx'), 'p.xlsx', 'price-list'); assert.strictEqual(r.headerRow, 2);
    assert.deepStrictEqual(Object.values(r.mapping), ['itemNo', 'itemDescription', 'packaging', 'genericName', 'srp', 'discount', 'tradePrice', 'barcode']); assert.strictEqual(r.mapping[3], undefined);
  });
  await t('Item No. is numbered 1,2,3… automatically (blank rows skipped, order kept, stored on save)', () => {
    const d = G.newDocData('price-list', 'x'), mk = (v) => Object.assign(G.emptyProduct('price-list'), v ? { itemDescription: v } : {});
    d.products = [mk('A'), mk(''), mk('B'), mk('C')]; d.products[0].itemNo = 'TI-9'; const n = G.normalize('price-list', d);
    assert.deepStrictEqual(n.products.map((p) => p.itemNo), ['1', '', '2', '3']); assert.deepStrictEqual(G.buildLayout('price-list', d).rows.map((r) => r.itemNo), ['1', '2', '3']);
  });
  await t('drafts saved with the old table (Packing, no Item No.) open in the new layout', () => {
    const old = { columns: [{ key: 'itemDescription', label: 'Item Description', width: 1350 }, { key: 'packaging', label: 'Packaging', width: 1710 }, { key: 'packing', label: 'Packing', width: 900 }], products: [{ itemDescription: 'TI-1', packaging: 'P', packing: '30s', srp: '1,000.00' }] };
    const n = G.normalize('price-list', old); assert.strictEqual(n.columns[0].key, 'itemNo'); assert.strictEqual(n.columns.reduce((a, c) => a + c.width, 0), 10080); assert.strictEqual(n.products[0].itemNo, '1'); assert.strictEqual(n.products[0].srp, '1,000.00'); assert(!('packing' in n.products[0]));
  });
  await t('import: 12,000-row workbook read completely (no row cap)', () => { const r = parseUpload(rd('big-12000-rows.xlsx'), 'b.xlsx', 'price-increase'); assert.strictEqual(r.rowCount, 12001); assert.strictEqual(r.matrix[12000][0], '012000'); });
  await t('import refuses wrong/renamed files instead of guessing', () => { assert.throws(() => parseUpload(rd('notice-ampalay-like.xlsx'), 'x.csv', 'price-list')); assert.throws(() => parseUpload(Buffer.from('x'), 'x.exe', 'price-list')); });
  await t('Notice has the 8 required columns in order; Packaging and UOM always visible and separate; widths total 10080', () => {
    const d = G.newDocData('price-increase', 'x'); d.products = [Object.assign(G.emptyProduct('price-increase'), { description: 'A' })];
    const L = G.buildLayout('price-increase', d);
    assert.deepStrictEqual(L.columns.map((c) => c.label), ['Item Description', 'Packaging', 'UOM', 'UoM Group Name', 'Old Price w/VAT', 'New Price w/VAT', '% Increase', 'GMPI Effectivity']);
    assert.strictEqual(L.columns.reduce((a, c) => a + c.width, 0), 10080);
    assert.deepStrictEqual(L.closing, ['Thank you for your understanding and continued support.']);
    assert.deepStrictEqual(L.signatories.map((x) => x.label + '|' + x.name + '|' + x.title), ['PREPARED BY|Brixzel M. Flores|MMA', 'APPROVED BY|Rashel L. Nacor / Evona Mariquit|Merchandising Manager', 'ACKNOWLEDGED BY|Khrystian Dala / Joseph Paitan|SAPA/CSR Supervisor']);
    assert.deepStrictEqual(G.mapFromHeaders('price-increase', ['Item Description', 'UOM', 'UoM Group Name']), { 0: 'description', 1: 'uom', 2: 'uomGroup' });
  });
  for (const type of Object.keys(G.DOC_TYPES)) {
    const d = G.newDocData(type, 'October 22, 2026'); d.toName = 'Test & Co. <Ltd>'; d.toAddress = '3rd Floor Bldg\nCity'; d.effectivity = 'Nov 1, 2026';
    d.products = Array.from({ length: 45 }, (_, i) => { const p = G.emptyProduct(type); G.DOC_TYPES[type].columns.filter((c) => !c.auto).forEach((c) => (p[c.key] = c.key + '-' + i + ' & <x> 26.54%')); return p; });
    await t(type + ': docx valid, all rows present and XML-escaped', async () => {
      const b = await buildDocx(type, d); assert.strictEqual(b.slice(0, 2).toString(), 'PK');
      const z = await JSZip.loadAsync(b), xml = await z.file('word/document.xml').async('string');
      assert(z.file('word/media/image1.png') && z.file('word/header1.xml') && z.file('word/footer1.xml'));
      for (let i = 0; i < 45; i++) assert(xml.includes('-' + i + ' &amp; &lt;x&gt; 26.54%'), 'row ' + i);
      if (type === 'price-list') { assert(!xml.includes('Packing') && xml.includes('>Item No.<')); for (const n of [1, 22, 45]) assert(xml.includes('<w:t xml:space="preserve">' + n + '</w:t>'), 'item no ' + n); }
      assert(xml.includes('Test &amp; Co. &lt;Ltd&gt;') && xml.includes('<w:tblHeader/>'));
    });
    await t(type + ': pdf is real, multi-page A4', async () => { const b = await buildPdf(type, d); assert.strictEqual(b.slice(0, 5).toString(), '%PDF-'); assert((b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length >= 3); });
  }
  console.log(pass + ' checks passed' + (process.exitCode ? ', SOME FAILED' : ''));
})();
