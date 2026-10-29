'use strict';
/* Admin command line:  npm run backup | npm run restore -- <file.zip> | npm run create-user -- <name> <role> | npm run users */
const fs = require('fs');
const readline = require('readline');
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createStore } = require('./store');
const { createAuth } = require('./auth');
const { writeBackup, restoreBackup } = require('./backup');

const ask = (q, hide) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hide) { rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); }; }
  rl.question(q, (a) => { rl.close(); if (hide) process.stdout.write('\n'); res(a); });
});

(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  const cfg = loadConfig(), db = await openDb(cfg), store = createStore(db), auth = createAuth(db, { required: true });
  try {
    if (cmd === 'backup') console.log('Backup written: ' + await writeBackup(store, cfg.backupDir, 9999));
    else if (cmd === 'restore') {
      if (!a || !fs.existsSync(a)) throw new Error('Usage: npm run restore -- path\\to\\gmpi-backup-....zip');
      console.log('This REPLACES all documents, history and users in the current database with the backup contents.');
      const buf = fs.readFileSync(a); // read the backup into memory FIRST
      if ((await ask('Type RESTORE to continue: ')) !== 'RESTORE') throw new Error('Cancelled.');
      console.log('Safety copy of the current data (in case you need to undo): ' + await writeBackup(store, cfg.backupDir, 9999, 'gmpi-before-restore'));
      const m = await restoreBackup(store, buf);
      console.log(`Restored ${m.documents} document(s), ${m.revisions} revision(s), ${m.exports} generated file(s), ${m.users} user(s) from backup made ${m.createdAt}.`);
    } else if (cmd === 'create-user') {
      if (!a) throw new Error('Usage: npm run create-user -- <username> [admin|editor|viewer]');
      const pw = await ask('Password (min 10 characters): ', true), u = await auth.createUser(a, pw, b || 'editor'); console.log('Created ' + u.role + ' "' + u.username + '".');
    } else if (cmd === 'reset-password') {
      const u = (await auth.listUsers()).find((x) => x.username === String(a || '').toLowerCase()); if (!u) throw new Error('No such user.');
      await auth.updateUser(u.id, { password: await ask('New password: ', true) }); console.log('Password changed.');
    } else if (cmd === 'users') (await auth.listUsers()).forEach((u) => console.log(u.username.padEnd(24), u.role.padEnd(8), u.active ? 'active' : 'DISABLED'));
    else if (cmd === 'status') console.log(JSON.stringify({ engine: db.kind, ...(await store.counts()) }, null, 1));
    else console.log('Commands: backup | restore <zip> | create-user <name> [role] | reset-password <name> | users | status');
  } catch (e) { console.error('Error: ' + e.message); process.exitCode = 1; } finally { await db.close(); }
})();
