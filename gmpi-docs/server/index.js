'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const G = require('../shared/gmpi');
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createStore } = require('./store');
const { createAuth } = require('./auth');
const { buildDocx } = require('./docx-gen');
const { buildPdf } = require('./pdf-gen');
const { parseUpload } = require('./importer');
const { createBackupZip, writeBackup, mergeBackup, latestBackup } = require('./backup');
const VERSION = require('../package.json').version;

async function createApp(cfg, log = console.log) {
  const ROOT = cfg.root;
  if (cfg.authRequired && cfg.production && (!process.env.SIGNATORY_PIN || cfg.signatoryPin === 'gmpi-admin'))
    throw new Error('Set a private SIGNATORY_PIN environment variable (not the default) before running online.');
  // Online data must never sit on a host's temporary disk: it would vanish at the next deploy/restart.
  if (cfg.production && !cfg.databaseUrl && process.env.ALLOW_LOCAL_DB_IN_PRODUCTION !== 'true')
    throw new Error('DATABASE_URL is not set. Online (production) mode needs the PostgreSQL connection string so records are stored permanently.');
  const db = await openDb(cfg);
  const store = createStore(db);
  const auth = createAuth(db, { required: cfg.authRequired, sessionHours: cfg.sessionHours });
  await auth.bootstrap(process.env, log);
  if (db.kind === 'sqlite') { const m = await store.importLegacyDir(cfg.legacyDir); if (m.imported || m.failed.length) log(`Migrated ${m.imported} saved document(s) from the earlier file-based version` + (m.failed.length ? `; ${m.failed.length} could not be migrated: ${m.failed.join('; ')}` : '.')); }

  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    const o = req.headers.origin; // only this site may POST/PUT/DELETE (blocks other web pages poking at the API)
    if (o && req.method !== 'GET') { try { if (new URL(o).host !== req.headers.host) return res.status(403).json({ error: 'Cross-origin request blocked.' }); } catch (e) { return res.status(403).end(); } }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-src blob:; object-src blob:; base-uri 'none'; form-action 'self'");
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/healthz', async (req, res) => { try { await db.query('SELECT 1'); res.json({ ok: true, version: VERSION }); } catch (e) { res.status(503).json({ ok: false }); } });
  // static: only the web UI. Data/backup folders are never under these paths.
  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use(express.static(path.join(ROOT, 'public'), { etag: false, index: 'index.html', setHeaders: (r) => r.setHeader('Cache-Control', 'no-cache') }));
  app.use('/api', auth.middleware(['/auth/login', '/auth/logout', '/config']));
  // Large bodies (imports/exports up to 60 MB) are only read AFTER the login check; the public login call accepts a tiny body only.
  const jsonBig = express.json({ limit: '60mb' }), jsonTiny = express.json({ limit: '20kb' });
  app.use((req, res, next) => (req.path === '/api/auth/login' ? jsonTiny : jsonBig)(req, res, next));

  const editor = auth.need('admin', 'editor'), admin = auth.need('admin');

  // ------------------------------------------------------------ auth
  app.post('/api/auth/login', async (req, res, next) => {
    try { const r = await auth.login((req.body || {}).username, (req.body || {}).password, req.ip); auth.setCookie(res, req, r.token, r.maxAge); res.json({ user: r.user }); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
  });
  app.post('/api/auth/logout', async (req, res, next) => { try { await auth.logout(auth.cookieToken(req)); auth.setCookie(res, req, '', 0); res.json({ ok: true }); } catch (e) { next(e); } });

  // signatory unlock (approver names/titles that have template defaults)
  const tokens = new Map(); let fails = 0, lockedUntil = 0;
  const tokenOk = (req) => { const t = req.headers['x-unlock-token']; const e = t && tokens.get(t); if (e && e > Date.now()) return true; if (t) tokens.delete(t); return false; };
  app.post('/api/unlock', editor, (req, res) => {
    if (Date.now() < lockedUntil) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
    const a = Buffer.from(String((req.body || {}).pin || '')), b = Buffer.from(String(cfg.signatoryPin));
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) { if (++fails >= 5) { lockedUntil = Date.now() + 60000; fails = 0; } return res.status(401).json({ error: 'Incorrect PIN.' }); }
    fails = 0; const t = crypto.randomBytes(24).toString('hex'); tokens.set(t, Date.now() + 8 * 3600 * 1000);
    res.json({ token: t, hours: 8 });
  });
  function guardSignatories(type, data, req, res) {
    const changed = G.signatoriesChanged(type, data);
    if (changed.length && !tokenOk(req)) { res.status(403).json({ error: 'locked', message: 'Approval names/titles were changed but signatory editing is locked: ' + changed.join(', ') + '. Unlock with the PIN or restore the defaults.', fields: changed }); return false; }
    return true;
  }
  const badType = (type) => !G.DOC_TYPES[type];

  // ------------------------------------------------------------ config / status
  app.get('/api/config', async (req, res, next) => {
    try {
      let user = null; if (cfg.authRequired) user = await auth.userForToken(auth.cookieToken(req)); else user = { id: 'local', username: 'local', role: 'admin' };
      const out = { version: VERSION, auth: { required: cfg.authRequired, user }, types: Object.values(G.DOC_TYPES).map((t) => ({ id: t.id, name: t.name, provisional: t.provisional })) };
      if (user) Object.assign(out, {
        storage: { engine: db.kind, persistent: true, location: db.kind === 'sqlite' ? db.file : 'PostgreSQL database (DATABASE_URL)', backups: cfg.autoBackup ? cfg.backupDir : null },
        lockedDefaults: Object.fromEntries(Object.values(G.DOC_TYPES).map((t) => [t.id, t.defaults.signatories.map((s) => ({ name: !!s.name, title: !!s.title }))])),
        unlocked: tokenOk(req),
      });
      res.json(out);
    } catch (e) { next(e); }
  });
  app.get('/api/admin/status', admin, async (req, res, next) => { try { res.json({ engine: db.kind, counts: await store.counts(), lastBackup: cfg.autoBackup ? latestBackup(cfg.backupDir) : null, backupDir: cfg.autoBackup ? cfg.backupDir : null, version: VERSION }); } catch (e) { next(e); } });
  app.get('/api/admin/backup', admin, async (req, res, next) => {
    try { const buf = await createBackupZip(store); res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', `attachment; filename="gmpi-backup-${new Date().toISOString().slice(0, 10)}.zip"`); res.end(buf); } catch (e) { next(e); }
  });
  // Move records from the PC version (or another backup) into this database WITHOUT deleting or overwriting anything here.
  app.post('/api/admin/import-backup', admin, express.raw({ type: '*/*', limit: '200mb' }), async (req, res) => {
    try { if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('No file received.'); res.json(await mergeBackup(store, req.body)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.post('/api/admin/backup-now', admin, async (req, res, next) => { try { res.json({ file: await writeBackup(store, cfg.backupDir) }); } catch (e) { next(e); } });

  // ------------------------------------------------------------ users (admin)
  app.get('/api/users', admin, async (req, res, next) => { try { res.json(await auth.listUsers()); } catch (e) { next(e); } });
  app.post('/api/users', admin, async (req, res) => { try { res.json(await auth.createUser(req.body.username, req.body.password, req.body.role)); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.patch('/api/users/:id', admin, async (req, res) => { try { await auth.updateUser(req.params.id, req.body || {}); res.json({ ok: true }); } catch (e) { res.status(400).json({ error: e.message }); } });

  // ------------------------------------------------------------ documents
  app.get('/api/docs', async (req, res, next) => { try { res.json(await store.list({ q: req.query.q, type: req.query.type, status: req.query.status, limit: req.query.limit, offset: req.query.offset })); } catch (e) { next(e); } });
  app.get('/api/docs/:id', async (req, res, next) => { try { const d = await store.get(req.params.id); d ? res.json(d) : res.status(404).json({ error: 'Not found' }); } catch (e) { next(e); } });
  app.post('/api/docs', editor, async (req, res, next) => {
    const { id, type, data, baseRevision } = req.body || {};
    if (badType(type)) return res.status(400).json({ error: 'Unknown document type.' });
    if (!guardSignatories(type, data, req, res)) return;
    try { res.json(await store.save({ id, type, data, baseRevision, user: req.user.username })); }
    catch (e) { if (e.status === 409) return res.status(409).json({ error: 'conflict', message: e.message, current: e.current }); if (/Invalid|cannot change/.test(e.message)) return res.status(400).json({ error: e.message }); next(e); }
  });
  app.delete('/api/docs/:id', editor, async (req, res, next) => { try { (await store.remove(req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: 'Not found' }); } catch (e) { next(e); } });
  app.post('/api/docs/:id/duplicate', editor, async (req, res, next) => { try { const d = await store.duplicate(req.params.id, req.user.username); d ? res.json(d) : res.status(404).json({ error: 'Not found' }); } catch (e) { next(e); } });
  app.get('/api/docs/:id/revisions', async (req, res, next) => { try { res.json(await store.revisions(req.params.id)); } catch (e) { next(e); } });
  app.get('/api/docs/:id/revisions/:rev', async (req, res, next) => { try { const r = await store.getRevision(req.params.id, req.params.rev); r ? res.json(r) : res.status(404).json({ error: 'Not found' }); } catch (e) { next(e); } });
  app.get('/api/docs/:id/exports', async (req, res, next) => { try { res.json(await store.listExports(req.params.id)); } catch (e) { next(e); } });
  app.get('/api/exports/:id', async (req, res, next) => {
    try {
      const x = await store.getExport(req.params.id); if (!x) return res.status(404).json({ error: 'Not found' });
      res.setHeader('Content-Type', MIME[x.format]); res.setHeader('Content-Disposition', disp(x.filename)); res.end(x.content);
    } catch (e) { next(e); }
  });

  // ------------------------------------------------------------ export (Word / PDF)
  const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' };
  const disp = (name) => `attachment; filename="${name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  app.post('/api/export/:format', async (req, res, next) => {
    const format = req.params.format;
    if (!MIME[format]) return res.status(400).json({ error: 'Format must be docx or pdf.' });
    const { type, data, id, keep } = req.body || {};
    if (badType(type)) return res.status(400).json({ error: 'Unknown document type.' });
    if (!guardSignatories(type, data, req, res)) return;
    const L = G.buildLayout(type, data);
    if (!L.rows.length) return res.status(400).json({ error: 'Add at least one product before exporting.' });
    try {
      const buf = format === 'docx' ? await buildDocx(type, data) : await buildPdf(type, data);
      const name = G.fileName(type, L.data, format);
      if (id && keep !== false && req.user.role !== 'viewer') { const d = await store.get(id); if (d) res.setHeader('X-Export-Id', await store.addExport({ docId: id, format, filename: name, content: buf, user: req.user.username, docRevision: d.revision })); }
      res.setHeader('Content-Type', MIME[format]); res.setHeader('Content-Disposition', disp(name)); res.setHeader('Content-Length', buf.length);
      res.end(buf);
    } catch (e) { next(e); }
  });

  app.post('/api/import/parse', editor, express.raw({ type: '*/*', limit: '60mb' }), (req, res) => {
    try {
      const type = req.query.type; if (badType(type)) return res.status(400).json({ error: 'Unknown document type.' });
      res.json(parseUpload(req.body, String(req.query.name || ''), type, req.query.sheet ? String(req.query.sheet) : ''));
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, next) => { // eslint-disable-line
    if (!err.status || err.status >= 500) console.error(err);
    res.status(err.status || 500).json({ error: err.type === 'entity.too.large' ? 'Request too large.' : 'Server error: ' + err.message });
  });

  let timer = null;
  if (cfg.autoBackup) { // daily rolling backups next to the database (local install)
    const tick = async () => { try { const lb = latestBackup(cfg.backupDir); if (!lb || Date.now() - new Date(lb.at).getTime() > 20 * 3600 * 1000) log('Backup written: ' + await writeBackup(store, cfg.backupDir)); } catch (e) { console.error('Backup failed:', e.message); } };
    setTimeout(tick, 5000); timer = setInterval(tick, 3600 * 1000); timer.unref();
  }
  return { app, db, store, auth, close: async () => { if (timer) clearInterval(timer); await db.close(); } };
}

/** Private IPv4 addresses of this PC (what other computers type into the browser). */
function lanAddresses(host) {
  if (host && host !== '0.0.0.0' && host !== '::') return [host];
  const out = [];
  Object.values(require('os').networkInterfaces()).forEach((list) => (list || []).forEach((n) => {
    if (n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')) out.push(n.address);
  }));
  return out;
}

if (require.main === module) {
  const cfg = loadConfig();
  createApp(cfg).then(({ app, close }) => {
    const server = app.listen(cfg.port, cfg.host, () => {
      console.log('\n  GMPI Document Automation ' + VERSION + ' is running (port ' + cfg.port + ', ' + (cfg.production ? 'production' : 'local') + ').');
      if (!cfg.production) console.log('  Open (this PC):  http://localhost:' + cfg.port);
      const loopback = ['127.0.0.1', 'localhost', '::1'].includes(cfg.host);
      if (cfg.production) console.log('  Network:    listening on all interfaces; the hosting platform provides the public HTTPS address.');
      else if (!loopback) {
        const lan = lanAddresses(cfg.host);
        if (lan.length) { console.log('  Other PCs on your network:'); lan.forEach((ip) => console.log('               http://' + ip + ':' + cfg.port)); }
        else console.log('  Other PCs:  no network address found - check that this PC is connected to the office network.');
      } else console.log('  Network:    this PC only (set \"host\" to \"0.0.0.0\" in config.json to allow other PCs).');
      console.log('  Database:   ' + (cfg.databaseUrl ? 'PostgreSQL' : 'SQLite  ' + path.join(cfg.dataDir, 'gmpi.db')));
      console.log('  Login:      ' + (cfg.authRequired ? 'REQUIRED' : 'off (single-PC mode)'));
      if (cfg.autoBackup) console.log('  Backups:    ' + cfg.backupDir);
      if (cfg.signatoryPin === 'gmpi-admin') console.log('\n  NOTE: change "signatoryPin" in config.json (the default PIN is in use).');
      console.log('');
    });
    // Hosting load balancers keep connections open longer than Node's default: avoids random 502 errors.
    server.keepAliveTimeout = 120000; server.headersTimeout = 125000;
    const stop = (sig) => { console.log(sig + ' received - shutting down.'); server.close(() => close().then(() => process.exit(0), () => process.exit(1))); setTimeout(() => process.exit(0), 10000).unref(); };
    process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT'));
  }).catch((e) => { console.error('\n  Could not start: ' + e.message + '\n'); process.exit(1); });
}
module.exports = { createApp, loadConfig };
