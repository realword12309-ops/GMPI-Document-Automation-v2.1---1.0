'use strict';
/* Backups are a ZIP: manifest.json + data.json (documents, history, users, counters) + exports/<id>.bin (generated Word/PDF files). */
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

async function createBackupZip(store) {
  const data = await store.exportAll(), zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ app: 'gmpi-document-automation', format: 1, createdAt: data.createdAt, documents: data.docs.length, revisions: data.revisions.length, exports: data.exports.length, users: data.users.length }, null, 1));
  zip.file('data.json', JSON.stringify(data));
  for (const e of data.exports) { const c = await store.exportContent(e.id); if (c) zip.file('exports/' + e.id + '.bin', c); }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function writeBackup(store, dir, keep = 14, prefix = 'gmpi-backup') {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.(\d+)Z$/, '$1').replace('T', '-');
  let file = path.join(dir, prefix + '-' + stamp + '.zip'), n = 1;
  while (fs.existsSync(file)) file = path.join(dir, prefix + '-' + stamp + '-' + ++n + '.zip'); // never overwrite an existing backup
  fs.writeFileSync(file + '.tmp', await createBackupZip(store)); fs.renameSync(file + '.tmp', file);
  const all = fs.readdirSync(dir).filter((f) => /^gmpi-backup-.*\.zip$/.test(f)).sort();
  all.slice(0, Math.max(0, all.length - keep)).forEach((f) => fs.unlinkSync(path.join(dir, f)));
  return file;
}

async function readBackup(buf) {
  let zip; try { zip = await JSZip.loadAsync(buf); } catch (e) { throw new Error('This is not a GMPI backup file (it is not a ZIP).'); }
  const man = zip.file('manifest.json'), dat = zip.file('data.json');
  if (!man || !dat) throw new Error('This is not a GMPI backup file.');
  const m = JSON.parse(await man.async('string')); if (m.app !== 'gmpi-document-automation') throw new Error('This is not a GMPI backup file.');
  const bundle = JSON.parse(await dat.async('string')), files = {};
  for (const e of bundle.exports || []) { const f = zip.file('exports/' + e.id + '.bin'); if (f) files[e.id] = await f.async('nodebuffer'); }
  return { m, bundle, files };
}
async function restoreBackup(store, buf) { const { m, bundle, files } = await readBackup(buf); await store.importAll(bundle, files); return m; }
/** Adds what is missing; deletes and overwrites nothing. */
async function mergeBackup(store, buf) { const { m, bundle, files } = await readBackup(buf); return Object.assign({ backupMadeAt: m.createdAt }, await store.mergeAll(bundle, files)); }
function latestBackup(dir) { try { const a = fs.readdirSync(dir).filter((f) => /^gmpi-backup-.*\.zip$/.test(f)).sort(); return a.length ? { file: a[a.length - 1], at: fs.statSync(path.join(dir, a[a.length - 1])).mtime.toISOString() } : null; } catch (e) { return null; } }
module.exports = { createBackupZip, writeBackup, restoreBackup, mergeBackup, latestBackup };
