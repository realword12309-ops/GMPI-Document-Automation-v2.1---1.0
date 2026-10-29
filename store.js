'use strict';
/* Document storage on top of the DB adapter (SQLite locally, PostgreSQL online).
 * - every save writes a revision snapshot (edit history; last 100 kept per document)
 * - saves use optimistic locking: a stale tab/computer can never silently overwrite newer work
 * - generated Word/PDF files are kept (last 40 per document) so they can be downloaded again exactly
 * - reference numbers are sequential per type and year (PL-2026-0001, PIN-2026-0001) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('../shared/gmpi');

const MAX_REVISIONS = 100, MAX_EXPORTS = 40;
const REF_PREFIX = { 'price-list': 'PL', 'price-increase': 'PIN' };
const newId = (p) => p + '_' + Date.now().toString(36) + crypto.randomBytes(5).toString('hex');
const validId = (id) => typeof id === 'string' && /^d_[a-z0-9]{6,40}$/.test(id);
class Conflict extends Error { constructor(cur) { super('This document was changed since you opened it (another tab or computer saved a newer version).'); this.status = 409; this.current = cur; } }

function searchText(type, title, ref, d) {
  const parts = [title, ref, G.DOC_TYPES[type].name, d.toName, d.toAddress, d.principal, d.re, d.date, d.effectivity];
  let n = 0;
  for (const p of d.products) { if (n++ > 1500) break; parts.push(Object.values(p).join(' ')); }
  return parts.join(' ').toLowerCase().slice(0, 60000);
}

function createStore(db) {
  const summary = (r) => ({
    id: r.id, type: r.type, refNo: r.ref_no, title: r.title, customer: r.customer, status: r.status, revision: Number(r.revision),
    rows: Number(r.row_count), createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_by, updatedBy: r.updated_by,
    exports: Number(r.export_count || 0),
  });
  const full = (r) => Object.assign(summary(r), { data: JSON.parse(r.data) });

  async function nextRef(tx, type, year) {
    const name = REF_PREFIX[type] + '-' + year;
    await tx.run('INSERT INTO counters(name, value) VALUES (?, 0) ON CONFLICT (name) DO NOTHING', [name]);
    await tx.run('UPDATE counters SET value = value + 1 WHERE name = ?', [name]);
    const v = Number((await tx.query('SELECT value FROM counters WHERE name = ?', [name]))[0].value);
    return name + '-' + String(v).padStart(4, '0');
  }

  const api = {
    Conflict, validId,

    async list({ q, type, status, limit, offset } = {}) {
      const w = [], p = [];
      if (type) { w.push('d.type = ?'); p.push(type); }
      if (status) { w.push('d.status = ?'); p.push(status); }
      if (q) for (const term of String(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6)) { w.push("d.search_text LIKE ? ESCAPE '\\'"); p.push('%' + term.replace(/[\\%_]/g, (m) => '\\' + m) + '%'); }
      const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
      const params = p;
      const total = Number((await db.query('SELECT COUNT(*) AS n FROM docs d ' + where, params))[0].n);
      const rows = await db.query(
        'SELECT d.id,d.type,d.ref_no,d.title,d.customer,d.status,d.revision,d.row_count,d.created_at,d.updated_at,d.created_by,d.updated_by,' +
        '(SELECT COUNT(*) FROM exports e WHERE e.doc_id = d.id) AS export_count FROM docs d ' + where + ' ORDER BY d.updated_at DESC LIMIT ? OFFSET ?',
        params.concat([Math.min(Number(limit) || 100, 500), Math.max(Number(offset) || 0, 0)]));
      return { total, items: rows.map(summary) };
    },

    async get(id) {
      if (!validId(id)) return null;
      const r = (await db.query('SELECT d.*, (SELECT COUNT(*) FROM exports e WHERE e.doc_id = d.id) AS export_count FROM docs d WHERE d.id = ?', [id]))[0];
      return r ? full(r) : null;
    },

    /** Create or update. `baseRevision` = revision the client last loaded (required to update). */
    async save({ id, type, data, baseRevision, user }) {
      const norm = G.normalize(type, data), now = new Date().toISOString(), who = user || '';
      const title = (norm.toName && norm.toName.trim()) || 'Untitled', rows = norm.products.filter((p) => !G.isBlankRow(type, p)).length;
      return db.tx(async (tx) => {
        const cur = id ? (await tx.query('SELECT id, type, revision, ref_no, created_at, created_by FROM docs WHERE id = ?', [id]))[0] : null;
        let docId, revision, ref;
        if (cur) {
          if (cur.type !== type) throw new Error('Document type cannot change after it is saved.');
          if (baseRevision != null && Number(baseRevision) !== Number(cur.revision)) throw new Conflict(Number(cur.revision));
          docId = cur.id; revision = Number(cur.revision) + 1; ref = cur.ref_no;
          await tx.run('UPDATE docs SET title=?, customer=?, status=?, data=?, revision=?, row_count=?, search_text=?, updated_by=?, updated_at=? WHERE id=?',
            [title, norm.toName, 'draft', JSON.stringify(norm), revision, rows, searchText(type, title, ref, norm), who, now, docId]);
        } else {
          if (id && !validId(id)) throw new Error('Invalid document id');
          docId = id || newId('d'); revision = 1; ref = await nextRef(tx, type, now.slice(0, 4));
          await tx.run('INSERT INTO docs(id,type,ref_no,title,customer,status,data,revision,row_count,search_text,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [docId, type, ref, title, norm.toName, 'draft', JSON.stringify(norm), 1, rows, searchText(type, title, ref, norm), who, who, now, now]);
        }
        await tx.run('INSERT INTO revisions(id,doc_id,revision,data,saved_by,saved_at) VALUES (?,?,?,?,?,?)', [newId('r'), docId, revision, JSON.stringify(norm), who, now]);
        await tx.run('DELETE FROM revisions WHERE doc_id = ? AND revision <= ?', [docId, revision - MAX_REVISIONS]);
        return { id: docId, type, refNo: ref, title, revision, updatedAt: now, rows, data: norm };
      });
    },

    async remove(id) { if (!validId(id)) return false; return db.tx(async (tx) => { const r = await tx.run('DELETE FROM docs WHERE id = ?', [id]); await tx.run('DELETE FROM revisions WHERE doc_id = ?', [id]); await tx.run('DELETE FROM exports WHERE doc_id = ?', [id]); return r.changes > 0; }); },

    async duplicate(id, user) {
      const d = await this.get(id); if (!d) return null;
      const saved = await this.save({ type: d.type, data: Object.assign({}, d.data, { importLog: [] }), user });
      await db.run('UPDATE docs SET title = ? WHERE id = ?', [saved.title + ' (copy)', saved.id]);
      return saved;
    },

    async revisions(id) { return (await db.query('SELECT revision, saved_by, saved_at FROM revisions WHERE doc_id = ? ORDER BY revision DESC', [id])).map((r) => ({ revision: Number(r.revision), savedBy: r.saved_by, savedAt: r.saved_at })); },
    async getRevision(id, rev) { const r = (await db.query('SELECT data, saved_at, saved_by FROM revisions WHERE doc_id = ? AND revision = ?', [id, Number(rev)]))[0]; return r ? { revision: Number(rev), savedAt: r.saved_at, savedBy: r.saved_by, data: JSON.parse(r.data) } : null; },

    async addExport({ docId, format, filename, content, user, docRevision }) {
      const id = newId('x'), now = new Date().toISOString();
      await db.run('INSERT INTO exports(id,doc_id,format,filename,size,doc_revision,created_by,created_at,content) VALUES (?,?,?,?,?,?,?,?,?)', [id, docId, format, filename, content.length, docRevision || 0, user || '', now, content]);
      await db.run("UPDATE docs SET status = 'exported' WHERE id = ?", [docId]);
      const old = await db.query('SELECT id FROM exports WHERE doc_id = ? ORDER BY created_at DESC', [docId]);
      for (const o of old.slice(MAX_EXPORTS)) await db.run('DELETE FROM exports WHERE id = ?', [o.id]);
      return id;
    },
    async listExports(docId) { return (await db.query('SELECT id, format, filename, size, doc_revision, created_by, created_at FROM exports WHERE doc_id = ? ORDER BY created_at DESC', [docId])).map((r) => ({ id: r.id, format: r.format, filename: r.filename, size: Number(r.size), docRevision: Number(r.doc_revision), createdBy: r.created_by, createdAt: r.created_at })); },
    async getExport(id) { const r = (await db.query('SELECT filename, format, content FROM exports WHERE id = ?', [id]))[0]; return r ? { filename: r.filename, format: r.format, content: Buffer.from(r.content) } : null; },

    async counts() { const n = async (t) => Number((await db.query('SELECT COUNT(*) AS n FROM ' + t))[0].n); return { documents: await n('docs'), revisions: await n('revisions'), exports: await n('exports'), users: await n('users') }; },

    /** Import documents from the earlier file-based store (data/drafts/*.json). Existing ids are never overwritten. */
    async importLegacyDir(dir) {
      if (!fs.existsSync(dir)) return { imported: 0, skipped: 0, failed: [] };
      const mark = 'legacy_imported:' + path.resolve(dir);
      if ((await db.query('SELECT value FROM meta WHERE key = ?', [mark]))[0]) return { imported: 0, skipped: 0, failed: [], already: true };
      let imported = 0, skipped = 0; const failed = [];
      for (const f of fs.readdirSync(dir).filter((x) => /^d_[a-z0-9]+\.json$/.test(x))) {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          if (!G.DOC_TYPES[j.type] || !validId(j.id)) throw new Error('unrecognised document');
          if ((await db.query('SELECT id FROM docs WHERE id = ?', [j.id]))[0]) { skipped++; continue; }
          const norm = G.normalize(j.type, j.data), year = String(j.createdAt || new Date().toISOString()).slice(0, 4);
          await db.tx(async (tx) => {
            const ref = await nextRef(tx, j.type, year), title = (norm.toName && norm.toName.trim()) || j.title || 'Untitled';
            const rows = norm.products.filter((p) => !G.isBlankRow(j.type, p)).length;
            await tx.run('INSERT INTO docs(id,type,ref_no,title,customer,status,data,revision,row_count,search_text,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              [j.id, j.type, ref, title, norm.toName, j.status === 'exported' ? 'exported' : 'draft', JSON.stringify(norm), 1, rows, searchText(j.type, title, ref, norm), 'migrated', 'migrated', j.createdAt || j.updatedAt, j.updatedAt || j.createdAt]);
            await tx.run('INSERT INTO revisions(id,doc_id,revision,data,saved_by,saved_at) VALUES (?,?,?,?,?,?)', [newId('r'), j.id, 1, JSON.stringify(norm), 'migrated', j.updatedAt || j.createdAt]);
          });
          imported++;
        } catch (e) { failed.push(f + ': ' + e.message); }
      }
      await db.run('INSERT INTO meta(key,value) VALUES (?,?)', [mark, new Date().toISOString()]);
      return { imported, skipped, failed };
    },

    /** Full snapshot for backups (users included as stored hashes; sessions excluded). */
    async exportAll() {
      const all = (t) => db.query('SELECT * FROM ' + t);
      const ex = await db.query('SELECT id, doc_id, format, filename, size, doc_revision, created_by, created_at FROM exports');
      return { version: 1, createdAt: new Date().toISOString(), docs: await all('docs'), revisions: await all('revisions'), exports: ex, counters: await all('counters'), users: await all('users') };
    },
    async exportContent(id) { const r = (await db.query('SELECT content FROM exports WHERE id = ?', [id]))[0]; return r ? Buffer.from(r.content) : null; },

    async importAll(bundle, files) {
      await db.tx(async (tx) => {
        // A backup made on a PC with no logins has no users: keep the online accounts instead of locking everyone out.
        const keepUsers = !bundle.users || !bundle.users.length;
        for (const t of ['exports', 'revisions', 'docs', 'counters'].concat(keepUsers ? [] : ['sessions', 'users'])) await tx.run('DELETE FROM ' + t);
        const ins = async (t, rows, cols) => { for (const r of rows) await tx.run('INSERT INTO ' + t + '(' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')', cols.map((c) => r[c])); };
        if (!keepUsers) await ins('users', bundle.users, ['id', 'username', 'pass_hash', 'role', 'active', 'created_at']);
        await ins('docs', bundle.docs, ['id', 'type', 'ref_no', 'title', 'customer', 'status', 'data', 'revision', 'row_count', 'search_text', 'created_by', 'updated_by', 'created_at', 'updated_at']);
        await ins('revisions', bundle.revisions, ['id', 'doc_id', 'revision', 'data', 'saved_by', 'saved_at']);
        await ins('counters', bundle.counters, ['name', 'value']);
        for (const e of bundle.exports) {
          const content = files[e.id]; if (!content) continue;
          await tx.run('INSERT INTO exports(id,doc_id,format,filename,size,doc_revision,created_by,created_at,content) VALUES (?,?,?,?,?,?,?,?,?)', [e.id, e.doc_id, e.format, e.filename, e.size, e.doc_revision, e.created_by, e.created_at, content]);
        }
      });
    },

    /** NON-DESTRUCTIVE import of a backup (used to move records from the PC version online): adds documents, their history and
     *  generated files that are not already present (matched by id); never deletes or overwrites anything; ignores users. */
    async mergeAll(bundle, files) {
      const need = (a) => { if (!Array.isArray(a)) throw new Error('The backup file is damaged (missing section).'); return a; };
      const docs = need(bundle.docs), revs = need(bundle.revisions), exps = need(bundle.exports), ctr = need(bundle.counters);
      const r = { documentsAdded: 0, documentsAlreadyPresent: 0, revisionsAdded: 0, exportsAdded: 0, renumbered: 0 };
      await db.tx(async (tx) => {
        const added = new Set();
        // reference-number counters only ever move forward, so new documents never reuse an imported number
        for (const c of ctr) await tx.run('INSERT INTO counters(name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = CASE WHEN excluded.value > counters.value THEN excluded.value ELSE counters.value END', [c.name, Number(c.value)]);
        const dcols = ['id', 'type', 'ref_no', 'title', 'customer', 'status', 'data', 'revision', 'row_count', 'search_text', 'created_by', 'updated_by', 'created_at', 'updated_at'];
        for (const d of docs) {
          if (!validId(d.id) || !G.DOC_TYPES[d.type]) throw new Error('The backup contains a document this version does not recognise (' + d.id + ').');
          JSON.parse(d.data); // must be valid JSON
          if ((await tx.query('SELECT id FROM docs WHERE id = ?', [d.id]))[0]) { r.documentsAlreadyPresent++; continue; }
          let row = d;
          if ((await tx.query('SELECT id FROM docs WHERE ref_no = ?', [d.ref_no]))[0]) { // same number already used by a different document here: give the imported one a fresh number
            row = Object.assign({}, d, { ref_no: await nextRef(tx, d.type, String(d.created_at || new Date().toISOString()).slice(0, 4)) }); r.renumbered++;
          }
          const x = await tx.run('INSERT INTO docs(' + dcols.join(',') + ') VALUES (' + dcols.map(() => '?').join(',') + ') ON CONFLICT (id) DO NOTHING', dcols.map((c) => row[c]));
          if (x.changes > 0) { added.add(d.id); r.documentsAdded++; } else r.documentsAlreadyPresent++;
        }
        const rcols = ['id', 'doc_id', 'revision', 'data', 'saved_by', 'saved_at'];
        for (const v of revs) if (added.has(v.doc_id)) r.revisionsAdded += (await tx.run('INSERT INTO revisions(' + rcols.join(',') + ') VALUES (?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING', rcols.map((c) => v[c]))).changes;
        for (const e of exps) {
          const content = files[e.id]; if (!content || !added.has(e.doc_id)) continue;
          r.exportsAdded += (await tx.run('INSERT INTO exports(id,doc_id,format,filename,size,doc_revision,created_by,created_at,content) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING', [e.id, e.doc_id, e.format, e.filename, e.size, e.doc_revision, e.created_by, e.created_at, content])).changes;
        }
      });
      return r;
    },
  };
  return api;
}
module.exports = { createStore, Conflict };
