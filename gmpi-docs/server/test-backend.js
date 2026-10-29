'use strict';
/* Backend integration test against a REAL database.
 *   SQLite (default):   node server/test-backend.js
 *   PostgreSQL:         DATABASE_URL=postgres://user:pass@host/db node server/test-backend.js
 * Creates its own temporary data; with PostgreSQL it uses (and cleans) the tables in that database. */
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { createApp, loadConfig } = require('./index');
const { createBackupZip, restoreBackup } = require('./backup');
const G = require('../shared/gmpi');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('PASS', n); } catch (e) { fail++; console.log('FAIL', n, '-', e.message); } };

function client(base) {
  let cookie = '';
  const c = async (m, p, body, raw) => {
    const r = await fetch(base + p, { method: m, headers: Object.assign(cookie ? { Cookie: cookie } : {}, body && !raw ? { 'Content-Type': 'application/json' } : {}), body: body ? (raw ? body : JSON.stringify(body)) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || ''; let j = null, buf = null;
    if (ct.includes('json')) j = await r.json(); else buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, json: j, buf, headers: r.headers };
  };
  return { c, clear: () => (cookie = '') };
}

async function boot(dir, legacyDir) {
  const cfg = loadConfig({ GMPI_DATA_DIR: dir, DATABASE_URL: process.env.DATABASE_URL || '', AUTH_REQUIRED: 'true', AUTO_BACKUP: 'false', SIGNATORY_PIN: 'test-pin-9' });
  cfg.legacyDir = legacyDir || path.join(dir, 'nolegacy');
  const a = await createApp(cfg, () => {});
  const srv = await new Promise((r) => { const s = a.app.listen(0, '127.0.0.1', () => r(s)); });
  return Object.assign(a, { srv, base: 'http://127.0.0.1:' + srv.address().port, stop: async () => { await new Promise((r) => srv.close(r)); await a.close(); } });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmpi-t-')), legacy = path.join(dir, 'legacy'); fs.mkdirSync(legacy);
  process.env.ADMIN_USERNAME = 'boss'; process.env.ADMIN_PASSWORD = 'correct-horse-battery';
  // a legacy JSON draft from the first version (must be migrated on SQLite)
  const old = G.newDocData('price-list', 'October 06, 2026'); old.toName = 'Legacy Customer Inc.'; old.products = [Object.assign(G.emptyProduct('price-list'), { itemDescription: 'LEG-1', packaging: 'OLD PRODUCT' })];
  fs.writeFileSync(path.join(legacy, 'd_legacy0001abc.json'), JSON.stringify({ id: 'd_legacy0001abc', type: 'price-list', title: 'Legacy Customer Inc.', status: 'draft', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', data: old, exports: [] }));
  let app = await boot(dir, legacy), cl = client(app.base);
  console.log('engine:', app.db.kind);
  if (app.db.kind === 'postgres') for (const x of ['sessions', 'exports', 'revisions', 'docs', 'counters', 'users']) await app.db.run('DELETE FROM ' + x);

  await t('API requires login', async () => { assert.strictEqual((await cl.c('GET', '/api/docs')).status, 401); assert.strictEqual((await cl.c('GET', '/healthz')).status, 200); });
  if (app.db.kind === 'postgres') { await app.auth.bootstrap(process.env, () => {}); }
  await t('wrong password rejected, correct accepted (HttpOnly cookie)', async () => {
    assert.strictEqual((await cl.c('POST', '/api/auth/login', { username: 'boss', password: 'nope-nope-nope' })).status, 401);
    const r = await cl.c('POST', '/api/auth/login', { username: 'boss', password: 'correct-horse-battery' }); assert.strictEqual(r.status, 200);
    assert(/HttpOnly/.test(r.headers.get('set-cookie')) && /SameSite=Strict/.test(r.headers.get('set-cookie')));
  });
  if (app.db.kind === 'sqlite') await t('legacy JSON draft migrated (once)', async () => { const l = await cl.c('GET', '/api/docs?q=legacy'); assert.strictEqual(l.json.total, 1); assert.strictEqual(l.json.items[0].id, 'd_legacy0001abc'); assert(/^PL-2026-\d{4}$/.test(l.json.items[0].refNo)); });

  const mk = (name, n) => { const d = G.newDocData('price-increase', 'October 27, 2026'); d.toName = name; d.principal = 'AMPALAY'; d.products = Array.from({ length: n }, (_, i) => Object.assign(G.emptyProduct('price-increase'), { itemCode: '00' + i, description: name + ' PRODUCT ' + i, oldPrice: '100.00', newPrice: '105.00', percent: '5%' })); return d; };
  let A, B;
  await t('create documents with sequential reference numbers', async () => {
    A = (await cl.c('POST', '/api/docs', { type: 'price-increase', data: mk('Alpha Drug', 3) })).json; B = (await cl.c('POST', '/api/docs', { type: 'price-increase', data: mk('Beta Pharma', 2) })).json;
    assert(/^PIN-\d{4}-0001$/.test(A.refNo) && /^PIN-\d{4}-0002$/.test(B.refNo), A.refNo + ' ' + B.refNo); assert.strictEqual(A.revision, 1);
  });
  await t('update with correct base revision; other document untouched', async () => {
    const d = (await cl.c('GET', '/api/docs/' + A.id)).json.data; d.toName = 'Alpha Drug Corp.';
    const u = await cl.c('POST', '/api/docs', { id: A.id, type: 'price-increase', data: d, baseRevision: 1 }); assert.strictEqual(u.json.revision, 2);
    assert.strictEqual((await cl.c('GET', '/api/docs/' + B.id)).json.data.toName, 'Beta Pharma'); assert.strictEqual((await cl.c('GET', '/api/docs/' + B.id)).json.revision, 1);
  });
  await t('stale save is refused (409), not silently overwritten', async () => {
    const d = (await cl.c('GET', '/api/docs/' + A.id)).json.data; d.toName = 'STALE OVERWRITE';
    const u = await cl.c('POST', '/api/docs', { id: A.id, type: 'price-increase', data: d, baseRevision: 1 }); assert.strictEqual(u.status, 409);
    assert.strictEqual((await cl.c('GET', '/api/docs/' + A.id)).json.data.toName, 'Alpha Drug Corp.');
  });
  await t('edit history keeps every revision and can be read back', async () => {
    const r = (await cl.c('GET', '/api/docs/' + A.id + '/revisions')).json; assert.deepStrictEqual(r.map((x) => x.revision), [2, 1]);
    assert.strictEqual((await cl.c('GET', '/api/docs/' + A.id + '/revisions/1')).json.data.toName, 'Alpha Drug');
  });
  let X;
  await t('generated Word + PDF are stored and re-downloadable byte-for-byte', async () => {
    const d = (await cl.c('GET', '/api/docs/' + A.id)).json.data;
    const w = await cl.c('POST', '/api/export/docx', { type: 'price-increase', data: d, id: A.id }); const p = await cl.c('POST', '/api/export/pdf', { type: 'price-increase', data: d, id: A.id });
    assert.strictEqual(w.buf.slice(0, 2).toString(), 'PK'); assert.strictEqual(p.buf.slice(0, 5).toString(), '%PDF-');
    const list = (await cl.c('GET', '/api/docs/' + A.id + '/exports')).json; assert.strictEqual(list.length, 2);
    const again = await cl.c('GET', '/api/exports/' + w.headers.get('x-export-id')); assert(again.buf.equals(w.buf)); X = list;
    assert.strictEqual((await cl.c('GET', '/api/docs/' + A.id)).json.status, 'exported');
  });
  await t('search finds by customer, reference, principal and product text', async () => {
    for (const q of ['alpha', A.refNo.toLowerCase(), 'ampalay', 'beta pharma product 1']) assert((await cl.c('GET', '/api/docs?q=' + encodeURIComponent(q))).json.total >= 1, q);
    assert.strictEqual((await cl.c('GET', '/api/docs?q=zzznotfound')).json.total, 0); assert.strictEqual((await cl.c('GET', '/api/docs?q=' + encodeURIComponent("%'; DROP TABLE docs;--"))).json.total, 0);
  });
  await t('duplicate creates an independent copy with its own reference', async () => {
    const c = (await cl.c('POST', '/api/docs/' + A.id + '/duplicate')).json; assert.notStrictEqual(c.id, A.id); assert.notStrictEqual(c.refNo, A.refNo);
    assert.strictEqual((await cl.c('GET', '/api/docs/' + A.id)).json.revision, 2);
  });
  await t('roles: viewer can read/download but not save or delete', async () => {
    assert.strictEqual((await cl.c('POST', '/api/users', { username: 'viewer1', password: 'viewer-password-1', role: 'viewer' })).status, 200);
    const v = client(app.base); assert.strictEqual((await v.c('POST', '/api/auth/login', { username: 'viewer1', password: 'viewer-password-1' })).status, 200);
    assert.strictEqual((await v.c('GET', '/api/docs')).status, 200); assert.strictEqual((await v.c('POST', '/api/docs', { type: 'price-increase', data: mk('X', 1) })).status, 403);
    assert.strictEqual((await v.c('DELETE', '/api/docs/' + B.id)).status, 403); assert.strictEqual((await v.c('GET', '/api/users')).status, 403);
    assert.strictEqual((await v.c('POST', '/api/export/pdf', { type: 'price-increase', data: mk('X', 1) })).status, 200);
  });
  await t('signatory lock is enforced by the server', async () => {
    const d = G.newDocData('price-list', 'x'); d.products = [Object.assign(G.emptyProduct('price-list'), { itemDescription: 'A' })]; d.signatories[0].name = 'Someone Else';
    const r = await cl.c('POST', '/api/docs', { type: 'price-list', data: d }); assert.strictEqual(r.status, 403);
  });
  let before, snap;
  await t('backup ZIP restores into an empty database (docs, history, exports, users)', async () => {
    before = await app.store.counts(); const zip = snap = await createBackupZip(app.store);
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gmpi-r-'));
    if (app.db.kind === 'sqlite') {
      const other = await boot(dir2); await restoreBackup(other.store, zip); const after = await other.store.counts();
      assert.deepStrictEqual(after, before); const d = await other.store.get(A.id); assert.strictEqual(d.data.toName, 'Alpha Drug Corp.'); assert.strictEqual((await other.store.listExports(A.id)).length, 2);
      await other.stop();
    } else { await restoreBackup(app.store, zip); assert.deepStrictEqual(await app.store.counts(), before); }
  });
  await t('two backups in the same instant never overwrite each other', async () => {
    const { writeBackup } = require('./backup'), bdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmpi-b-'));
    const f1 = await writeBackup(app.store, bdir), f2 = await writeBackup(app.store, bdir); assert.notStrictEqual(f1, f2); assert.strictEqual(fs.readdirSync(bdir).length, 2);
  });
  await t('records survive a full server restart', async () => {
    await app.stop(); app = await boot(dir, legacy); cl = client(app.base);
    assert.strictEqual((await cl.c('POST', '/api/auth/login', { username: 'boss', password: 'correct-horse-battery' })).status, 200);
    const l = (await cl.c('GET', '/api/docs')).json; assert(l.total >= 3, 'total ' + l.total); assert.strictEqual((await cl.c('GET', '/api/docs/' + A.id)).json.data.toName, 'Alpha Drug Corp.');
    if (app.db.kind === 'sqlite') assert.strictEqual((await app.store.importLegacyDir(legacy)).imported, 0); // not imported twice
  });
  await t('delete removes only that document', async () => { assert.strictEqual((await cl.c('DELETE', '/api/docs/' + B.id)).status, 200); assert.strictEqual((await cl.c('GET', '/api/docs/' + B.id)).status, 404); assert.strictEqual((await cl.c('GET', '/api/docs/' + A.id)).status, 200); });

  // ---------------------------------------------------------------- online-deployment features
  const { mergeBackup } = require('./backup'), JSZip = require('jszip');
  await t('merge-import adds only what is missing and never overwrites or deletes (moving PC records online)', async () => {
    const cnt0 = await app.store.counts(); // B was deleted above, A is newer than the snapshot
    const r = await mergeBackup(app.store, snap);
    assert.strictEqual(r.documentsAdded, 1, JSON.stringify(r)); assert(r.documentsAlreadyPresent >= 2); assert(r.revisionsAdded >= 1);
    assert.strictEqual((await app.store.get(B.id)).data.toName, 'Beta Pharma');            // the missing one came back
    assert.strictEqual((await app.store.get(A.id)).data.toName, 'Alpha Drug Corp.');       // the existing one untouched
    assert.strictEqual((await app.store.counts()).users, cnt0.users);                        // users never imported
    assert.strictEqual(r.renumbered, 0, 'no collision expected for the same database');
    const again = await mergeBackup(app.store, snap); assert.strictEqual(again.documentsAdded, 0); // repeating is harmless
    const nr = (await cl.c('POST', '/api/docs', { type: 'price-increase', data: mk('Gamma', 1) })).json; assert(!/-000[12]$/.test(nr.refNo), 'reference number reused: ' + nr.refNo);
  });
  await t('merge-import gives a fresh reference number when an imported number is already used by another document', async () => {
    const z = await JSZip.loadAsync(snap), d = JSON.parse(await z.file('data.json').async('string')), src = d.docs.find((x) => x.id === A.id);
    const clone = Object.assign({}, src, { id: 'd_collide0001xx' }); d.docs = [clone]; d.revisions = []; d.exports = []; z.file('data.json', JSON.stringify(d));
    const r = await mergeBackup(app.store, await z.generateAsync({ type: 'nodebuffer' })); assert.strictEqual(r.documentsAdded, 1); assert.strictEqual(r.renumbered, 1);
    const got = await app.store.get('d_collide0001xx'); assert.notStrictEqual(got.refNo, A.refNo); assert(/^PIN-\d{4}-\d{4}$/.test(got.refNo));
    const all = (await app.store.list({ limit: 500 })).items.map((x) => x.refNo); assert.strictEqual(new Set(all).size, all.length, 'duplicate reference numbers');
  });
  await t('merge-import is available to administrators only and rejects non-backup files', async () => {
    const raw = (c, buf) => c.c('POST', '/api/admin/import-backup', buf, true);
    const bad = await raw(cl, Buffer.from('not a zip')); assert.strictEqual(bad.status, 400);
    const v2 = client(app.base); await v2.c('POST', '/api/auth/login', { username: 'viewer1', password: 'viewer-password-1' });
    assert.strictEqual((await raw(v2, snap)).status, 403); assert.strictEqual((await raw(client(app.base), snap)).status, 401);
  });
  await t('restoring a backup that has no users keeps the online accounts (nobody gets locked out)', async () => {
    const z = await JSZip.loadAsync(snap), d = JSON.parse(await z.file('data.json').async('string')); d.users = []; z.file('data.json', JSON.stringify(d));
    const nb = await z.generateAsync({ type: 'nodebuffer' }); const u0 = (await app.store.counts()).users; assert(u0 >= 1);
    await restoreBackup(app.store, nb); assert.strictEqual((await app.store.counts()).users, u0);
    const c2 = client(app.base); assert.strictEqual((await c2.c('POST', '/api/auth/login', { username: 'boss', password: 'correct-horse-battery' })).status, 200);
  });
  await t('ADMIN_RESET recovers a locked-out administrator (or creates one) and ends old sessions', async () => {
    const quiet = () => {};
    await assert.rejects(app.auth.bootstrap({ ADMIN_RESET: 'true', ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'short' }, quiet), /at least 10/);
    await assert.rejects(app.auth.bootstrap({ ADMIN_RESET: 'true' }, quiet), /needs ADMIN_USERNAME/);
    await app.auth.bootstrap({ ADMIN_RESET: 'true', ADMIN_USERNAME: 'Boss', ADMIN_PASSWORD: 'brand-new-pass-123' }, quiet);
    assert.strictEqual((await cl.c('GET', '/api/docs')).status, 401, 'old session must be gone');
    const c2 = client(app.base); assert.strictEqual((await c2.c('POST', '/api/auth/login', { username: 'boss', password: 'correct-horse-battery' })).status, 401);
    assert.strictEqual((await c2.c('POST', '/api/auth/login', { username: 'boss', password: 'brand-new-pass-123' })).status, 200);
    await app.auth.bootstrap({ ADMIN_RESET: 'true', ADMIN_USERNAME: 'newadmin', ADMIN_PASSWORD: 'another-pass-123456' }, quiet);
    assert(!!(await app.auth.listUsers()).find((u) => u.username === 'newadmin' && u.role === 'admin'));
    await app.auth.bootstrap({ ADMIN_USERNAME: 'x-should-be-ignored', ADMIN_PASSWORD: 'ignored-ignored-1' }, quiet); // normal start never adds users once some exist
    assert(!(await app.auth.listUsers()).find((u) => u.username === 'x-should-be-ignored'));
    cl = c2;
  });
  await t('production mode refuses to run without a database URL (no temporary storage online)', async () => {
    const old = process.env.SIGNATORY_PIN; process.env.SIGNATORY_PIN = 'a-private-pin';
    try { await assert.rejects(createApp(loadConfig({ NODE_ENV: 'production', SIGNATORY_PIN: 'a-private-pin', GMPI_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'gmpi-p-')) }), () => {}), /DATABASE_URL/); }
    finally { if (old === undefined) delete process.env.SIGNATORY_PIN; else process.env.SIGNATORY_PIN = old; }
  });
  await t('public hardening: no big bodies before login, cross-site writes blocked, security headers, no source/data files served', async () => {
    const anon = client(app.base);
    assert.strictEqual((await anon.c('POST', '/api/auth/login', { username: 'a', password: 'x'.repeat(200000) })).status, 413);
    assert.strictEqual((await anon.c('POST', '/api/export/pdf', { type: 'price-list', data: {} })).status, 401);
    const r = await fetch(app.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' }); assert.strictEqual(r.status, 403);
    const h = await fetch(app.base + '/'); assert.strictEqual(h.headers.get('x-frame-options'), 'DENY'); assert(/default-src 'self'/.test(h.headers.get('content-security-policy'))); assert.strictEqual(h.headers.get('x-powered-by'), null);
    for (const p of ['/server/db.js', '/config.json', '/package.json', '/.env', '/render.yaml', '/templates/official-price-list.docx', '/../server/index.js']) { const x = await fetch(app.base + p); assert(x.status === 404 || /<!doctype html>/i.test(await x.text()) === false, p + ' exposed'); assert.notStrictEqual(x.status, 200, p + ' exposed'); }
    assert.strictEqual((await fetch(app.base + '/healthz')).status, 200);
  });
  await app.stop();
  console.log(`\n${pass} passed, ${fail} failed  [${process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite'}]`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(1); });
