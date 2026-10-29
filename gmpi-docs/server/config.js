'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function defaultDataDir() {
  // Outside the program folder on purpose: re-unzipping / upgrading the app can never delete saved records.
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'GMPI-Document-Automation');
  return path.join(os.homedir(), '.gmpi-docs');
}

function loadConfig(env = process.env) {
  const file = path.join(ROOT, 'config.json');
  const f = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const cfg = {
    port: Number(env.PORT || f.port || 3000),
    // online hosts (Render etc.) must listen on all interfaces; locally the config.json value (or loopback) is used
    host: env.HOST || (env.NODE_ENV === 'production' || env.RENDER ? '0.0.0.0' : (f.host || '127.0.0.1')),
    signatoryPin: env.SIGNATORY_PIN || f.signatoryPin || 'gmpi-admin',
    databaseUrl: env.DATABASE_URL || '',
    production: env.NODE_ENV === 'production',
    sessionHours: Number(env.SESSION_HOURS || f.sessionHours || 12),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true' || env.NODE_ENV === 'production',
    root: ROOT,
  };
  const dd = env.GMPI_DATA_DIR || f.dataDir;
  cfg.dataDir = dd ? (path.isAbsolute(dd) ? dd : path.join(ROOT, dd)) : defaultDataDir();
  cfg.legacyDir = path.join(ROOT, 'data', 'drafts'); // folder used by the first (file-based) version
  const loop = ['127.0.0.1', 'localhost', '::1'].includes(cfg.host);
  const a = String(env.AUTH_REQUIRED != null ? env.AUTH_REQUIRED : f.authRequired != null ? f.authRequired : 'auto').toLowerCase();
  cfg.authRequired = a === 'true' ? true : a === 'false' ? false : !!(cfg.databaseUrl || cfg.production || !loop);
  cfg.autoBackup = !cfg.databaseUrl && String(env.AUTO_BACKUP != null ? env.AUTO_BACKUP : f.autoBackup != null ? f.autoBackup : 'true') !== 'false';
  cfg.backupDir = env.BACKUP_DIR || path.join(cfg.dataDir, 'backups');
  return cfg;
}
module.exports = { loadConfig };
