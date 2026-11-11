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
  await reconcileSchema(db);
}

// A database created outside this app (or by an older version) can have wrong column types or be missing
// columns entirely; CREATE TABLE IF NOT EXISTS cannot fix that. Align every table with SCHEMA above:
// add missing columns (backfilled), convert wrong types, keep all values. Never drops columns or rows.
// [column, type, backfill, keepDefault] — backfill is used only when adding; keepDefault = default in SCHEMA.
const COLUMNS = {
  users: [['id', 'TEXT', "''"], ['username', 'TEXT', "''"], ['pass_hash', 'TEXT', "''"], ['role', 'TEXT', "'admin'"], ['active', 'INTEGER', '1', true], ['created_at', 'TEXT', "''"]],
  sessions: [['token_hash', 'TEXT', "''"], ['user_id', 'TEXT', "''"], ['expires_at', 'TEXT', "''"], ['created_at', 'TEXT', "''"]],
  docs: [['id', 'TEXT', "''"], ['type', 'TEXT', "''"], ['ref_no', 'TEXT', "''"], ['title', 'TEXT', "''"], ['customer', 'TEXT', "''", true], ['status', 'TEXT', "'draft'", true], ['data', 'TEXT', "''"], ['revision', 'INTEGER', '1', true], ['row_count', 'INTEGER', '0', true], ['search_text', 'TEXT', "''", true], ['created_by', 'TEXT', "''", true], ['updated_by', 'TEXT', "''", true], ['created_at', 'TEXT', "''"], ['updated_at', 'TEXT', "''"]],
  revisions: [['id', 'TEXT', "''"], ['doc_id', 'TEXT', "''"], ['revision', 'INTEGER', '0'], ['data', 'TEXT', "''"], ['saved_by', 'TEXT', "''", true], ['saved_at', 'TEXT', "''"]],
  exports: [['id', 'TEXT', "''"], ['doc_id', 'TEXT', "''"], ['format', 'TEXT', "''"], ['filename', 'TEXT', "''"], ['size', 'INTEGER', '0'], ['doc_revision', 'INTEGER', '0', true], ['created_by', 'TEXT', "''", true], ['created_at', 'TEXT', "''"], ['content', 'BYTEA', "''"]],
  counters: [['name', 'TEXT', "''"], ['value', 'INTEGER', '0']],
  meta: [['key', 'TEXT', "''"], ['value', 'TEXT', "''"]],
};
const TYPE_OK = { TEXT: ['text', 'character varying', 'character'], INTEGER: ['integer', 'bigint', 'smallint'], BYTEA: ['bytea'] };
function typeCast(c, from, to) {
  if (to === 'TEXT') return `${c}::text`;
  if (to === 'BYTEA') return `convert_to(${c}::text, 'UTF8')`;
  if (from === 'boolean') return `CASE WHEN ${c} THEN 1 ELSE 0 END`;
  if (TYPE_OK.TEXT.includes(from)) return `CASE WHEN ${c}::text ~ '^(-|)[0-9]+$' THEN (${c}::text)::integer ELSE 0 END`;
  return `${c}::integer`;
}
function zeroDefault(ty) {
  if (TYPE_OK.INTEGER.includes(ty) || ['numeric', 'real', 'double precision'].includes(ty)) return '0';
  if (ty === 'boolean') return 'false';
  if (ty === 'bytea') return "''";
  if (ty === 'json' || ty === 'jsonb') return "'{}'";
  if (ty === 'uuid') return 'gen_random_uuid()';
  if (/timestamp/.test(ty)) return 'CURRENT_TIMESTAMP';
  if (ty === 'date') return 'CURRENT_DATE';
  return "''";
}
async function reconcileSchema(db) {
  if (db.kind !== 'postgres') return;
  let changed = false;
  for (const [t, cols] of Object.entries(COLUMNS)) {
    const have = {};
    for (const r of await db.query("SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?", [t])) have[r.column_name] = r;
    for (const [c, type, backfill, keepDefault] of cols) {
      const cur = have[c];
      if (!cur) {
        await db.run(`ALTER TABLE ${t} ADD COLUMN ${c} ${type} NOT NULL DEFAULT ${backfill}`);
        if (!keepDefault) await db.run(`ALTER TABLE ${t} ALTER COLUMN ${c} DROP DEFAULT`);
        console.log(`Database repair: ${t}.${c} was missing; added ${type}, existing rows backfilled with ${backfill}.`);
        changed = true;
      } else if (!TYPE_OK[type].includes(cur.data_type)) {
        if (cur.column_default != null) await db.run(`ALTER TABLE ${t} ALTER COLUMN ${c} DROP DEFAULT`);
        await db.run(`ALTER TABLE ${t} ALTER COLUMN ${c} TYPE ${type} USING ${typeCast(c, cur.data_type, type)}`);
        if (keepDefault) await db.run(`ALTER TABLE ${t} ALTER COLUMN ${c} SET DEFAULT ${backfill}`);
        console.log(`Database repair: ${t}.${c} was ${cur.data_type}; converted to ${type} (all values kept).`);
        changed = true;
      } else if (keepDefault && cur.column_default == null) await db.run(`ALTER TABLE ${t} ALTER COLUMN ${c} SET DEFAULT ${backfill}`);
      else if (!keepDefault && /nextval/i.test(cur.column_default || '')) await db.run(`ALTER TABLE ${t} ALTER COLUMN ${c} DROP DEFAULT`);
    }
    // Foreign NOT NULL columns the app never writes (e.g. a legacy password_hash) would break every
    // INSERT that omits them; give them a zero default so inserts succeed, keeping existing values.
    for (const r of await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? AND is_nullable = 'NO' AND column_default IS NULL", [t])) {
      if (cols.some(([c]) => c === r.column_name)) continue;
      await db.run(`ALTER TABLE ${t} ALTER COLUMN ${r.column_name} SET DEFAULT ${zeroDefault(r.data_type)}`);
      console.log(`Database repair: ${t}.${r.column_name} is a foreign NOT NULL column; set a default so app inserts succeed (values kept).`);
      changed = true;
    }
  }
  if (changed) await db.run('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)');
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
