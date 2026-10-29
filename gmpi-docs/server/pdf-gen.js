'use strict';
/*
 * Genuine PDF generation (pdfmake, pure JavaScript — no browser or Office needed).
 * A4, same margins / colours / column widths as the Word output. The logo and the
 * footer artwork are read out of the original template package.
 */
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const PdfPrinter = require('pdfmake');
const G = require('../shared/gmpi');

const TEMPLATE = path.join(__dirname, '..', 'templates', 'official-price-list.docx');
const FONT_DIR = path.join(__dirname, '..', 'fonts');

// Arial if installed (Windows), otherwise the bundled metric-compatible Liberation Sans.
function pickFonts() {
  const win = process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : null;
  const set = (a, b, c, d) => ({ normal: a, bold: b, italics: c, bolditalics: d });
  if (win) {
    const f = ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf'].map((n) => path.join(win, n));
    if (f.every((p) => fs.existsSync(p))) return { Arial: set(...f) };
  }
  return { Arial: set(...['Regular', 'Bold', 'Italic', 'BoldItalic'].map((n) => path.join(FONT_DIR, `LiberationSans-${n}.ttf`))) };
}
const printer = new PdfPrinter(pickFonts());

let art = null;
async function artwork() {
  if (art) return art;
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
  const rels = async (f) => (await zip.file('word/' + f).async('string')).match(/Target="([^"]+)"/)[1];
  const get = async (relFile) => 'data:image/png;base64,' + (await zip.file('word/' + (await rels(relFile))).async('base64'));
  art = { logo: await get('_rels/header1.xml.rels'), footer: await get('_rels/footer1.xml.rels') };
  return art;
}

const RED = '#9E0B14', GOLD = '#B8964A', INK = '#222222';
const pt = (dxa) => dxa / 20;
const PAGE_W = 595.28, PAGE_H = 841.89;

/** Rich text with real superscript ordinals. */
function rich(text, o) {
  const lines = String(text).split('\n');
  const out = [];
  lines.forEach((ln, i) => {
    const segs = o.ordinals && ln ? G.ordinalSegments(ln) : [{ t: ln }];
    segs.forEach((s, j) => {
      const prefix = i > 0 && j === 0 ? '\n' : '';
      out.push(Object.assign({ text: prefix + s.t }, s.sup ? { sup: true } : {}));
    });
  });
  return out;
}

/** Give very long unbroken strings somewhere to wrap (Word wraps mid-word on its own). */
function wrapLong(text, maxRun) {
  return String(text).split(/(\s+)/).map((tok) => {
    if (tok.length <= maxRun || /^\s+$/.test(tok)) return tok;
    return tok.replace(new RegExp('(.{' + maxRun + '})', 'g'), '$1\u200B');
  }).join('');
}

function docDefinition(L, A) {
  const cols = L.columns;
  const cellText = (txt, col, size) => ({
    text: wrapLong(txt, Math.max(4, Math.floor((pt(col.width) - 8) / (size * 0.75)))),
    fontSize: size, color: INK, bold: !!col.bold, alignment: col.align,
  });

  // ---- DATE / TO / FROM / RE
  const headBody = L.headRows.map((r) => [
    { text: r.label, bold: true, fontSize: 9, characterSpacing: 1, border: [false, false, false, true], margin: [0, 0, 0, 0] },
    {
      border: [false, false, false, true],
      stack: r.lines.map((ln) => ({ text: rich(ln.text, { ordinals: ln.ordinals }), bold: true, fontSize: ln.big ? 12 : 10.5, lineHeight: 1.1 })),
    },
  ]);
  const headTable = {
    table: { widths: [pt(1500), '*'], body: headBody, dontBreakRows: true },
    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => '#D9D9D9', paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: (i) => (i === 0 ? 0 : 5), paddingRight: () => 0 },
    margin: [0, 0, 0, 0],
  };

  // ---- product table
  const body = [cols.map((c) => ({ text: c.label, bold: true, color: '#FFFFFF', fontSize: 8, alignment: 'center', fillColor: RED }))];
  L.rows.forEach((r, ri) => body.push(cols.map((c) => Object.assign(cellText(r[c.key], c, 8.5), { fillColor: ri % 2 === 1 ? '#FBF7EF' : null }))));
  const prodTable = {
    table: { headerRows: 1, dontBreakRows: true, keepWithHeaderRows: 1, widths: cols.map((c) => pt(c.width) - 8), body },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 1 : i === 1 ? 0 : 0.5),
      hLineColor: (i, node) => (i === 0 || i === node.table.body.length ? RED : '#E3DCCB'),
      vLineWidth: () => 0,
      paddingLeft: () => 4, paddingRight: () => 4,
      paddingTop: (i) => (i === 0 ? 5 : 4.2), paddingBottom: (i) => (i === 0 ? 5 : 4.2),
    },
  };

  // ---- signatures (2 = left/right at opposite margins, 3 = original layout)
  const nb = [false, false, false, false];
  const S = L.signatories;
  const sw = (S.length === 2 ? [3600, 2906, 3600] : [3100, 353, 3100, 353, 3200]).map(pt);
  const idx = sw.map((_, i) => i);
  const sig = {
    unbreakable: true,
    table: {
      widths: sw, dontBreakRows: true,
      body: [
        idx.map((i) => (i % 2 ? { text: '', border: nb } : { text: S[i / 2].label, bold: true, fontSize: 8, characterSpacing: 1, border: nb })),
        idx.map((i) => (i % 2 ? { text: '', border: nb } : { text: ' ', border: [false, false, false, true], margin: [0, 0, 0, L.type === 'price-increase' ? 52 : 36] })),
        idx.map((i) => (i % 2 ? { text: '', border: nb } : {
          border: nb, margin: [0, 3, 0, 0],
          stack: [{ text: S[i / 2].name || ' ', bold: true, fontSize: 9.5, color: INK }, { text: S[i / 2].title, fontSize: 9, color: '#555555' }],
        })),
      ],
    },
    layout: { hLineWidth: () => 0.75, vLineWidth: () => 0, hLineColor: () => INK, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 2, paddingBottom: () => 2 },
  };

  const para = (t, mb) => ({ text: t, fontSize: 10.5, color: INK, lineHeight: 1.15, margin: [0, 0, 0, mb] });

  const content = [
    { text: L.docTitle, bold: true, fontSize: 20, characterSpacing: 1.5, margin: [0, 3, 0, 8] },
    headTable,
    { text: L.salutation, bold: true, fontSize: 10.5, color: INK, margin: [0, 12, 0, 6] },
  ];
  L.intro.forEach((p, i) => content.push(para(p, i === L.intro.length - 1 ? (L.noticeLine ? 12 : 10) : 7)));
  if (L.noticeLine) content.push({ text: L.noticeLine, bold: true, color: L.type === 'price-increase' ? RED : undefined, fontSize: 8.5, characterSpacing: 1.5, margin: [0, 0, 0, 3], keepWithNext: true });
  content.push(prodTable);
  content.push({ text: '', margin: [0, 5, 0, 0] });
  L.additional.forEach((p) => content.push(para(p, 7)));
  L.closing.slice(0, -1).forEach((p) => content.push(para(p, 10)));
  // last closing paragraph travels with the signature block (never stranded alone)
  const lastClosing = L.closing.length ? [para(L.closing[L.closing.length - 1], 22)] : [{ text: '', margin: [0, 0, 0, 22] }];
  content.push({ unbreakable: true, stack: lastClosing.concat([sig]) });

  const line = (y, color, w) => ({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: pt(10106), y2: 0, lineWidth: w, lineColor: color }], absolutePosition: { x: 45, y } });
  return {
    pageSize: 'A4',
    pageMargins: [45, 112.5, 45, 100],
    defaultStyle: { font: 'Arial', fontSize: 10.5 },
    info: { title: L.docTitle + (L.customer ? ' - ' + L.customer : ''), author: 'Grand Majesty Pharmaceutical Inc.', creator: 'GMPI Document Automation' },
    header: () => [
      { image: A.logo, width: 127.65, absolutePosition: { x: 45, y: 22.5 } },
      line(98.5, RED, 2.25), line(103.5, GOLD, 0.75),
    ],
    // pdfmake positions absolute elements inside the footer relative to the footer box
    footer: () => {
      const top = PAGE_H - 100;
      return [
        line(757 - top, GOLD, 0.75), line(762 - top, RED, 2.25),
        { image: A.footer, width: 418.3, absolutePosition: { x: (PAGE_W - 418.3) / 2, y: 770 - top } },
      ];
    },
    content,
  };
}

async function buildPdf(type, data) {
  const L = G.buildLayout(type, data);
  const A = await artwork();
  const doc = printer.createPdfKitDocument(docDefinition(L, A));
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { buildPdf };
