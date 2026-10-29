'use strict';
/* Accounts, sessions and roles.
 *  roles: admin (everything, users, backups) · editor (create/edit/export) · viewer (read, download, print only)
 *  Passwords: scrypt with a per-user salt. Sessions: random 256-bit token in an HttpOnly cookie; only its SHA-256 is stored. */
const crypto = require('crypto');

const ROLES = ['admin', 'editor', 'viewer'];
const COOKIE = 'gmpi_sid';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newId = () => 'u_' + crypto.randomBytes(8).toString('hex');

function scrypt(pw, salt, N, r, p) {
  return new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 }, (e, k) => (e ? rej(e) : res(k))));
}
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16), N = 16384, r = 8, p = 1;
  return ['scrypt', N, r, p, salt.toString('base64'), (await scrypt(pw, salt, N, r, p)).toString('base64')].join('$');
}
async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const k = await scrypt(pw, Buffer.from(salt, 'base64'), +N, +r, +p), h = Buffer.from(hash, 'base64');
  return k.length === h.length && crypto.timingSafeEqual(k, h);
}
const validUsername = (u) => /^[a-z0-9._-]{3,40}$/.test(u);
function checkPassword(pw) { if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.'; if (pw.length > 200) return 'Password is too long.'; return null; }

function createAuth(db, opts) {
  const required = !!opts.required, hours = opts.sessionHours || 12;
  const tries = new Map(); // ip|user -> {n, until}

  const api = {
    required, ROLES,
    async count() { return Number((await db.query('SELECT COUNT(*) AS n FROM users'))[0].n); },

    async createUser(username, password, role) {
      username = String(username || '').trim().toLowerCase();
      if (!validUsername(username)) throw new Error('Username: 3–40 characters, letters, numbers, dot, dash or underscore.');
      if (!ROLES.includes(role)) throw new Error('Role must be admin, editor or viewer.');
      const bad = checkPassword(password); if (bad) throw new Error(bad);
      if ((await db.query('SELECT id FROM users WHERE username = ?', [username]))[0]) throw new Error('That username already exists.');
      const id = newId();
      await db.run('INSERT INTO users(id,username,pass_hash,role,active,created_at) VALUES (?,?,?,?,1,?)', [id, username, await hashPassword(password), role, new Date().toISOString()]);
      return { id, username, role };
    },
    async listUsers() { return (await db.query('SELECT id, username, role, active, created_at FROM users ORDER BY username')).map((u) => ({ id: u.id, username: u.username, role: u.role, active: !!Number(u.active), createdAt: u.created_at })); },
    async updateUser(id, { password, role, active }) {
      const u = (await db.query('SELECT * FROM users WHERE id = ?', [id]))[0]; if (!u) throw new Error('User not found.');
      const admins = Number((await db.query("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1"))[0].n);
      if (u.role === 'admin' && Number(u.active) && admins <= 1 && ((role && role !== 'admin') || active === false)) throw new Error('You cannot remove the last active administrator.');
      if (password != null) { const bad = checkPassword(password); if (bad) throw new Error(bad); await db.run('UPDATE users SET pass_hash = ? WHERE id = ?', [await hashPassword(password), id]); }
      if (role) { if (!ROLES.includes(role)) throw new Error('Invalid role.'); await db.run('UPDATE users SET role = ? WHERE id = ?', [role, id]); }
      if (active != null) { await db.run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, id]); if (!active) await db.run('DELETE FROM sessions WHERE user_id = ?', [id]); }
    },

    async login(username, password, ip) {
      const key = ip + '|' + String(username).toLowerCase(), t = tries.get(key);
      if (t && t.until > Date.now()) { const e = new Error('Too many failed attempts. Try again in a few minutes.'); e.status = 429; throw e; }
      const u = (await db.query('SELECT * FROM users WHERE username = ?', [String(username || '').trim().toLowerCase()]))[0];
      const ok = u && Number(u.active) && (await verifyPassword(String(password || ''), u.pass_hash));
      if (!ok) { const n = ((t && t.n) || 0) + 1; tries.set(key, { n, until: n >= 5 ? Date.now() + 10 * 60000 : 0 }); const e = new Error('Incorrect username or password.'); e.status = 401; throw e; }
      tries.delete(key);
      const token = crypto.randomBytes(32).toString('hex'), exp = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      await db.run('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)', [sha(token), u.id, exp, new Date().toISOString()]);
      await db.run('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
      return { token, maxAge: hours * 3600, user: { id: u.id, username: u.username, role: u.role } };
    },
    async logout(token) { if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha(token)]); },
    async userForToken(token) {
      if (!token) return null;
      const r = (await db.query('SELECT u.id, u.username, u.role, u.active, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', [sha(token)]))[0];
      if (!r || !Number(r.active) || r.expires_at < new Date().toISOString()) return null;
      return { id: r.id, username: r.username, role: r.role };
    },

    cookieToken(req) { const m = /(?:^|;\s*)gmpi_sid=([a-f0-9]{64})/.exec(req.headers.cookie || ''); return m ? m[1] : ''; },
    setCookie(res, req, token, maxAge) {
      const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
    },

    /** Express middleware: sets req.user (or 401). With auth switched off every request is the local administrator. */
    middleware(publicPaths) {
      return async (req, res, next) => {
        if (!required) { req.user = { id: 'local', username: 'local', role: 'admin' }; return next(); }
        if (publicPaths.some((p) => req.path === p)) return next();
        try { const u = await api.userForToken(api.cookieToken(req)); if (!u) return res.status(401).json({ error: 'login_required', message: 'Please log in.' }); req.user = u; next(); }
        catch (e) { next(e); }
      };
    },
    need(...roles) { return (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'forbidden', message: 'Your account (' + req.user.role + ') is not allowed to do that.' })); },

    /** First-run administrator. Never uses a built-in/default password. */
    async bootstrap(env, log) {
      const u = env.ADMIN_USERNAME, p = env.ADMIN_PASSWORD;
      /* Emergency recovery for an online site where nobody can log in (no shell needed): the person who controls the hosting
       * dashboard sets ADMIN_RESET=true + ADMIN_USERNAME + ADMIN_PASSWORD, restarts once, signs in, then REMOVES all three. */
      if (String(env.ADMIN_RESET || '').toLowerCase() === 'true') {
        if (!u || !p) throw new Error('ADMIN_RESET=true needs ADMIN_USERNAME and ADMIN_PASSWORD (min 10 characters).');
        const name = String(u).trim().toLowerCase(), bad = checkPassword(p); if (bad) throw new Error('ADMIN_PASSWORD: ' + bad);
        const ex = (await db.query('SELECT id FROM users WHERE username = ?', [name]))[0];
        if (ex) {
          await db.run('UPDATE users SET pass_hash = ?, role = ?, active = 1 WHERE id = ?', [await hashPassword(p), 'admin', ex.id]);
          await db.run('DELETE FROM sessions WHERE user_id = ?', [ex.id]);
          log('ADMIN_RESET: password of "' + name + '" was reset and the account is an active administrator. REMOVE ADMIN_RESET, ADMIN_USERNAME and ADMIN_PASSWORD from the environment now.');
        } else { await api.createUser(u, p, 'admin'); log('ADMIN_RESET: administrator "' + name + '" created. REMOVE ADMIN_RESET, ADMIN_USERNAME and ADMIN_PASSWORD from the environment now.'); }
        return null;
      }
      if (await api.count()) return null;
      if (u && p) { await api.createUser(u, p, 'admin'); log('Created administrator "' + u.toLowerCase() + '" from ADMIN_USERNAME / ADMIN_PASSWORD.'); return null; }
      if (!required) return null; // local single-PC mode without login: no account needed
      if (env.NODE_ENV === 'production') throw new Error('No users exist. Set ADMIN_USERNAME and ADMIN_PASSWORD (min 10 chars) for the first start, then remove them.');
      const pw = crypto.randomBytes(12).toString('base64url'); await api.createUser('admin', pw, 'admin');
      log('\n  First-run administrator created ->  username: admin   password: ' + pw + '\n  (shown once; change it after logging in)\n');
      return pw;
    },
  };
  return api;
}
module.exports = { createAuth, hashPassword, verifyPassword, ROLES };
