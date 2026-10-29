'use strict';
/*
 * One tiny async DB interface over two engines:
 *   - SQLite  (node:sqlite, built in)  default, single file, for the local / single-PC install
 *   - PostgreSQL (pg)           when DATABASE_URL is set — the production/online option
 * All SQL in this project is written in the portable subset both understand, using ? placeholders.
 */
const fs = require('fs');
const path = require('path');

class Mutex {
  constructor() { this.p = Promise.resolve(); }
  lock() { let rel; const next = new Promise((r) => (rel = r)); const prev = this.p; this.p = prev.then(() => next); return prev.then(() => rel); }
}

const SCHEMA = [
  // v1
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, role TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS docs (
     id TEXT PRIMARY KEY, type TEXT NOT NULL, ref_no TEXT NOT NULL, title TEXT NOT NULL, customer TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'draft', data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
     row_count INTEGER NOT NULL DEFAULT 0, search_text TEXT NOT NULL DEFAULT '',
     created_by TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS docs_updated ON docs(updated_at);
   CREATE TABLE IF NOT EXISTS revisions (
     id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, saved_by TEXT NOT NULL DEFAULT '', saved_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS revisions_doc ON revisions(doc_id, revision);
   CREATE TABLE IF NOT EXISTS exports (
     id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, format TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL,
     doc_revision INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, content {{BLOB}} NOT NULL);
   CREATE INDEX IF NOT EXISTS exports_doc ON exports(doc_id, created_at);
   CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];

async function migrate(db) {
  await db.run('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const rows = await db.query('SELECT version FROM schema_version');
  let cur = rows.length ? Number(rows[0].version) : 0;
  if (!rows.length) await db.run('INSERT INTO schema_version(version) VALUES (0)');
  for (let v = cur; v < SCHEMA.length; v++) {
    const sql = SCHEMA[v].replace(/\{\{BLOB\}\}/g, db.kind === 'postgres' ? 'BYTEA' : 'BLOB');
    for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.run(stmt);
    await db.run('UPDATE schema_version SET version = ?', [v + 1]);
  }
}

async function openSqlite(file) {
  // Node's built-in SQLite (Node >= 22.13): no native module to download or compile.
  const ow = process.emitWarning;
  process.emitWarning = (w, ...a) => (/SQLite/i.test(String(w)) ? undefined : ow.call(process, w, ...a));
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch (e) { throw new Error('This Node.js version has no built-in SQLite. Install Node.js 22.13 or newer (LTS) from https://nodejs.org .'); }
  finally { process.emitWarning = ow; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  const mx = new Mutex();
  const clean = (p) => (p || []).map((v) => (v === undefined ? null : v));
  const exec = {
    query: (sql, p) => raw.prepare(sql).all(...clean(p)),
    run: (sql, p) => ({ changes: Number(raw.prepare(sql).run(...clean(p)).changes) }),
  };
  return {
    kind: 'sqlite', file, raw,
    async query(sql, p) { const rel = await mx.lock(); try { return exec.query(sql, p); } finally { rel(); } },
    async run(sql, p) { const rel = await mx.lock(); try { return exec.run(sql, p); } finally { rel(); } },
    async tx(fn) {
      const rel = await mx.lock();
      try { raw.exec('BEGIN IMMEDIATE'); try { const r = await fn({ query: async (s, p) => exec.query(s, p), run: async (s, p) => exec.run(s, p) }); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; } }
      finally { rel(); }
    },
    async close() { raw.close(); },
  };
}

async function openPostgres(url) {
  const { Pool } = require('pg');
  // TLS is used when the URL asks for it, DATABASE_SSL=true, or the database is a Render *external* address (needed when you
  // run restore/backup from your own PC). Render's internal address (inside Render's private network) needs no TLS.
  let host = ''; try { host = new URL(url).hostname; } catch (e) {}
  const ssl = /sslmode=require/.test(url) || process.env.DATABASE_SSL === 'true' || /\.render\.com$/.test(host) ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString: url.replace(/[?&]sslmode=require/, ''), ssl, max: 8 });
  const conv = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + ++i); };
  const wrap = (c) => ({
    query: async (s, p) => (await c.query(conv(s), p || [])).rows,
    run: async (s, p) => ({ changes: (await c.query(conv(s), p || [])).rowCount }),
  });
  await pool.query('SELECT 1'); // fail fast with a clear error if the database is unreachable
  return Object.assign({ kind: 'postgres', pool }, wrap(pool), {
    async tx(fn) {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const r = await fn(wrap(c)); await c.query('COMMIT'); return r; }
      catch (e) { try { await c.query('ROLLBACK'); } catch (x) {} throw e; }
      finally { c.release(); }
    },
    async close() { await pool.end(); },
  });
}

async function openDb(cfg) {
  const db = cfg.databaseUrl ? await openPostgres(cfg.databaseUrl) : await openSqlite(path.join(cfg.dataDir, 'gmpi.db'));
  await migrate(db);
  return db;
}

module.exports = { openDb };
