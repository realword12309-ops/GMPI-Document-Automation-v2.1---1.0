'use strict';
/*
 * Genuine .docx generation.
 * The original SANTE BARLEY.docx package is used as the base (header with logo,
 * footer with address image, styles, theme, page size and margins are kept
 * byte-for-byte). Only word/document.xml is regenerated, using the same
 * paragraph/table formatting found in the template.
 */
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const G = require('../shared/gmpi');

const TEMPLATE = path.join(__dirname, '..', 'templates', 'official-price-list.docx');
let templateBuf = null;
function getTemplate() { return templateBuf || (templateBuf = fs.readFileSync(TEMPLATE)); }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const RF = '<w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/>';

function rPr(o) {
  return '<w:rPr>' + RF + (o.b ? '<w:b/><w:bCs/>' : '') + (o.color ? `<w:color w:val="${o.color}"/>` : '') +
    (o.spacing ? `<w:spacing w:val="${o.spacing}"/>` : '') + `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` +
    (o.sup ? '<w:vertAlign w:val="superscript"/>' : '') + '</w:rPr>';
}

/** One logical text (may contain \n) -> runs. */
function runs(text, o) {
  const parts = String(text).split('\n');
  const segsFor = (line) => (o.ordinals && line ? G.ordinalSegments(line) : [{ t: line }]);
  let out = '';
  parts.forEach((line, i) => {
    segsFor(line).forEach((seg, j) => {
      out += `<w:r>${rPr(Object.assign({}, o, { sup: seg.sup }))}` + (i > 0 && j === 0 ? '<w:br/>' : '') + `<w:t xml:space="preserve">${esc(seg.t)}</w:t></w:r>`;
    });
  });
  return out;
}

function para(inner, p) {
  p = p || {};
  const sp = p.spacing || {};
  return '<w:p><w:pPr>' + (p.style ? `<w:pStyle w:val="${p.style}"/>` : '') + (p.keepNext ? '<w:keepNext/>' : '') +
    `<w:spacing${sp.before != null ? ` w:before="${sp.before}"` : ''} w:after="${sp.after != null ? sp.after : 0}" w:line="${sp.line || 240}" w:lineRule="auto"/>` +
    (p.jc ? `<w:jc w:val="${p.jc}"/>` : '') + '</w:pPr>' + (inner || '') + '</w:p>';
}

const mar = (t, l, b, r) => '<w:tcMar>' + (t != null ? `<w:top w:w="${t}" w:type="dxa"/>` : '') + `<w:left w:w="${l}" w:type="dxa"/>` +
  (b != null ? `<w:bottom w:w="${b}" w:type="dxa"/>` : '') + (r != null ? `<w:right w:w="${r}" w:type="dxa"/>` : '') + '</w:tcMar>';
const NOB = '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
const LOOK = '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>';

function headTable(L) {
  const w = [1500, 8606];
  let x = `<w:tbl><w:tblPr><w:tblW w:w="10106" w:type="dxa"/>${NOB}<w:tblLayout w:type="fixed"/>${LOOK}</w:tblPr><w:tblGrid><w:gridCol w:w="${w[0]}"/><w:gridCol w:w="${w[1]}"/></w:tblGrid>`;
  L.headRows.forEach((r) => {
    const bb = '<w:tcBorders><w:bottom w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/></w:tcBorders>';
    x += '<w:tr><w:trPr><w:cantSplit/></w:trPr>';
    x += `<w:tc><w:tcPr><w:tcW w:w="${w[0]}" w:type="dxa"/>${bb}${mar(60, 0, 60)}<w:vAlign w:val="center"/></w:tcPr>` +
      para(runs(r.label, { b: true, spacing: 20, sz: 18 }), { spacing: { line: 264 } }) + '</w:tc>';
    x += `<w:tc><w:tcPr><w:tcW w:w="${w[1]}" w:type="dxa"/>${bb}${mar(60, 100, 60)}<w:vAlign w:val="center"/></w:tcPr>` +
      r.lines.map((ln) => para(runs(ln.text, { b: ln.bold, sz: ln.big ? 24 : 21, ordinals: ln.ordinals }), { spacing: { line: ln.big ? 240 : 264 } })).join('') + '</w:tc></w:tr>';
  });
  return x + '</w:tbl>';
}

function productTable(L) {
  const cols = L.columns;
  let x = `<w:tbl><w:tblPr><w:tblW w:w="${G.TABLE_WIDTH}" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="9E0B14"/><w:left w:val="nil"/><w:bottom w:val="single" w:sz="8" w:space="0" w:color="9E0B14"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/>${LOOK}</w:tblPr><w:tblGrid>` +
    cols.map((c) => `<w:gridCol w:w="${c.width}"/>`).join('') + '</w:tblGrid>';
  // header row (repeats on every page)
  x += '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="480"/><w:tblHeader/></w:trPr>';
  cols.forEach((c) => {
    x += `<w:tc><w:tcPr><w:tcW w:w="${c.width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="9E0B14"/>${mar(90, 80, 90, 80)}<w:vAlign w:val="center"/></w:tcPr>` +
      para(runs(c.label, { b: true, color: 'FFFFFF', sz: 16 }), { jc: 'center' }) + '</w:tc>';
  });
  x += '</w:tr>';
  L.rows.forEach((row, ri) => {
    x += '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="400"/></w:trPr>';
    cols.forEach((c) => {
      const band = ri % 2 === 1 ? '<w:shd w:val="clear" w:color="auto" w:fill="FBF7EF"/>' : '';
      x += `<w:tc><w:tcPr><w:tcW w:w="${c.width}" w:type="dxa"/><w:tcBorders><w:bottom w:val="single" w:sz="4" w:space="0" w:color="E3DCCB"/></w:tcBorders>${band}${mar(70, 80, 70, 80)}<w:vAlign w:val="center"/></w:tcPr>` +
        para(runs(row[c.key], { b: c.bold, color: '222222', sz: 17 }), { jc: c.align === 'left' ? null : c.align }) + '</w:tc>';
    });
    x += '</w:tr>';
  });
  return x + '</w:tbl>';
}

function sigTable(L) {
  const s = L.signatories;
  // 2 signatories: one block at each margin with a wide gap between; 3: the original three-column layout
  const w = s.length === 2 ? [3600, 2906, 3600] : [3100, 353, 3100, 353, 3200];
  const idx = w.map((_, i) => i);
  const m0 = mar(null, 0, null, 0);
  const cell = (i, inner, extra) => `<w:tc><w:tcPr><w:tcW w:w="${w[i]}" w:type="dxa"/>${extra || ''}${m0}${i % 2 ? '<w:vAlign w:val="center"/>' : ''}</w:tcPr>${inner}</w:tc>`;
  const gap = (i) => cell(i, para('', { keepNext: true }));
  let x = `<w:tbl><w:tblPr><w:tblW w:w="10106" w:type="dxa"/>${NOB}<w:tblLayout w:type="fixed"/>${LOOK}</w:tblPr><w:tblGrid>${w.map((v) => `<w:gridCol w:w="${v}"/>`).join('')}</w:tblGrid>`;
  x += '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="300"/></w:trPr>' +
    idx.map((i) => (i % 2 ? gap(i) : `<w:tc><w:tcPr><w:tcW w:w="${w[i]}" w:type="dxa"/>${m0}<w:vAlign w:val="bottom"/></w:tcPr>` +
      para(runs(s[i / 2].label, { b: true, color: '000000', spacing: 20, sz: 16 }), { keepNext: true }) + '</w:tc>')).join('') + '</w:tr>';
  x += `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${L.type === 'price-increase' ? 1300 : 900}"/></w:trPr>` +
    idx.map((i) => (i % 2 ? gap(i) : cell(i, para('', { keepNext: true }), '<w:tcBorders><w:bottom w:val="single" w:sz="6" w:space="0" w:color="222222"/></w:tcBorders>'))).join('') + '</w:tr>';
  x += '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="620"/></w:trPr>' +
    idx.map((i) => {
      if (i % 2) return cell(i, para(''));
      const sg = s[i / 2];
      return cell(i, para(runs(sg.name, { b: true, color: '222222', sz: 19 }), { spacing: { before: 60 } }) + para(runs(sg.title, { color: '555555', sz: 18 })));
    }).join('') + '</w:tr>';
  return x + '</w:tbl>';
}

function bodyXml(L) {
  const T = (t, o, p) => para(runs(t, Object.assign({ color: '222222', sz: 21 }, o)), p);
  let b = '';
  b += para(runs(L.docTitle, { b: true, color: '000000', spacing: 30, sz: 40 }), { spacing: { before: 60, after: 60 } });
  b += para('', { spacing: { line: 120 } });
  b += headTable(L);
  b += para('', { spacing: { line: 200 } });
  b += T(L.salutation, { b: true }, { spacing: { after: 120, line: 264 }, keepNext: !L.intro.length && !L.noticeLine });
  L.intro.forEach((p, i) => {
    const last = i === L.intro.length - 1;
    b += T(p, {}, { spacing: { after: last && !L.noticeLine ? 200 : last ? 240 : 140, line: 276 }, keepNext: last });
  });
  if (L.noticeLine) b += para(runs(L.noticeLine, { b: true, color: L.type === 'price-increase' ? '9E0B14' : '000000', spacing: 30, sz: 17 }), { keepNext: true, spacing: { after: 60 } });
  b += productTable(L);
  b += para('', { spacing: { line: 200 } });
  L.additional.forEach((p) => { b += T(p, {}, { spacing: { after: 140, line: 276 } }); });
  L.closing.forEach((p, i) => { b += T(p, {}, { spacing: { after: i === L.closing.length - 1 ? 0 : 200, line: 276 }, keepNext: i === L.closing.length - 1 }); });
  b += para('', { spacing: { after: 0 }, keepNext: true });
  b += para('', { spacing: { after: 0 }, keepNext: true });
  b += sigTable(L);
  b += '<w:p/>';
  return b;
}

async function buildDocx(type, data) {
  const L = G.buildLayout(type, data);
  const zip = await JSZip.loadAsync(getTemplate());
  const orig = await zip.file('word/document.xml').async('string');
  const head = orig.slice(0, orig.indexOf('<w:body>') + '<w:body>'.length);
  const sect = orig.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)[0]; // A4, margins, header/footer refs
  zip.file('word/document.xml', head + bodyXml(L) + sect + '</w:body></w:document>');
  // document properties: title + modified time
  const core = zip.file('docProps/core.xml');
  if (core) {
    let c = await core.async('string');
    const title = L.docTitle + (L.customer ? ' - ' + L.customer : '');
    if (/<dc:title>[\s\S]*?<\/dc:title>|<dc:title\/>/.test(c)) c = c.replace(/<dc:title>[\s\S]*?<\/dc:title>|<dc:title\/>/, `<dc:title>${esc(title)}</dc:title>`);
    else c = c.replace('</cp:coreProperties>', `<dc:title>${esc(title)}</dc:title></cp:coreProperties>`);
    c = c.replace(/(<dcterms:modified[^>]*>)[^<]*/, '$1' + new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
    zip.file('docProps/core.xml', c);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

module.exports = { buildDocx };
