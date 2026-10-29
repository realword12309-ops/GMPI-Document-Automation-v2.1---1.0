-- GMPI Document Automation database schema (v1). Created automatically at start-up by server/db.js;
-- this file is for reference. SQLite and PostgreSQL both use this portable SQL (BLOB becomes BYTEA on PostgreSQL).
-- Migrations: server/db.js keeps a schema_version table and applies new steps in order, never dropping data.

CREATE TABLE IF NOT EXISTS users (
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
     doc_revision INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, content BLOB /* BYTEA on PostgreSQL */ NOT NULL);

CREATE INDEX IF NOT EXISTS exports_doc ON exports(doc_id, created_at);

CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
