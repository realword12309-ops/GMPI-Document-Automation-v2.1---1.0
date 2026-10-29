/* GMPI Document Automation — browser app (no external services; talks only to this server). */
(function () {
  'use strict';
  const G = window.GMPI;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fmtDate = (d) => MONTHS[d.getMonth()] + ' ' + String(d.getDate()).padStart(2, '0') + ', ' + d.getFullYear();

  const S = { cfg: null, id: null, type: null, data: null, dirty: false, savedAt: null, token: sessionStorage.getItem('gmpiToken') || '', mode: 'edit', pvMode: 'live', revision: 0, refNo: '', user: null, gridPage: 0 };
  const GRID_PAGE = 200, PREVIEW_ROWS = 400;
  const canEdit = () => !!S.user && S.user.role !== 'viewer';
  const isAdmin = () => !!S.user && S.user.role === 'admin';

  // ------------------------------------------------------------ helpers
  let toastT;
  function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => (t.className = ''), err ? 6000 : 2600); }
  async function api(path, opts) {
    opts = opts || {}; opts.headers = Object.assign({ 'X-Unlock-Token': S.token }, opts.headers || {});
    if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers['Content-Type'] = 'application/json'; opts.method = opts.method || 'POST'; }
    let r; try { r = await fetch(path, opts); } catch (e) { throw new Error('Cannot reach the GMPI server. Is it still running? Nothing was saved.'); }
    if (!r.ok) {
      let m = r.statusText, j = null; try { j = await r.json(); m = j.message || j.error || m; } catch (e) {}
      if (r.status === 401 && j && j.error === 'login_required' && !opts.noLoginRedirect) { S.user = null; showLogin('Your session has ended. Please sign in again.'); }
      const er = new Error(m); er.status = r.status; er.body = j; throw er;
    }
    return r;
  }
  const typeDef = () => G.DOC_TYPES[S.type];
  const noun = () => (S.type === 'price-increase' ? 'Notice' : 'Price List');
  function modal(html, cls) {
    const root = $('#modalRoot'); root.innerHTML = '<div class="overlay"><div class="modal ' + (cls || '') + '">' + html + '</div></div>';
    return { el: root.firstChild.firstChild, close: () => (root.innerHTML = '') };
  }
  function confirmBox(msg, yes, no) {
    return new Promise((res) => {
      const m = modal('<h2>Please confirm</h2><p>' + esc(msg) + '</p><div class="foot"><button class="btn" id="cNo">' + esc(no || 'Cancel') + '</button><button class="btn primary" id="cYes">' + esc(yes || 'OK') + '</button></div>', 'sm');
      $('#cNo', m.el).onclick = () => { m.close(); res(false); }; $('#cYes', m.el).onclick = () => { m.close(); res(true); };
    });
  }
  function setDirty(v) {
    S.dirty = v; const p = $('#saveState');
    if (!S.id && !S.savedAt) { p.className = 'pill dirty'; p.textContent = 'Not saved yet'; }
    else if (v) { p.className = 'pill dirty'; p.textContent = 'Unsaved changes'; }
    else { p.className = 'pill ok'; p.textContent = 'Saved to server ' + new Date(S.savedAt).toLocaleTimeString(); }
  }
  window.addEventListener('beforeunload', (e) => { if (S.dirty && !$('#viewEditor').hidden) { e.preventDefault(); e.returnValue = ''; } });

  // ------------------------------------------------------------ views
  function show(view) {
    ['Login', 'Home', 'History', 'Editor'].forEach((v) => ($('#view' + v).hidden = v.toLowerCase() !== view));
    $$('.nav-btn').forEach((b) => b.classList.toggle('on', b.dataset.nav === view));
    if (view === 'history') loadHistory();
  }
  async function guardLeave() { return !S.dirty || $('#viewEditor').hidden || (await confirmBox('You have unsaved changes. Leave without saving?', 'Leave', 'Stay')); }
  $$('.nav-btn').forEach((b) => (b.onclick = async () => { if (await guardLeave()) { S.dirty = false; show(b.dataset.nav); } }));

  function renderHome() {
    $('#typeCards').innerHTML = S.cfg.types.map((t) => '<button class="card" data-t="' + t.id + '"><h2>' + esc(t.name) + '</h2><div class="muted">' +
      (t.id === 'price-list' ? 'Follows the SANTE BARLEY Official Price List template: heading, recipient, products with Item No., item description, packaging, generic name, SRP, discount, trade price and barcode, and signatories.'
        : 'Notice of product price changes: opening notice with protection-order offer, UPDATED PRICING DETAILS table (item description, packaging, UOM, UoM group, old/new price w/VAT, % increase, GMPI effectivity), closing message and Prepared / Approved / Acknowledged signatures, using the GMPI letterhead.') +
      '</div>' + (t.provisional ? '<span class="tag">Layout provisional — template not received</span>' : '') + '</button>').join('');
    $$('#typeCards .card').forEach((c) => (c.onclick = () => openNew(c.dataset.t)));
    renderUserBox();
  }
  function renderUserBox() {
    const st = S.cfg.storage, u = S.user;
    $('#storageNote').innerHTML = st ? 'Saved to <b>' + (st.engine === 'postgres' ? 'online PostgreSQL database' : 'database on this computer') + '</b>' : '';
    $('#userBox').innerHTML = u ? '<span class="who">' + esc(u.username) + '</span> <span class="badge">' + esc(u.role) + '</span>' +
      (isAdmin() && S.cfg.auth.required ? ' <button class="btn small" id="btnUsers">Users</button>' : '') + (isAdmin() ? ' <button class="btn small" id="btnBackup">Backup</button>' : '') +
      (S.cfg.auth.required ? ' <button class="btn small" id="btnLogout">Sign out</button>' : '') : '';
    const lo = $('#btnLogout'); if (lo) lo.onclick = async () => { if (!(await guardLeave())) return; S.dirty = false; try { await api('/api/auth/logout', { method: 'POST', noLoginRedirect: true }); } catch (e) {} S.user = null; showLogin(); };
    const ub = $('#btnUsers'); if (ub) ub.onclick = openUsers; const bb = $('#btnBackup'); if (bb) bb.onclick = openBackup;
  }
  function showLogin(msg) {
    renderUserBox(); $('#loginErr').textContent = msg || ''; $('#loginPass').value = ''; show('login'); $$('.nav-btn').forEach((b) => (b.hidden = true));
    setTimeout(() => $('#loginUser').focus(), 50);
  }
  async function doLogin() {
    $('#loginErr').textContent = '';
    try {
      await api('/api/auth/login', { json: { username: $('#loginUser').value, password: $('#loginPass').value }, noLoginRedirect: true });
      await loadApp();
    } catch (e) { $('#loginErr').textContent = e.message; }
  }
  $('#loginBtn').onclick = doLogin; $('#loginPass').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); }; $('#loginUser').onkeydown = (e) => { if (e.key === 'Enter') $('#loginPass').focus(); };

  function openUsers() {
    const m = modal('<h2>Users</h2><div id="usrList" class="muted">Loading…</div><h3 style="margin:14px 0 6px">Add user</h3><div class="row2"><label class="f">Username<input id="nuName"></label><label class="f">Role<select id="nuRole"><option value="editor">editor — create, edit, export</option><option value="viewer">viewer — read, download, print</option><option value="admin">admin — everything + users + backups</option></select></label></div><label class="f">Password (min 10 characters)<input id="nuPw" type="password" autocomplete="new-password"></label><div id="usrErr" class="loginerr"></div><div class="foot"><button class="btn" id="usrClose">Close</button><button class="btn primary" id="nuAdd">Add user</button></div>');
    const load = async () => {
      const list = await (await api('/api/users')).json();
      $('#usrList', m.el).innerHTML = '<table class="hist"><thead><tr><th>User</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>' + list.map((u) => '<tr><td>' + esc(u.username) + '</td><td>' + esc(u.role) + '</td><td>' + (u.active ? 'active' : 'DISABLED') + '</td><td style="white-space:nowrap"><button class="btn small" data-pw="' + u.id + '">Reset password</button> <button class="btn small" data-act="' + u.id + '" data-to="' + (u.active ? 0 : 1) + '">' + (u.active ? 'Disable' : 'Enable') + '</button></td></tr>').join('') + '</tbody></table>';
      $$('[data-pw]', m.el).forEach((b) => (b.onclick = async () => { const pw = prompt('New password (min 10 characters):'); if (!pw) return; try { await api('/api/users/' + b.dataset.pw, { method: 'PATCH', json: { password: pw } }); toast('Password changed.'); } catch (e) { toast(e.message, true); } }));
      $$('[data-act]', m.el).forEach((b) => (b.onclick = async () => { try { await api('/api/users/' + b.dataset.act, { method: 'PATCH', json: { active: b.dataset.to === '1' } }); load(); } catch (e) { toast(e.message, true); } }));
    };
    load().catch((e) => ($('#usrList', m.el).textContent = e.message));
    $('#usrClose', m.el).onclick = m.close;
    $('#nuAdd', m.el).onclick = async () => { try { await api('/api/users', { json: { username: $('#nuName', m.el).value, password: $('#nuPw', m.el).value, role: $('#nuRole', m.el).value } }); $('#nuName', m.el).value = ''; $('#nuPw', m.el).value = ''; $('#usrErr', m.el).textContent = ''; load(); } catch (e) { $('#usrErr', m.el).textContent = e.message; } };
  }
  async function openBackup() {
    const m = modal('<h2>Backups</h2><div id="bkInfo" class="muted">Loading…</div><div class="foot"><button class="btn" id="bkClose">Close</button><button class="btn primary" id="bkDl">Download full backup (.zip)</button></div>');
    $('#bkClose', m.el).onclick = m.close;
    try {
      const st = await (await api('/api/admin/status')).json();
      $('#bkInfo', m.el).innerHTML = '<p>Database: <b>' + esc(st.engine) + '</b> — ' + st.counts.documents + ' documents, ' + st.counts.revisions + ' saved versions, ' + st.counts.exports + ' generated files, ' + st.counts.users + ' users.</p>' +
        (st.backupDir ? '<p>Automatic daily backups are written to:<br><b>' + esc(st.backupDir) + '</b><br>Last backup: ' + (st.lastBackup ? esc(new Date(st.lastBackup.at).toLocaleString()) : 'none yet') + '</p>' : '<p>This server uses an online database. Enable your hosting provider\'s automatic database backups and download a copy here regularly.</p>') +
        '<p class="muted" style="font-size:12px">The backup contains confidential customer and price data and password hashes. Store it somewhere private.</p>' +
        '<h3 style="margin:14px 0 4px">Add records from a backup file</h3><p class="muted" style="font-size:12px;margin:0 0 6px">Use this to move records made on the PC version into this online database. It only <b>adds</b> documents that are not here yet; nothing is deleted or overwritten, and user accounts are never imported.</p>' +
        '<input type="file" id="bkFile" accept=".zip,application/zip"> <button class="btn" id="bkImp">Add records</button><div id="bkImpOut" style="margin-top:8px;font-size:13px"></div>';
      $('#bkImp', m.el).onclick = async () => {
        const f = $('#bkFile', m.el).files[0], out = $('#bkImpOut', m.el); if (!f) { out.textContent = 'Choose a backup .zip file first.'; return; }
        if (!confirm('Add the records from "' + f.name + '" to this online database?\n\nExisting records are kept exactly as they are; nothing is deleted.')) return;
        out.textContent = 'Uploading and importing…';
        try { const r = await (await api('/api/admin/import-backup', { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream' } })).json();
          out.innerHTML = '<b>Done.</b> ' + r.documentsAdded + ' document(s) added (' + r.revisionsAdded + ' saved versions, ' + r.exportsAdded + ' generated files); ' + r.documentsAlreadyPresent + ' were already here and left untouched.' + (r.renumbered ? ' ' + r.renumbered + ' imported document(s) had a reference number that was already used here and received a new one.' : ''); }
        catch (e) { out.textContent = 'Import failed: ' + e.message + ' Nothing was changed.'; }
      };
    } catch (e) { $('#bkInfo', m.el).textContent = e.message; }
    $('#bkDl', m.el).onclick = async () => { try { const r = await api('/api/admin/backup'); const b = await r.blob(), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'gmpi-backup-' + new Date().toISOString().slice(0, 10) + '.zip'; document.body.appendChild(a); a.click(); a.remove(); toast('Backup downloaded (' + Math.round(b.size / 1024) + ' KB)'); } catch (e) { toast(e.message, true); } };
  }

  // ------------------------------------------------------------ editor lifecycle
  function openNew(type) {
    S.type = type; S.id = null; S.savedAt = null; S.revision = 0; S.refNo = ''; S.gridPage = 0;
    S.data = G.newDocData(type, fmtDate(new Date()));
    openEditor();
    setDirty(false); setDirty(true);
  }
  async function openDoc(id) {
    try {
      const d = await (await api('/api/docs/' + id)).json();
      S.type = d.type; S.id = d.id; S.savedAt = d.updatedAt; S.revision = d.revision; S.refNo = d.refNo; S.gridPage = 0; S.data = G.normalize(d.type, d.data);
      openEditor(); setDirty(false);
    } catch (e) { toast(e.message, true); }
  }
  function openEditor() {
    show('editor'); setMode('edit'); $('#printRoot').innerHTML = ''; // never keep a previous document's print copy
    $('#edTypeName').textContent = typeDef().name;
    $('#edRef').textContent = S.refNo ? 'Ref ' + S.refNo : 'Ref assigned on first save'; $('#edRef').className = 'pill';
    ['#btnSave', '#btnImport', '#btnNew'].forEach((id) => ($(id).hidden = !canEdit())); $('#btnVersions').hidden = !S.id;
    $('#btnPreview').textContent = 'Preview ' + noun(); $('#btnPrint').textContent = 'Print ' + noun();
    renderForm(); refreshPreview();
  }
  function markDirty() { setDirty(true); schedulePreview(); }

  // ------------------------------------------------------------ form
  const lockMap = () => (S.cfg.lockedDefaults[S.type] || []);
  const unlocked = () => !!S.token;

  function renderForm() {
    const d = S.data, t = typeDef(), pane = $('#formPane');
    const field = (label, key, opts) => {
      opts = opts || {};
      const tag = opts.area ? '<textarea rows="' + (opts.rows || 3) + '" data-k="' + key + '">' + esc(d[key]) + '</textarea>' : '<input type="text" data-k="' + key + '" value="' + esc(d[key]) + '">';
      const date = opts.date ? '<input type="date" data-date="' + key + '" title="Pick a date">' : '';
      return '<label class="f">' + esc(label) + '<span class="inline">' + tag + date + '</span>' + (opts.help ? '<span class="help">' + opts.help + '</span>' : '') + '</label>';
    };
    const plist = (key, title, help) => '<div><div style="font-weight:700;font-size:12px;margin-bottom:4px">' + title + '</div>' + (help ? '<div class="help muted" style="font-size:11.5px;margin-bottom:5px">' + help + '</div>' : '') +
      '<div class="plist" data-pl="' + key + '"></div><button class="btn small" data-add="' + key + '" style="margin-top:6px">+ Add paragraph</button> <button class="btn small" data-reset="' + key + '">Reset to template wording</button></div>';
    pane.innerHTML =
      (t.provisional ? '<div class="notice-banner"><b>Provisional layout.</b> The Price Increase Notice template was not received, so this notice reuses the GMPI letterhead and the price-list table style. Its default wording and table columns are placeholders — edit any of them here, and send the template to make the defaults exact. Approver names are intentionally blank (not invented).</div>' : '') +
      '<details class="sec" open><summary>1 · Recipient &amp; document details</summary><div class="in">' +
      field('Date', 'date', { date: true, help: 'Free text — the calendar button fills “Month DD, YYYY”.' }) +
      field('Customer name (TO)', 'toName') + field('Recipient address / details (one line per row)', 'toAddress', { area: true, rows: 3 }) +
      '<div class="row2">' + field('From (company)', 'from') + field(S.type === 'price-increase' ? 'Subject (RE:)' : 'Subject (RE:)', 're') + '</div>' +
      '<div class="row2">' + field('Effectivity date', 'effectivity', { date: true, help: 'Inserted wherever the text contains {effectivity}.' }) + field('Salutation', 'salutation') + '</div>' +
      (S.type === 'price-increase' ? field('Principal (filled from the workbook when it is empty)', 'principal', { help: 'Use {principal} in any paragraph to print it.' }) : '') +
      '</div></details>' +
      '<details class="sec" open><summary>2 · Letter text</summary><div class="in">' +
      '<div class="help muted" style="font-size:12px">Placeholders: <code>{customer}</code> <code>{effectivity}</code> <code>{date}</code>' + (S.type === 'price-increase' ? ' <code>{principal}</code>' : '') + ' are filled in automatically. Empty paragraphs are skipped.</div>' +
      plist('intro', 'Introductory paragraphs') +
      field('Highlighted notice line (above the table; leave empty to omit)', 'noticeLine') +
      plist('additional', 'Additional notice information (below the table, optional)') +
      plist('closing', 'Closing paragraphs') + '</div></details>' +
      '<details class="sec" open><summary>3 · Products</summary><div class="in"><div id="gridHost"></div></div></details>' +
      '<details class="sec" open><summary>4 · Prepared / Approved / Acknowledged by</summary><div class="in">' +
      '<div class="inline"><span id="lockMsg" class="muted" style="font-size:12px"></span><button class="btn small" id="btnUnlock"></button></div><div class="sigs" id="sigHost"></div></div></details>' +
      '<details class="sec"><summary>5 · Start over / template data</summary><div class="in"><div class="tools">' +
      (S.type === 'price-list' ? '<button class="btn small" id="btnSample">Fill with the sample from SANTE BARLEY.docx</button>' : '') +
      '<button class="btn small" id="btnResetWidths">Reset column widths &amp; headings</button></div></div></details>';

    $$('[data-k]', pane).forEach((el) => (el.oninput = () => { d[el.dataset.k] = el.value; markDirty(); }));
    $$('[data-date]', pane).forEach((el) => (el.onchange = () => { if (!el.value) return; const [y, m, dd] = el.value.split('-').map(Number); const k = el.dataset.date; d[k] = fmtDate(new Date(y, m - 1, dd)); $('[data-k="' + k + '"]', pane).value = d[k]; markDirty(); }));
    ['intro', 'additional', 'closing'].forEach(renderPList);
    $$('[data-add]', pane).forEach((b) => (b.onclick = () => { d[b.dataset.add].push(''); renderPList(b.dataset.add); markDirty(); }));
    $$('[data-reset]', pane).forEach((b) => (b.onclick = () => { d[b.dataset.reset] = JSON.parse(JSON.stringify(t.defaults[b.dataset.reset])); renderPList(b.dataset.reset); markDirty(); }));
    renderGrid(); renderSigs();
    const bs = $('#btnSample'); if (bs) bs.onclick = loadSample;
    $('#btnResetWidths').onclick = () => { d.columns = t.columns.map((c) => ({ key: c.key, label: c.label, width: c.width })); renderGrid(); markDirty(); };
  }

  function renderPList(key) {
    const host = $('[data-pl="' + key + '"]'); const arr = S.data[key];
    host.innerHTML = arr.length ? arr.map((p, i) => '<div class="pitem"><textarea rows="2" data-i="' + i + '" style="border:1px solid #cfc9bb;border-radius:5px;padding:6px 8px;width:100%;font:inherit">' + esc(p) + '</textarea><div class="ctl"><button data-up="' + i + '" title="Move up">▲</button><button data-dn="' + i + '" title="Move down">▼</button><button data-rm="' + i + '" title="Remove">✕</button></div></div>').join('') : '<div class="muted" style="font-size:12px">(none)</div>';
    $$('textarea', host).forEach((ta) => (ta.oninput = () => { arr[+ta.dataset.i] = ta.value; markDirty(); }));
    $$('[data-rm]', host).forEach((b) => (b.onclick = () => { arr.splice(+b.dataset.rm, 1); renderPList(key); markDirty(); }));
    $$('[data-up]', host).forEach((b) => (b.onclick = () => { const i = +b.dataset.up; if (i > 0) { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; renderPList(key); markDirty(); } }));
    $$('[data-dn]', host).forEach((b) => (b.onclick = () => { const i = +b.dataset.dn; if (i < arr.length - 1) { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; renderPList(key); markDirty(); } }));
  }

  // ---- signatories (locked while their template default is non-empty)
  function renderSigs() {
    const sg = S.data.signatories, lm = lockMap();
    $('#sigHost').style.gridTemplateColumns = 'repeat(' + Math.min(sg.length, 3) + ',1fr)';
    $('#sigHost').innerHTML = sg.map((s, i) => {
      const ln = lm[i] && lm[i].name && !unlocked(), lt = lm[i] && lm[i].title && !unlocked();
      return '<div class="sig"><h4>' + esc(s.label) + '</h4><label class="f">Name' + (ln ? ' 🔒' : '') + '<textarea rows="2" data-sn="' + i + '" ' + (ln ? 'disabled' : '') + '>' + esc(s.name) + '</textarea></label><label class="f">Job title' + (lt ? ' 🔒' : '') + '<textarea rows="2" data-st="' + i + '" ' + (lt ? 'disabled' : '') + '>' + esc(s.title) + '</textarea></label></div>';
    }).join('');
    $$('[data-sn]').forEach((el) => (el.oninput = () => { sg[+el.dataset.sn].name = el.value; markDirty(); }));
    $$('[data-st]').forEach((el) => (el.oninput = () => { sg[+el.dataset.st].title = el.value; markDirty(); }));
    const anyLock = lm.some((x) => x.name || x.title);
    $('#lockMsg').textContent = anyLock ? (unlocked() ? 'Signatory editing is unlocked for this session.' : 'Default approvers are protected. Unlock with the administrator PIN to change them.') : 'No default approvers for this document type — fields are free to edit.';
    const b = $('#btnUnlock'); b.hidden = !anyLock; b.textContent = unlocked() ? 'Lock again' : 'Unlock…';
    b.onclick = async () => {
      if (unlocked()) { S.token = ''; sessionStorage.removeItem('gmpiToken'); renderSigs(); return; }
      const m = modal('<h2>Unlock signatories</h2><label class="f">Administrator PIN<input type="password" id="pin" autofocus></label><p class="muted" id="pinErr" style="color:#c0182b"></p><div class="foot"><button class="btn" id="pc">Cancel</button><button class="btn primary" id="po">Unlock</button></div>', 'sm');
      const go = async () => { try { const j = await (await api('/api/unlock', { json: { pin: $('#pin', m.el).value } })).json(); S.token = j.token; sessionStorage.setItem('gmpiToken', j.token); m.close(); renderSigs(); toast('Unlocked for ' + j.hours + ' hours'); } catch (e) { $('#pinErr', m.el).textContent = e.message; } };
      $('#po', m.el).onclick = go; $('#pc', m.el).onclick = m.close; $('#pin', m.el).onkeydown = (e) => { if (e.key === 'Enter') go(); };
    };
  }

  // ---- product grid
  let validation = [];
  function renderGrid() {
    const d = S.data, cols = d.columns, host = $('#gridHost');
    host.innerHTML =
      '<div class="tools" style="margin-bottom:8px"><button class="btn small" id="gAdd">+ Add row</button><button class="btn small" id="gAdd5">+ 5 rows</button><button class="btn small" id="gImp">Import Excel / CSV…</button>' +
      (S.type === 'price-increase' ? '<button class="btn small" id="gCalc" title="Fills only empty % cells from the entered old/new prices">Calculate empty % from prices</button>' : '') +
      '<button class="btn small" id="gClear">Remove all rows</button><span class="summary" id="gSum"></span></div>' +
      '<div class="muted" style="font-size:11.5px;margin-bottom:6px">Enter = next row · Shift+Enter = new line in a cell · paste from Excel fills cells · drag the <b>column edges in the preview</b> or type a width % to resize columns (carried into Word and PDF).</div>' +
      '<div class="gridwrap"><table class="grid"><thead><tr><th class="n">#</th>' +
      cols.map((c, i) => '<th><input data-hl="' + i + '" value="' + esc(c.label) + '" title="Column heading"><div class="w">Width <input type="number" min="5" max="60" step="0.5" data-wp="' + i + '" value="' + (c.width / G.TABLE_WIDTH * 100).toFixed(1) + '">%</div></th>').join('') + '<th></th></tr></thead><tbody id="gBody"></tbody></table></div><div class="pager" id="gPager"></div>';
    $('#gAdd').onclick = () => { addRows(1); }; $('#gAdd5').onclick = () => addRows(5);
    $('#gImp').onclick = openImport;
    $('#gClear').onclick = async () => { if (await confirmBox('Remove all product rows?', 'Remove all')) { d.products = [G.emptyProduct(S.type)]; renderGridBody(); markDirty(); } };
    const gc = $('#gCalc'); if (gc) gc.onclick = calcPercents;
    $$('[data-hl]').forEach((el) => (el.oninput = () => { cols[+el.dataset.hl].label = el.value; markDirty(); }));
    $$('[data-wp]').forEach((el) => (el.onchange = () => setWidthPercent(+el.dataset.wp, parseFloat(el.value))));
    renderGridBody();
  }
  function setWidthPercent(i, pct) {
    const cols = S.data.columns; if (!isFinite(pct) || Math.abs(pct - cols[i].width / G.TABLE_WIDTH * 100) < 0.06) return refreshWidthInputs(); // unchanged (rounded display) -> no drift
    const target = Math.round(pct / 100 * G.TABLE_WIDTH), others = cols.reduce((a, c, k) => a + (k === i ? 0 : c.width), 0);
    const w = Math.max(G.MIN_COL, Math.min(target, G.TABLE_WIDTH - G.MIN_COL * (cols.length - 1)));
    const scale = (G.TABLE_WIDTH - w) / others; let acc = 0, last = -1;
    cols.forEach((c, k) => { if (k !== i) { c.width = Math.max(G.MIN_COL, Math.round(c.width * scale)); acc += c.width; last = k; } });
    cols[i].width = w; cols[last >= 0 ? last : i].width += G.TABLE_WIDTH - (acc + w); // keep exact sum
    refreshWidthInputs(); markDirty();
  }
  function refreshWidthInputs() { $$('[data-wp]').forEach((el) => (el.value = (S.data.columns[+el.dataset.wp].width / G.TABLE_WIDTH * 100).toFixed(1))); }
  function addRows(n, focus) {
    for (let i = 0; i < n; i++) S.data.products.push(G.emptyProduct(S.type));
    S.gridPage = Math.floor((S.data.products.length - 1) / GRID_PAGE); renderGridBody(); markDirty();
    if (focus !== false) { const ta = $('textarea[data-r="' + (S.data.products.length - n) + '"]'); ta && ta.focus(); }
  }
  const isAuto = (k) => !!(typeDef().columns.find((x) => x.key === k) || {}).auto;
  function updateSeq() { // renumber the visible rows after an edit (blank rows have no number)
    const d = S.data, from = S.gridPage * GRID_PAGE; let n = d.products.slice(0, from).filter((p) => !G.isBlankRow(S.type, p)).length;
    $$('#gBody .seqno').forEach((el) => { const blank = G.isBlankRow(S.type, d.products[+el.dataset.seq]); el.textContent = blank ? '' : ++n; });
  }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }
  function renderGridBody() {
    const d = S.data, cols = d.columns, body = $('#gBody'), total = d.products.length, pages = Math.max(1, Math.ceil(total / GRID_PAGE));
    S.gridPage = Math.max(0, Math.min(S.gridPage, pages - 1));
    const from = S.gridPage * GRID_PAGE, to = Math.min(total, from + GRID_PAGE);
    let seq = d.products.slice(0, from).filter((p) => !G.isBlankRow(S.type, p)).length;
    body.innerHTML = d.products.slice(from, to).map((p, i) => { const r = from + i, blank = G.isBlankRow(S.type, p); if (!blank) seq++; return '<tr data-r="' + r + '"><td class="n">' + (r + 1) + '</td>' +
      cols.map((c) => isAuto(c.key) ? '<td class="auto" title="Numbered automatically"><span class="seqno" data-seq="' + r + '">' + (blank ? '' : seq) + '</span></td>' : '<td data-key="' + c.key + '"><textarea rows="1" data-r="' + r + '" data-key="' + c.key + '">' + esc(p[c.key]) + '</textarea></td>').join('') +
      '<td class="act"><button data-dup="' + r + '" title="Duplicate row">⧉</button><button data-up="' + r + '" title="Move up">▲</button><button data-dn="' + r + '" title="Move down">▼</button><button data-del="' + r + '" title="Delete row">✕</button></td></tr>'; }).join('');
    const pg = $('#gPager');
    if (pg) {
      pg.innerHTML = pages > 1 ? '<button class="btn small" id="gPrev">‹ Previous</button> Rows ' + (from + 1) + '–' + to + ' of ' + total + ' (page ' + (S.gridPage + 1) + '/' + pages + ') <button class="btn small" id="gNext">Next ›</button> <span class="muted">All rows are saved, previewed in Print/PDF/Word — the editor just shows ' + GRID_PAGE + ' at a time.</span>' : '';
      const pv = $('#gPrev'), nx = $('#gNext'); if (pv) pv.onclick = () => { S.gridPage--; renderGridBody(); }; if (nx) nx.onclick = () => { S.gridPage++; renderGridBody(); };
    }
    $$('textarea', body).forEach((ta) => {
      autoGrow(ta);
      ta.oninput = () => { d.products[+ta.dataset.r][ta.dataset.key] = ta.value; autoGrow(ta); updateSeq(); revalidate(); markDirty(); };
      ta.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault(); const r = +ta.dataset.r;
          if (r === d.products.length - 1) { d.products.push(G.emptyProduct(S.type)); markDirty(); }
          if (r + 1 >= (S.gridPage + 1) * GRID_PAGE) { S.gridPage++; renderGridBody(); }
          const nxt = $('textarea[data-r="' + (r + 1) + '"][data-key="' + ta.dataset.key + '"]'); if (nxt) nxt.focus(); else renderGridBody();
        }
      };
      ta.onpaste = (e) => {
        const txt = (e.clipboardData || window.clipboardData).getData('text');
        if (!/[\t\n]/.test(txt.replace(/\n$/, ''))) return; // plain single value: normal paste
        e.preventDefault();
        const lines = txt.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
        const r0 = +ta.dataset.r, c0 = cols.findIndex((c) => c.key === ta.dataset.key);
        lines.forEach((cells, i) => { while (d.products.length <= r0 + i) d.products.push(G.emptyProduct(S.type)); cells.forEach((v, j) => { if (cols[c0 + j] && !isAuto(cols[c0 + j].key)) d.products[r0 + i][cols[c0 + j].key] = G.cleanText(v.trim()); }); });
        renderGridBody(); markDirty();
      };
    });
    const mv = (a, i, j) => { [a[i], a[j]] = [a[j], a[i]]; renderGridBody(); markDirty(); };
    $$('[data-del]', body).forEach((b) => (b.onclick = () => { d.products.splice(+b.dataset.del, 1); if (!d.products.length) d.products.push(G.emptyProduct(S.type)); renderGridBody(); markDirty(); }));
    $$('[data-dup]', body).forEach((b) => (b.onclick = () => { d.products.splice(+b.dataset.dup + 1, 0, Object.assign({}, d.products[+b.dataset.dup])); renderGridBody(); markDirty(); }));
    $$('[data-up]', body).forEach((b) => (b.onclick = () => +b.dataset.up > 0 && mv(d.products, +b.dataset.up, +b.dataset.up - 1)));
    $$('[data-dn]', body).forEach((b) => (b.onclick = () => +b.dataset.dn < d.products.length - 1 && mv(d.products, +b.dataset.dn, +b.dataset.dn + 1)));
    revalidate();
  }
  function revalidate() {
    validation = G.validateRows(S.type, S.data.products);
    $$('#gBody tr').forEach((tr) => {
      const v = validation[+tr.dataset.r]; if (!v) return;
      $$('td[data-key]', tr).forEach((td) => {
        const k = td.dataset.key, e = v.errors.filter((x) => x.field === k), w = v.warnings.filter((x) => x.field === k);
        td.className = e.length ? 'err' : w.length ? 'warn' : ''; td.title = e.concat(w).map((x) => x.msg).join('\n');
      });
    });
    const rows = validation.filter((v) => !v.blank), er = rows.filter((v) => v.errors.length).length, wr = rows.filter((v) => !v.errors.length && v.warnings.length).length;
    const el = $('#gSum'); if (el) el.innerHTML = '<b>' + rows.length + '</b> product row' + (rows.length === 1 ? '' : 's') + (er ? ' · <span class="e">' + er + ' with errors</span>' : '') + (wr ? ' · <span class="w">' + wr + ' with warnings</span>' : '') + (!er && !wr && rows.length ? ' · <span class="o">no problems found</span>' : '');
  }
  function calcPercents() {
    let n = 0;
    S.data.products.forEach((p) => {
      if (String(p.percent).trim()) return; const o = G.parsePrice(p.oldPrice), nw = G.parsePrice(p.newPrice);
      if (o.ok && nw.ok && o.value > 0) { p.percent = (((nw.value - o.value) / o.value) * 100).toFixed(2).replace(/\.?0+$/, '') + '%'; n++; }
    });
    renderGridBody(); markDirty(); toast(n ? 'Filled ' + n + ' empty % cell(s) from the entered prices (rounded to 2 decimals).' : 'Nothing to calculate — no empty % cells with valid old/new prices.');
  }
  async function loadSample() {
    if (!(await confirmBox('Replace the current recipient, dates and products with the sample from your SANTE BARLEY template?', 'Replace'))) return;
    const d = S.data; d.date = 'October 06, 2026'; d.toName = 'Rose Pharmacy Inc.'; d.toAddress = '3rd Floor FLC Bldg. Hernan Cortes St., Corner F. Cabahug St.,\nSubangdaku, Mandaue City 6014'; d.effectivity = 'October 21, 2026';
    d.products = [{ itemDescription: 'TI-000007487', packaging: 'SANTE BARLEY PURE POW 3g 30s', genericName: 'BARLEY GRASS POWDER', srp: '2,100.00', discount: '30%', tradePrice: '1470.00', barcode: '4806520800627' },
      { itemDescription: 'TI-000002858', packaging: 'SANTE BARLEY PURE CAP', genericName: 'BARLEY GRASS', srp: '1,050.00', discount: '30%', tradePrice: '735.00', barcode: '4806520800627' }];
    renderForm(); markDirty();
  }

  // ------------------------------------------------------------ preview rendering
  function sheetHTML(L, limit) {
    const cell = (v, c) => '<td style="text-align:' + c.align + ';' + (c.bold ? 'font-weight:700;' : '') + '">' + esc(v) + '</td>';
    const sup = (t) => G.ordinalSegments(t).map((s) => (s.sup ? '<sup>' + esc(s.t) + '</sup>' : esc(s.t))).join('');
    const head = L.headRows.map((r) => '<tr><td class="l">' + esc(r.label) + '</td><td class="v">' + r.lines.map((ln) => '<div' + (ln.big ? ' class="big"' : '') + '>' + (ln.ordinals ? sup(ln.text) : esc(ln.text)) + (ln.text === '' ? '&nbsp;' : '') + '</div>').join('') + '</td></tr>').join('');
    const cg = '<colgroup>' + L.columns.map((c) => '<col data-key="' + c.key + '" style="width:' + (c.width / G.TABLE_WIDTH * 100) + '%">').join('') + '</colgroup>';
    const th = '<thead><tr>' + L.columns.map((c, i) => '<th>' + esc(c.label) + (i < L.columns.length - 1 ? '<span class="rz" data-rz="' + c.key + '" data-nx="' + L.columns[i + 1].key + '"></span>' : '') + '</th>').join('') + '</tr></thead>';
    const shownRows = limit && L.rows.length > limit ? L.rows.slice(0, limit) : L.rows;
    const tb = L.rows.length ? shownRows.map((r) => '<tr>' + L.columns.map((c) => cell(r[c.key], c)).join('') + '</tr>').join('') + (shownRows.length < L.rows.length ? '<tr><td colspan="' + L.columns.length + '" class="empty-note" style="text-align:center">… ' + (L.rows.length - shownRows.length) + ' more rows are included in Print, PDF and Word but not drawn in this on-screen preview (use “Exact PDF view”).</td></tr>' : '') : '<tr><td colspan="' + L.columns.length + '" class="empty-note" style="text-align:center">No products yet</td></tr>';
    const sg = L.signatories;
    const two = sg.length === 2; // 2 signatories: opposite margins; 3: original layout
    const cw = two ? [35.6, 28.8, 35.6] : [30.7, 3.5, 30.7, 3.5, 31.6];
    const ids = cw.map((_, i) => i);
    const sigRow = (fn) => '<tr>' + ids.map((i) => (i % 2 ? '<td></td>' : fn(sg[i / 2]))).join('') + '</tr>';
    const sig = '<table class="sigt' + (L.type === 'price-increase' ? ' pin' : '') + '"><colgroup>' + cw.map((w) => '<col style="width:' + w + '%">').join('') + '</colgroup>' +
      sigRow((x) => '<td class="lab">' + esc(x.label) + '</td>') + sigRow(() => '<td class="line"></td>') +
      sigRow((x) => '<td class="nm">' + esc(x.name || '\u00a0') + '<span class="tt">' + esc(x.title) + '</span></td>') + '</table>';
    return '<div class="sheet"><div class="hdr"><img class="logo" src="/assets/logo.png" alt=""><div class="l1"></div><div class="l2"></div></div>' +
      '<div class="ftr"><div class="g"></div><div class="r"></div><img class="img" src="/assets/footer.png" alt=""></div>' +
      '<table class="frame"><thead><tr><td><div class="sp-top"></div></td></tr></thead><tbody><tr><td><div class="dbody">' +
      '<h1 class="dt">' + esc(L.docTitle) + '</h1><table class="head">' + head + '</table>' +
      '<p class="sal">' + esc(L.salutation) + '</p>' +
      L.intro.map((p, i) => '<p class="ip' + (i === L.intro.length - 1 ? ' last' : '') + '">' + esc(p) + '</p>').join('') +
      (L.noticeLine ? '<p class="nl' + (L.type === 'price-increase' ? ' pin' : '') + '">' + esc(L.noticeLine) + '</p>' : '') +
      '<table class="prod">' + cg + th + '<tbody>' + tb + '</tbody></table><div class="after"></div>' +
      L.additional.map((p) => '<p class="cp">' + esc(p) + '</p>').join('') + L.closing.map((p) => '<p class="cp">' + esc(p) + '</p>').join('') + sig +
      '</div></td></tr></tbody><tfoot><tr><td><div class="sp-bot"></div></td></tr></tfoot></table></div>';
  }
  let pvT;
  function schedulePreview() { clearTimeout(pvT); pvT = setTimeout(refreshPreview, 120); }
  function refreshPreview() {
    if (!S.data) return;
    const L = G.buildLayout(S.type, S.data);
    const host = $('#pvSheet'); host.innerHTML = sheetHTML(L, PREVIEW_ROWS);
    fitPreview(); bindResizers();
    const sheet = $('.sheet', host), approx = Math.max(1, Math.ceil(sheet.offsetHeight / (841.89 * 96 / 72) - 0.02));
    $('#pvInfo').textContent = L.rows.length + ' product row' + (L.rows.length === 1 ? '' : 's') + ' · about ' + approx + ' page' + (approx > 1 ? 's' : '') + ' (use “Exact PDF view” for true pagination)';
    if (S.mode === 'preview' && S.pvMode === 'pdf') loadPdfFrame();
  }
  function fitPreview() {
    const sc = $('#pvScale'), wrap = $('#pvScroll'); sc.style.transform = '';
    const avail = wrap.clientWidth - 28, need = 595.28 * 96 / 72, k = Math.min(1, avail / need);
    sc.style.transform = 'scale(' + k + ')'; sc.style.width = need + 'px'; sc.style.height = 'auto';
    sc.style.marginBottom = -(sc.scrollHeight * (1 - k)) + 'px'; sc.style.marginLeft = Math.max(0, (avail - need * k) / 2) + 'px';
    sc.dataset.k = k;
  }
  window.addEventListener('resize', () => !$('#viewEditor').hidden && fitPreview());

  // ---- drag column edges in the preview
  function bindResizers() {
    $$('#pvSheet .rz').forEach((h) => {
      h.onmousedown = (ev) => {
        ev.preventDefault(); const cols = S.data.columns, a = cols.find((c) => c.key === h.dataset.rz), nx = cols.find((c) => c.key === h.dataset.nx);
        if (!a || !nx) return;
        const tbl = h.closest('table'), k = +$('#pvScale').dataset.k || 1, keys = $$('col', tbl).map((c) => c.dataset.key);
        const visSum = keys.reduce((t, key) => t + ((cols.find((c) => c.key === key) || {}).width || 0), 0) || G.TABLE_WIDTH; // optional empty columns are not drawn
        const px = tbl.getBoundingClientRect().width / k, startX = ev.clientX, a0 = a.width, b0 = nx.width; h.classList.add('drag');
        const mv = (e) => {
          const dd = Math.round(((e.clientX - startX) / k) * (visSum / px));
          const d2 = Math.max(G.MIN_COL - a0, Math.min(b0 - G.MIN_COL, dd)); a.width = a0 + d2; nx.width = b0 - d2;
          $$('#pvSheet table.prod col, #printRoot table.prod col').forEach((c) => { const x = cols.find((y) => y.key === c.dataset.key); if (x) c.style.width = (x.width / visSum * 100) + '%'; });
          refreshWidthInputs();
        };
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); h.classList.remove('drag'); markDirty(); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      };
    });
  }

  // ------------------------------------------------------------ modes / actions
  function setMode(m) {
    S.mode = m; const full = m === 'preview';
    $('#split').classList.toggle('preview-only', full); $('#btnBack').hidden = !full; $('#btnPreview').hidden = full; $('#pvMode').hidden = !full;
    if (!full) { S.pvMode = 'live'; $('#pdfFrame').hidden = true; $('#pvScroll').hidden = false; $$('#pvMode button').forEach((b) => b.classList.toggle('on', b.dataset.m === 'live')); }
    setTimeout(fitPreview, 30);
  }
  $('#btnPreview').onclick = () => { setMode('preview'); refreshPreview(); window.scrollTo(0, 0); };
  $('#btnBack').onclick = () => setMode('edit');
  $$('#pvMode button').forEach((b) => (b.onclick = () => {
    S.pvMode = b.dataset.m; $$('#pvMode button').forEach((x) => x.classList.toggle('on', x === b));
    $('#pvScroll').hidden = S.pvMode === 'pdf'; $('#pdfFrame').hidden = S.pvMode !== 'pdf';
    if (S.pvMode === 'pdf') loadPdfFrame(); else fitPreview();
  }));
  let pdfUrl = null;
  async function loadPdfFrame() {
    try { const r = await requestExport('pdf', true); if (!r) return; const blob = await r.blob(); if (pdfUrl) URL.revokeObjectURL(pdfUrl); pdfUrl = URL.createObjectURL(blob); $('#pdfFrame').src = pdfUrl + '#view=FitH'; }
    catch (e) { toast(e.message, true); }
  }
  $('#btnPrint').onclick = () => {
    const L = G.buildLayout(S.type, S.data); if (!L.rows.length && !confirm('There are no product rows. Print anyway?')) return;
    $('#printRoot').innerHTML = sheetHTML(L); const imgs = $$('#printRoot img'); // make sure artwork is decoded before the dialog opens
    Promise.all(imgs.map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })))).then(() => setTimeout(() => window.print(), 250));
  };
  $('#btnImport').onclick = () => openImport();

  async function requestExport(format, quiet) {
    const L = G.buildLayout(S.type, S.data);
    if (!L.rows.length) { toast('Add at least one product before exporting.', true); return null; }
    if (!quiet) {
      const bad = G.validateRows(S.type, S.data.products).map((v, i) => (v.errors.length ? i + 1 : 0)).filter(Boolean);
      if (bad.length && !(await confirmBox('Row(s) ' + bad.slice(0, 15).join(', ') + (bad.length > 15 ? '…' : '') + ' contain invalid values (highlighted in red). They will be exported exactly as typed. Continue?', 'Export anyway'))) return null;
    }
    try { return await api('/api/export/' + format, { json: { type: S.type, data: S.data, id: S.id, keep: !quiet } }); }
    catch (e) { toast(e.message, true); return null; }
  }
  async function download(format) {
    const btn = format === 'docx' ? $('#btnWord') : $('#btnPdf'); btn.disabled = true;
    try {
      if (canEdit() && (!S.id || S.dirty)) { if (!(await saveDraft())) return; } // saved first, so the generated file is linked to a saved version
      const r = await requestExport(format); if (!r) return;
      const blob = await r.blob(), name = G.fileName(S.type, S.data, format), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Downloaded ' + name + ' (' + Math.round(blob.size / 1024) + ' KB)');
    } finally { btn.disabled = false; }
  }
  $('#btnWord').onclick = () => download('docx');
  $('#btnPdf').onclick = () => download('pdf');
  $('#btnSave').onclick = () => saveDraft();
  async function saveDraft(asCopy) {
    if (!canEdit()) { toast('Your account can view and download documents but not save them.', true); return false; }
    try {
      const doc = await (await api('/api/docs', { json: { id: asCopy ? null : S.id, type: S.type, data: S.data, baseRevision: asCopy || !S.id ? undefined : S.revision } })).json();
      S.id = doc.id; S.savedAt = doc.updatedAt; S.revision = doc.revision; S.refNo = doc.refNo; setDirty(false);
      $('#edRef').textContent = 'Ref ' + S.refNo; $('#btnVersions').hidden = false; toast('Saved to the server (version ' + doc.revision + ').'); return true;
    } catch (e) {
      const p = $('#saveState'); p.className = 'pill err'; p.textContent = 'NOT saved';
      if (e.status === 409) {
        const copy = await confirmBox('This document was changed by someone else (or in another tab) after you opened it. Saving now would overwrite their work.\n\nSave YOUR version as a new separate copy instead?', 'Save as new copy', 'Do not save');
        if (copy) return saveDraft(true);
        return false;
      }
      toast(e.message, true); return false;
    }
  }
  $('#btnNew').onclick = async () => { if (await confirmBox('Start a new ' + typeDef().name + '? ' + (S.dirty ? 'Unsaved changes will be lost.' : ''), 'Start new')) { openNew(S.type); } };
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !$('#viewEditor').hidden) { e.preventDefault(); if (canEdit()) saveDraft(); } });

  // ------------------------------------------------------------ history / search / versions
  const H = { q: '', type: '', status: '', page: 0 }, H_PAGE = 25;
  function fileDownload(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  async function loadHistory() {
    const bar = $('#historyBar'), host = $('#historyList');
    if (!bar.dataset.ready) {
      bar.dataset.ready = '1';
      bar.innerHTML = '<input id="hQ" type="search" placeholder="Search customer, reference no., product, principal…" style="min-width:320px;padding:7px 9px;border:1px solid #cfc9bb;border-radius:5px">' +
        '<select id="hType" style="padding:7px"><option value="">All types</option>' + S.cfg.types.map((t) => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join('') + '</select>' +
        '<select id="hStatus" style="padding:7px"><option value="">Any status</option><option value="draft">Draft</option><option value="exported">Exported</option></select>';
      let t; $('#hQ').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { H.q = e.target.value; H.page = 0; loadHistory(); }, 250); };
      $('#hType').onchange = (e) => { H.type = e.target.value; H.page = 0; loadHistory(); }; $('#hStatus').onchange = (e) => { H.status = e.target.value; H.page = 0; loadHistory(); };
    }
    host.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const qs = new URLSearchParams({ q: H.q, type: H.type, status: H.status, limit: H_PAGE, offset: H.page * H_PAGE });
      const r = await (await api('/api/docs?' + qs)).json(), list = r.items;
      const st = S.cfg.storage;
      $('#historyNote').textContent = st ? (st.engine === 'postgres' ? 'Stored in the online PostgreSQL database.' : 'Stored in the database on the computer running the server (' + st.location + ').') + ' Every save keeps a version; every generated Word/PDF is kept.' : '';
      host.innerHTML = list.length ? '<table class="hist"><thead><tr><th>Ref no.</th><th>Customer / title</th><th>Type</th><th>Rows</th><th>Last saved</th><th>Status</th><th></th></tr></thead><tbody>' + list.map((d) =>
        '<tr><td>' + esc(d.refNo) + '</td><td><b>' + esc(d.title) + '</b></td><td>' + esc((G.DOC_TYPES[d.type] || {}).name || d.type) + '</td><td>' + d.rows + '</td><td>' + new Date(d.updatedAt).toLocaleString() + '<br><span class="muted">v' + d.revision + ' · ' + esc(d.updatedBy) + '</span></td><td>' + (d.exports ? 'Exported (' + d.exports + ' file' + (d.exports > 1 ? 's' : '') + ')' : 'Draft') + '</td>' +
        '<td style="white-space:nowrap"><button class="btn small" data-o="' + d.id + '">Open / edit</button> <button class="btn small" data-v="' + d.id + '">Versions &amp; files</button>' + (canEdit() ? ' <button class="btn small" data-c="' + d.id + '">Duplicate</button> <button class="btn small danger-ghost" data-x="' + d.id + '">Delete</button>' : '') + '</td></tr>').join('') + '</tbody></table>' +
        '<div class="pager">' + r.total + ' document(s) ' + (H.page > 0 ? '<button class="btn small" id="hPrev">‹ Newer</button>' : '') + ((H.page + 1) * H_PAGE < r.total ? '<button class="btn small" id="hNext">Older ›</button>' : '') + '</div>'
        : '<p>' + (H.q || H.type || H.status ? 'No documents match your search.' : 'No saved documents yet. Create a document and press <b>Save Draft</b>.') + '</p>';
      $$('[data-o]', host).forEach((b) => (b.onclick = () => openDoc(b.dataset.o)));
      $$('[data-v]', host).forEach((b) => (b.onclick = () => openVersions(b.dataset.v)));
      $$('[data-c]', host).forEach((b) => (b.onclick = async () => { try { await api('/api/docs/' + b.dataset.c + '/duplicate', { method: 'POST' }); loadHistory(); } catch (e) { toast(e.message, true); } }));
      $$('[data-x]', host).forEach((b) => (b.onclick = async () => { if (await confirmBox('Delete this saved document, its saved versions and its generated files permanently?', 'Delete')) { try { await api('/api/docs/' + b.dataset.x, { method: 'DELETE' }); loadHistory(); } catch (e) { toast(e.message, true); } } }));
      const pv = $('#hPrev'), nx = $('#hNext'); if (pv) pv.onclick = () => { H.page--; loadHistory(); }; if (nx) nx.onclick = () => { H.page++; loadHistory(); };
    } catch (e) { host.innerHTML = '<p style="color:#c0182b">' + esc(e.message) + '</p>'; }
  }
  $('#btnVersions').onclick = () => S.id && openVersions(S.id);
  async function openVersions(id) {
    const m = modal('<h2>Versions &amp; generated files</h2><div id="vBody" class="muted">Loading…</div><div class="foot"><button class="btn" id="vClose">Close</button></div>');
    $('#vClose', m.el).onclick = m.close;
    try {
      const [revs, exps, doc] = await Promise.all([api('/api/docs/' + id + '/revisions').then((r) => r.json()), api('/api/docs/' + id + '/exports').then((r) => r.json()), api('/api/docs/' + id).then((r) => r.json())]);
      $('#vBody', m.el).innerHTML = '<p><b>' + esc(doc.refNo) + '</b> — ' + esc(doc.title) + ' (' + esc(G.DOC_TYPES[doc.type].name) + ')</p>' +
        '<h3 style="margin:10px 0 4px">Generated Word / PDF files</h3>' + (exps.length ? '<table class="hist"><thead><tr><th>File</th><th>Made</th><th>From version</th><th>By</th><th></th></tr></thead><tbody>' + exps.map((x) => '<tr><td>' + esc(x.filename) + '</td><td>' + new Date(x.createdAt).toLocaleString() + '</td><td>v' + x.docRevision + '</td><td>' + esc(x.createdBy) + '</td><td><button class="btn small" data-dl="' + x.id + '" data-n="' + esc(x.filename) + '">Download</button></td></tr>').join('') + '</tbody></table>' : '<p class="muted">None yet — they are saved here every time you press Download Word / Download PDF.</p>') +
        '<h3 style="margin:14px 0 4px">Saved versions (edit history)</h3><table class="hist"><thead><tr><th>Version</th><th>Saved</th><th>By</th><th></th></tr></thead><tbody>' + revs.map((v) => '<tr><td>v' + v.revision + (v.revision === doc.revision ? ' <span class="badge">current</span>' : '') + '</td><td>' + new Date(v.savedAt).toLocaleString() + '</td><td>' + esc(v.savedBy) + '</td><td>' + (canEdit() && v.revision !== doc.revision ? '<button class="btn small" data-rv="' + v.revision + '">Restore this version into the editor</button>' : '') + '</td></tr>').join('') + '</tbody></table>';
      $$('[data-dl]', m.el).forEach((b) => (b.onclick = async () => { try { fileDownload(await (await api('/api/exports/' + b.dataset.dl)).blob(), b.dataset.n); } catch (e) { toast(e.message, true); } }));
      $$('[data-rv]', m.el).forEach((b) => (b.onclick = async () => {
        try {
          const v = await (await api('/api/docs/' + id + '/revisions/' + b.dataset.rv)).json();
          if (!(await confirmBox('Load version ' + v.revision + ' into the editor? Nothing is overwritten until you press Save Draft (which then becomes the newest version).', 'Load version'))) return;
          m.close(); S.type = doc.type; S.id = id; S.revision = doc.revision; S.refNo = doc.refNo; S.savedAt = doc.updatedAt; S.gridPage = 0; S.data = G.normalize(doc.type, v.data);
          openEditor(); setDirty(true); toast('Version ' + v.revision + ' loaded — press Save Draft to keep it.');
        } catch (e) { toast(e.message, true); }
      }));
    } catch (e) { $('#vBody', m.el).textContent = e.message; }
  }

  // ------------------------------------------------------------ IMPORT wizard
  const IM = {}, IM_PAGE = 100;
  const colLetter = (c) => { let s = '', n = c + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const fl = (k) => G.fieldLabel(S.type, k);
  function openImport() {
    const m = modal('<h2>Import products from Excel / CSV</h2><p class="muted">Select a .xlsx, .xls or .csv file. The real worksheet is read, the product table is located under any title rows, and nothing is added to the document until you review and confirm. Values are imported exactly as they appear — prices and percentages are never reformatted or guessed.</p>' +
      '<input type="file" id="impFile" accept=".xlsx,.xlsm,.xlsb,.xls,.ods,.csv,.tsv,.txt"><div id="impBody" style="margin-top:12px"></div><div class="foot"><button class="btn" id="impClose">Cancel</button></div>');
    IM.m = m; $('#impClose', m.el).onclick = m.close;
    $('#impFile', m.el).onchange = (e) => { const f = e.target.files[0]; if (f) { IM.file = f; uploadFile(f, ''); } };
  }
  async function uploadFile(file, sheet) {
    const body = $('#impBody', IM.m.el); body.innerHTML = '<p class="muted">Reading ' + esc(file.name) + '…</p>';
    try {
      const buf = await file.arrayBuffer();
      const r = await api('/api/import/parse?type=' + S.type + '&name=' + encodeURIComponent(file.name) + (sheet ? '&sheet=' + encodeURIComponent(sheet) : ''), { method: 'POST', body: buf, headers: { 'Content-Type': 'application/octet-stream' } });
      IM.res = await r.json(); IM.headerRow = IM.res.headerRow; IM.headerRows = IM.res.headerRows || 1; IM.mapping = Object.assign({}, IM.res.mapping);
      IM.opts = IM.opts || { pct: 'strict', calc: S.type === 'price-increase' }; IM.rows = null;
      const of = $('#impClose', IM.m.el); if (of) of.parentElement.hidden = true; // the wizard has its own Cancel buttons
      renderSetup();
    } catch (e) { body.innerHTML = '<p style="color:#c0182b"><b>The file could not be imported.</b> ' + esc(e.message) + '</p><p class="muted">Nothing was added to your document.</p>'; }
  }
  function headerTexts() { return IM.headerRow >= 0 ? G.combinedHeaders(IM.res.matrix, IM.headerRow, IM.headerRows) : []; }
  function remap() { if (IM.headerRow >= 0) IM.mapping = G.mapFromHeaders(S.type, headerTexts()); else IM.mapping = {}; }

  function renderSetup() {
    const R = IM.res, body = $('#impBody', IM.m.el), width = R.matrix[0].length, heads = headerTexts(), fields = G.importFields(S.type);
    const dupe = (S.data.importLog || []).find((x) => x.hash === R.hash && x.sheet === R.sheet);
    let h = '<div><b>' + esc(R.filename) + '</b> · ' + (R.format === 'csv' ? 'CSV (delimiter “' + (R.delimiter === '\t' ? 'tab' : R.delimiter) + '”)' : 'Excel workbook') + ' · ' + R.rowCount.toLocaleString() + ' rows × ' + width + ' columns' + '</div>';
    if (R.warning) h += '<p class="st w">⚠ ' + esc(R.warning) + '</p>';
    if (dupe) h += '<p class="st w">⚠ This exact workbook' + (R.sheet ? ' sheet' : '') + ' was already imported into this document on ' + esc(new Date(dupe.at).toLocaleString()) + ' (' + dupe.imported + ' rows). You will be asked to confirm before importing it again.</p>';
    if (R.sheets.length) {
      h += '<label class="f" style="max-width:520px">Worksheet' + (R.autoSheet && R.sheets.length > 1 ? ' <span class="help">(selected automatically — it contains the best-matching product headers; change it if wrong)</span>' : '') + '<select id="impSheet">' + R.sheets.map((s) => '<option value="' + esc(s.name) + '"' + (s.name === R.sheet ? ' selected' : '') + '>' + esc(s.name) + ' — ' + s.rows + ' rows' + (s.hidden ? ' (hidden sheet)' : '') + (s.score ? ' · ' + s.score + ' recognised headers' : '') + '</option>').join('') + '</select></label>';
    }
    // header row chooser + clickable preview
    h += '<div class="row2" style="margin-top:8px"><label class="f">Header row (the row with column names)<select id="impHdr"><option value="-1"' + (IM.headerRow < 0 ? ' selected' : '') + '>No header row — map columns manually</option>' +
      R.matrix.slice(0, 80).map((r, i) => '<option value="' + i + '"' + (i === IM.headerRow ? ' selected' : '') + '>Row ' + (i + 1) + ': ' + esc(r.filter(Boolean).slice(0, 4).join(' | ').slice(0, 70) || '(blank)') + '</option>').join('') + '</select></label>' +
      '<label class="f">Header spans<select id="impSpan">' + [1, 2, 3].map((n) => '<option value="' + n + '"' + (n === IM.headerRows ? ' selected' : '') + '>' + n + ' row' + (n > 1 ? 's' : '') + '</option>').join('') + '</select></label></div>';
    const from = Math.max(0, (IM.headerRow < 0 ? 0 : IM.headerRow) - 2), to = Math.min(R.matrix.length, from + 14);
    h += '<div class="hdrprev"><table><tbody>' + R.matrix.slice(from, to).map((r, i) => { const ri = from + i, hd = IM.headerRow >= 0 && ri >= IM.headerRow && ri < IM.headerRow + IM.headerRows; return '<tr class="' + (hd ? 'hd' : '') + '"><td class="rn" data-hr="' + ri + '" title="Click to use this row as the header">' + (ri + 1) + '</td>' + r.slice(0, 14).map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>'; }).join('') + '</tbody></table></div><div class="muted" style="font-size:11.5px">Click a row number to use that row as the header. Showing rows ' + (from + 1) + '–' + to + '.</div>';
    // mapping
    const opts = '<option value="">— ignore this column —</option>' + fields.map((f) => '<option value="' + f.key + '">' + esc(f.label) + '</option>').join('');
    h += '<h3 style="margin:12px 0 2px">Column mapping</h3><div class="muted" style="font-size:12px">Columns are matched by their header names, not their position. Correct any column below.</div><div class="map">';
    for (let c = 0; c < width; c++) {
      const sample = R.matrix.slice(IM.headerRow + IM.headerRows, IM.headerRow + IM.headerRows + 4).map((r) => r[c]).filter(Boolean).join(' · ');
      h += '<div><b>Column ' + colLetter(c) + '</b>' + (R.hiddenCols.includes(c) ? '<span class="badge hid">hidden in Excel</span>' : '') + '<span class="s">' + esc(heads[c] || (IM.headerRow >= 0 ? '(blank heading)' : 'no heading')) + '</span><span class="s" style="font-style:italic">e.g. ' + esc(sample || '—') + '</span><select data-c="' + c + '">' + opts + '</select></div>';
    }
    h += '</div>';
    if (S.type === 'price-increase') h += '<label style="display:block;margin:6px 0"><input type="checkbox" id="impCalc"' + (IM.opts.calc ? ' checked' : '') + '> Calculate <b>% Increase</b> from old/new price <u>only</u> when the workbook has no valid percentage for that row</label>';
    h += '<div class="st" style="margin:6px 0" id="impPctBox"><b>Percentages without a % sign</b> (e.g. 0.05 or 5): ' +
      '<label><input type="radio" name="impPct" value="strict"' + (IM.opts.pct === 'strict' ? ' checked' : '') + '> flag them for correction (default)</label> ' +
      '<label><input type="radio" name="impPct" value="fraction"' + (IM.opts.pct === 'fraction' ? ' checked' : '') + '> they are fractions (0.05 = 5%)</label> ' +
      '<label><input type="radio" name="impPct" value="whole"' + (IM.opts.pct === 'whole' ? ' checked' : '') + '> they are whole percents (5 = 5%)</label></div>';
    h += '<div id="mapErr"></div><div class="foot"><button class="btn" id="impClose2">Cancel</button><button class="btn primary" id="impNext">Review rows →</button></div>';
    body.innerHTML = h;
    $$('select[data-c]', body).forEach((sel) => { sel.value = IM.mapping[sel.dataset.c] || ''; sel.onchange = () => { if (sel.value) IM.mapping[sel.dataset.c] = sel.value; else delete IM.mapping[sel.dataset.c]; }; });
    const sh = $('#impSheet', body); if (sh) sh.onchange = () => uploadFile(IM.file, sh.value);
    $('#impHdr', body).onchange = (e) => { IM.headerRow = +e.target.value; remap(); renderSetup(); };
    $('#impSpan', body).onchange = (e) => { IM.headerRows = +e.target.value; remap(); renderSetup(); };
    $$('[data-hr]', body).forEach((td) => (td.onclick = () => { IM.headerRow = +td.dataset.hr; remap(); renderSetup(); }));
    const cb = $('#impCalc', body); if (cb) cb.onchange = () => (IM.opts.calc = cb.checked);
    $$('input[name=impPct]', body).forEach((r) => (r.onchange = () => (IM.opts.pct = r.value)));
    $('#impClose2', body).onclick = IM.m.close;
    $('#impNext', body).onclick = () => {
      const used = {}, dup = [];
      Object.keys(IM.mapping).forEach((c) => { const k = IM.mapping[c]; if (used[k] != null) dup.push(fl(k)); used[k] = c; });
      const missing = G.DOC_TYPES[S.type].required.filter((k) => !used.hasOwnProperty(k));
      const err = (m) => ($('#mapErr', body).innerHTML = '<p class="st e">✖ ' + m + '</p>');
      if (dup.length) return err('More than one column is mapped to: ' + esc(dup.join(', ')) + '. Each field can be used once.');
      if (missing.length) return err('Map a column to the required field: ' + esc(missing.map(fl).join(', ')) + '.');
      if (!Object.keys(IM.mapping).length) return err('No columns are mapped.');
      buildReview();
    };
  }

  const trimNum = (x) => String(Number(x.toPrecision(12)));
  function buildReview() {
    const R = IM.res, hs = IM.headerRow + IM.headerRows, t = G.DOC_TYPES[S.type];
    IM.rows = []; IM.blank = 0; IM.unmapped = {}; IM.page = 0; IM.filter = 'all'; IM.ack = false; IM.again = false;
    for (let r = hs; r < R.matrix.length; r++) {
      const src = R.matrix[r];
      if (!src.some(Boolean)) { IM.blank++; continue; }
      const row = G.emptyProduct(S.type), notes = [];
      Object.keys(IM.mapping).forEach((c) => {
        const k = IM.mapping[c]; let v = src[c] || '';
        if (t.percentFields.includes(k) && v && /^\d+(\.\d+)?$/.test(v)) { // percent without % sign: only converted when YOU chose how to read it
          if (IM.opts.pct === 'fraction') { v = trimNum(parseFloat(v) * 100) + '%'; notes.push({ level: 'info', field: k, msg: 'Source value ' + src[c] + ' read as a fraction → ' + v }); }
          else if (IM.opts.pct === 'whole') { v = v + '%'; notes.push({ level: 'info', field: k, msg: 'Source value ' + src[c] + ' read as a whole percent → ' + v }); }
        }
        row[k] = v;
        const n = R.notes[r + ',' + c]; if (n) notes.push({ level: n.level, field: k, msg: n.msg });
      });
      src.forEach((v, c) => { if (v && IM.mapping[c] == null) IM.unmapped[c] = (IM.unmapped[c] || 0) + 1; });
      if (S.type === 'price-increase' && IM.opts.calc && !String(row.percent).trim()) {
        const o = G.parsePrice(row.oldPrice), n = G.parsePrice(row.newPrice);
        if (o.ok && n.ok && o.value > 0) {
          row.percent = (((n.value - o.value) / o.value) * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
          const hadErr = notes.filter((x) => x.field === 'percent' && x.level === 'error');
          hadErr.forEach((x) => { x.level = 'info'; x.msg = 'The workbook cell had no usable value (' + x.msg.slice(0, 90) + '…)'; });
          notes.push({ level: 'info', field: 'percent', msg: '% calculated from old/new price' + (hadErr.length ? ' because the workbook formula had no saved result' : ' (the workbook had none)') });
        }
      }
      if (R.hiddenRows.includes(r)) notes.push({ level: 'info', field: null, msg: 'This row is hidden/filtered in Excel; it is included — untick it to skip.' });
      IM.rows.push({ line: r + 1, row, notes, include: true, auto: false });
    }
    if (!IM.rows.length) { $('#impBody', IM.m.el).insertAdjacentHTML('beforeend', '<p class="st e">✖ No data rows were found below the header row.</p>'); return; }
    revalidateImport(true); renderReview();
  }
  function revalidateImport(initial) {
    const rows = IM.rows, vals = G.validateRows(S.type, rows.map((r) => r.row)); IM.vals = vals;
    const seen = new Map(), exist = new Map();
    S.data.products.forEach((p, i) => { if (!G.isBlankRow(S.type, p)) { const k = G.rowKey(S.type, p); if (!exist.has(k)) exist.set(k, i + 1); } });
    rows.forEach((r, i) => {
      const v = vals[i], k = G.rowKey(S.type, r.row); r.dup = null;
      if (exist.has(k)) r.dup = 'Already in this document (row ' + exist.get(k) + ')'; else if (seen.has(k)) r.dup = 'Duplicate of file row ' + seen.get(k); else seen.set(k, r.line);
      r.errors = v.errors.map((x) => x.msg).concat(r.notes.filter((n) => n.level === 'error').map((n) => n.msg));
      r.errFields = v.errors.map((x) => x.field).concat(r.notes.filter((n) => n.level === 'error').map((n) => n.field));
      r.warnFields = v.warnings.map((x) => x.field);
      r.warns = v.warnings.map((x) => x.msg);
      if (S.type === 'price-list' && String(r.row.itemNo || '').trim() && !/^\d+$/.test(String(r.row.itemNo).trim())) { r.warns.push('The file’s Item No. “' + r.row.itemNo + '” is not used — Item No. is numbered automatically (map that column to Item Description if it is a product code).'); r.warnFields.push('itemNo'); }
      if (initial) r.include = !r.errors.length && !r.dup; else if (r.errors.length) r.include = false;
    });
  }
  function importCounts() {
    const rows = IM.rows, bad = rows.filter((r) => r.errors.length), dups = rows.filter((r) => r.dup), sel = rows.filter((r) => r.include && !r.errors.length);
    return { total: rows.length, bad, dups, sel, valid: rows.length - bad.length };
  }
  function renderReview() {
    const body = $('#impBody', IM.m.el), t = G.DOC_TYPES[S.type], exist = S.data.products.filter((p) => !G.isBlankRow(S.type, p)).length;
    const mappedKeys = Object.values(IM.mapping), cols = G.importFields(S.type).filter((f) => mappedKeys.includes(f.key) && !isAuto(f.key));
    IM.showNo = G.DOC_TYPES[S.type].columns.some((c) => c.auto);
    const dupeFile = (S.data.importLog || []).find((x) => x.hash === IM.res.hash && x.sheet === IM.res.sheet);
    body.innerHTML = '<div id="impSum" class="summary"></div>' +
      '<div class="tools" style="margin:8px 0"><label>Show <select id="impFilter"><option value="all">all rows</option><option value="bad">rows needing correction</option><option value="dup">duplicates</option><option value="sel">rows to import</option></select></label>' +
      '<button class="btn small" id="impAll">Select all valid</button><button class="btn small" id="impNone">Select none</button><span class="muted" style="font-size:12px">Edit any cell to correct it.</span></div>' +
      '<div class="imp-table"><table><thead><tr><th>Add</th><th>Excel row</th>' + (IM.showNo ? '<th title="Assigned automatically, in order">Item No.</th>' : '') + cols.map((c) => '<th>' + esc(c.label) + '</th>').join('') + '<th>Check</th></tr></thead><tbody id="impRows"></tbody></table></div><div class="pager" id="impPager"></div>' +
      '<div style="margin-top:10px"><label><input type="radio" name="impMode" value="add" ' + (exist ? 'checked' : '') + '> Add to the ' + exist + ' existing row(s)</label> &nbsp; <label><input type="radio" name="impMode" value="replace" ' + (exist ? '' : 'checked') + '> Replace existing rows</label></div>' +
      '<div id="impAck"></div><div class="foot"><button class="btn" id="impBack">← Back to mapping</button><button class="btn" id="impClose3">Cancel</button><button class="btn primary" id="impGo">Import</button></div>';
    IM.cols = cols;
    $('#impFilter', body).onchange = (e) => { IM.filter = e.target.value; IM.page = 0; drawImportRows(); };
    $('#impAll', body).onclick = () => { IM.rows.forEach((r) => (r.include = !r.errors.length)); drawImportRows(); updateImportSummary(); };
    $('#impNone', body).onclick = () => { IM.rows.forEach((r) => (r.include = false)); drawImportRows(); updateImportSummary(); };
    $('#impBack', body).onclick = renderSetup; $('#impClose3', body).onclick = IM.m.close; $('#impGo', body).onclick = commitImport;
    $$('input[name=impMode]', body).forEach((r) => (r.onchange = () => drawImportRows()));
    drawImportRows(); updateImportSummary();
  }
  function filteredRows() { const f = IM.filter; return IM.rows.map((r, i) => [r, i]).filter(([r]) => f === 'all' || (f === 'bad' && r.errors.length) || (f === 'dup' && r.dup) || (f === 'sel' && r.include && !r.errors.length)); }
  function rowStatus(r) {
    const out = r.errors.map((m) => '<div class="st e">✖ ' + esc(m) + '</div>').concat(r.dup ? ['<div class="st w"><span class="badge dup">duplicate</span> ' + esc(r.dup) + '</div>'] : [], r.warns.map((m) => '<div class="st w">⚠ ' + esc(m) + '</div>'), r.notes.filter((n) => n.level !== 'error').map((n) => '<div class="st w">ℹ ' + esc(n.msg) + '</div>'));
    return out.length ? out.join('') : '<span class="st o">✔ OK</span>';
  }
  function drawImportRows() {
    const body = $('#impBody', IM.m.el), list = filteredRows();
    const replace = (($('input[name=impMode]:checked', IM.m.el) || {}).value) === 'replace';
    let seq = replace ? 0 : S.data.products.filter((p) => !G.isBlankRow(S.type, p)).length; IM.seq = IM.rows.map((r) => (r.include && !r.errors.length ? ++seq : null)); // the Item No. each row will get
    const pages = Math.max(1, Math.ceil(list.length / IM_PAGE)); IM.page = Math.min(IM.page, pages - 1);
    const slice = list.slice(IM.page * IM_PAGE, IM.page * IM_PAGE + IM_PAGE);
    $('#impRows', body).innerHTML = slice.map(([r, i]) => '<tr data-i="' + i + '" class="' + (r.errors.length ? 'bad' : '') + '"><td><input type="checkbox" data-inc="' + i + '"' + (r.include ? ' checked' : '') + (r.errors.length ? ' disabled' : '') + '></td><td>' + r.line + '</td>' + (IM.showNo ? '<td class="auto" title="Assigned automatically, in order">' + (IM.seq[i] || '—') + '</td>' : '') +
      IM.cols.map((c) => { const bad = r.errFields.includes(c.key), wn = r.warnFields.includes(c.key); return '<td data-key="' + c.key + '" class="' + (bad ? 'err' : wn ? 'warn' : '') + '"><input class="c" data-i="' + i + '" data-key="' + c.key + '" value="' + esc(r.row[c.key]) + '"></td>'; }).join('') + '<td class="stc" style="min-width:210px">' + rowStatus(r) + '</td></tr>').join('') || '<tr><td colspan="' + (IM.cols.length + 3) + '" class="muted" style="padding:14px">No rows to show for this filter.</td></tr>';
    $('#impPager', body).innerHTML = list.length + ' row(s) ' + (pages > 1 ? '· page ' + (IM.page + 1) + '/' + pages + ' <button class="btn small" id="ipPrev">‹</button> <button class="btn small" id="ipNext">›</button>' : '');
    const pv = $('#ipPrev', body), nx = $('#ipNext', body); if (pv) pv.onclick = () => { if (IM.page > 0) { IM.page--; drawImportRows(); } }; if (nx) nx.onclick = () => { if (IM.page < pages - 1) { IM.page++; drawImportRows(); } };
    let timer; $$('input.c', body).forEach((el) => (el.oninput = () => { const r = IM.rows[+el.dataset.i]; r.row[el.dataset.key] = el.value; clearTimeout(timer); timer = setTimeout(() => { const wasBad = r.errors.length; revalidateImport(false); if (wasBad && !r.errors.length) { r.include = !r.dup; if (IM.showNo) { drawImportRows(); updateImportSummary(); return; } } const tr = el.closest('tr'); tr.querySelector('.stc').innerHTML = rowStatus(r); tr.className = r.errors.length ? 'bad' : ''; const cb = tr.querySelector('[data-inc]'); cb.disabled = !!r.errors.length; cb.checked = r.include; updateImportSummary(); }, 200); }));
    $$('[data-inc]', body).forEach((el) => (el.onchange = () => { IM.rows[+el.dataset.inc].include = el.checked; drawImportRows(); updateImportSummary(); }));
  }
  function updateImportSummary() {
    const body = $('#impBody', IM.m.el), c = importCounts();
    $('#impSum', body).innerHTML = '<b>' + c.total + '</b> product row(s) found · <span class="o">' + c.valid + ' valid</span>' + (c.bad.length ? ' · <span class="e">' + c.bad.length + ' need correction (Excel rows ' + c.bad.slice(0, 20).map((r) => r.line).join(', ') + (c.bad.length > 20 ? '…' : '') + ')</span>' : '') + (c.dups.length ? ' · <span class="w">' + c.dups.length + ' duplicate(s)</span>' : '') + ' · <b>' + c.sel.length + ' selected to import</b>' + (IM.blank ? '<br><span class="muted">' + IM.blank + ' blank row(s) skipped.</span>' : '') +
      (Object.keys(IM.unmapped).length ? '<br><span class="w">⚠ Not imported (unmapped columns that contain data): ' + Object.keys(IM.unmapped).map((k) => colLetter(+k) + ' “' + esc(headerTexts()[k] || '') + '” (' + IM.unmapped[k] + ' rows)').join(', ') + '</span>' : '');
    const dupeFile = (S.data.importLog || []).find((x) => x.hash === IM.res.hash && x.sheet === IM.res.sheet), unsel = c.total - c.sel.length;
    $('#impAck', body).innerHTML = (c.bad.length ? '<label style="display:block;margin-top:8px;color:#c0182b"><input type="checkbox" id="impSkip"' + (IM.ack ? ' checked' : '') + '> I understand that Excel row(s) ' + c.bad.slice(0, 20).map((r) => r.line).join(', ') + (c.bad.length > 20 ? '…' : '') + ' will NOT be imported (they have errors).</label>' : '') +
      (dupeFile ? '<label style="display:block;margin-top:8px;color:#b26a00"><input type="checkbox" id="impAgain"' + (IM.again ? ' checked' : '') + '> This workbook sheet was already imported on ' + esc(new Date(dupeFile.at).toLocaleString()) + '. Import it again anyway.</label>' : '');
    const sk = $('#impSkip', body), ag = $('#impAgain', body), go = $('#impGo', body);
    const gate = () => { IM.ack = sk ? sk.checked : true; IM.again = ag ? ag.checked : true; go.disabled = !c.sel.length || !IM.ack || !IM.again; };
    if (sk) sk.onchange = gate; if (ag) ag.onchange = gate; gate();
    go.textContent = 'Import ' + c.sel.length + ' product' + (c.sel.length === 1 ? '' : 's');
  }

  function commitImport() {
    const R = IM.res, c = importCounts(), sel = c.sel, mode = ($('input[name=impMode]:checked', IM.m.el) || {}).value || 'add', d = S.data;
    const before = d.products.filter((p) => !G.isBlankRow(S.type, p));
    const keep = mode === 'add' ? before : [];
    d.products = keep.concat(sel.map((r) => r.row));
    if (!d.products.length) d.products = [G.emptyProduct(S.type)];
    const changed = [];
    if (S.type === 'price-increase') {
      const pr = [...new Set(sel.map((r) => r.row.principal).filter(Boolean))];
      if (pr.length === 1 && !String(d.principal).trim()) { d.principal = pr[0]; changed.push('Principal set to “' + pr[0] + '” (it was empty).'); }
      else if (pr.length > 1) changed.push('The rows contain ' + pr.length + ' different principals (' + pr.slice(0, 5).join(', ') + '); the document Principal field was left unchanged.');
      const ef = [...new Set(sel.map((r) => r.row.effectivity).filter(Boolean))];
      if (ef.length === 1 && !String(d.effectivity).trim()) { d.effectivity = ef[0]; changed.push('Document effectivity date set to “' + ef[0] + '” (it was empty).'); }
      else if (ef.length > 1) changed.push('The rows contain ' + ef.length + ' different effectivity dates; the document effectivity field was left unchanged.');
    }
    d.importLog = (d.importLog || []).concat([{ hash: R.hash, name: R.filename, sheet: R.sheet, at: new Date().toISOString(), imported: sel.length }]).slice(-50);
    const skipped = IM.rows.filter((r) => !sel.includes(r)).map((r) => ({ line: r.line, why: r.errors.length ? r.errors.join('; ') : r.dup ? r.dup + ' (not selected)' : 'not selected' }));
    const report = { file: R.filename, sheet: R.sheet, headerRow: IM.headerRow + 1, headerRows: IM.headerRows, detected: IM.rows.length, imported: sel.length, skipped, blank: IM.blank, mode, changed,
      mapping: Object.keys(IM.mapping).map((k) => ({ field: fl(IM.mapping[k]), col: colLetter(+k), head: headerTexts()[k] || '', hidden: R.hiddenCols.includes(+k) })), unmapped: Object.keys(IM.unmapped).map((k) => ({ col: colLetter(+k), head: headerTexts()[k] || '', rows: IM.unmapped[k] })),
      autoNo: S.type === 'price-list', fileNo: sel.filter((r) => String(r.row.itemNo || '').trim()).length,
      calc: sel.filter((r) => r.notes.some((n) => /calculated/.test(n.msg))).length, notes: sel.filter((r) => r.notes.some((n) => n.level === 'info' && !/calculated|hidden/.test(n.msg))).length };
    IM.m.close(); S.gridPage = 0; renderForm(); markDirty(); showImportReport(report);
  }
  function showImportReport(r) {
    const partial = r.skipped.length > 0;
    const m = modal('<h2 style="color:' + (partial ? '#b26a00' : '#1b7f3b') + '">' + (partial ? '⚠ Partly imported: ' + r.imported + ' of ' + r.detected + ' product rows' : '✔ Imported all ' + r.imported + ' product rows') + '</h2>' +
      '<dl class="report"><dt>Source file</dt><dd>' + esc(r.file) + '</dd><dt>Worksheet</dt><dd>' + esc(r.sheet || '(CSV file)') + '</dd><dt>Header row detected / chosen</dt><dd>Excel row ' + r.headerRow + (r.headerRows > 1 ? ' (spanning ' + r.headerRows + ' rows)' : '') + '</dd>' +
      '<dt>Product rows detected</dt><dd>' + r.detected + (r.blank ? ' (+ ' + r.blank + ' blank rows skipped)' : '') + '</dd><dt>Valid products imported</dt><dd>' + r.imported + ' (' + (r.mode === 'replace' ? 'replaced the previous rows' : 'added to existing rows') + ')</dd>' +
      '<dt>Skipped / invalid rows</dt><dd>' + (r.skipped.length ? '<ul>' + r.skipped.slice(0, 60).map((x) => '<li>Excel row ' + x.line + ': ' + esc(x.why) + '</li>').join('') + (r.skipped.length > 60 ? '<li>… and ' + (r.skipped.length - 60) + ' more</li>' : '') + '</ul>' : 'None') + '</dd>' +
      '<dt>Column mapping</dt><dd><ul>' + r.mapping.map((x) => '<li>' + esc(x.field) + ' ← column ' + x.col + ' “' + esc(x.head) + '”' + (x.hidden ? ' (hidden column)' : '') + '</li>').join('') + '</ul></dd>' +
      (r.unmapped.length ? '<dt>Not imported (unmapped columns with data)</dt><dd><ul>' + r.unmapped.map((x) => '<li>Column ' + x.col + ' “' + esc(x.head) + '” (' + x.rows + ' rows)</li>').join('') + '</ul></dd>' : '') +
      (r.autoNo ? '<dt>Item No.</dt><dd>Numbered automatically 1, 2, 3 … in the table' + (r.fileNo ? '; the ' + r.fileNo + ' Item No. value(s) in the file were not used.' : '.') + '</dd>' : '') +
      (r.calc ? '<dt>Calculated</dt><dd>' + r.calc + ' % Increase value(s) were calculated from prices because the workbook had none.</dd>' : '') + (r.notes ? '<dt>Exact-value notes</dt><dd>' + r.notes + ' row(s) used the exact stored Excel value instead of a rounded display value (see the Check column when reviewing).</dd>' : '') +
      (r.changed.length ? '<dt>Document fields updated</dt><dd><ul>' + r.changed.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></dd>' : '') + '</dl>' +
      '<p class="muted" style="font-size:12px">Nothing is saved yet — review the table and press Save Draft.</p><div class="foot"><button class="btn primary" id="rpClose">OK</button></div>');
    $('#rpClose', m.el).onclick = m.close;
  }

  // ------------------------------------------------------------ boot
  async function loadApp() {
    S.cfg = await (await api('/api/config')).json();
    S.user = S.cfg.auth.user;
    $$('.nav-btn').forEach((b) => (b.hidden = false));
    if (!S.user) return showLogin();
    if (!S.cfg.unlocked) { S.token = ''; sessionStorage.removeItem('gmpiToken'); }
    renderHome(); show('home');
  }
  (async function boot() {
    try { await loadApp(); }
    catch (e) { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:30px;color:#c0182b"><b>' + esc(e.message) + '</b></p>'); }
  })();
  window.__GMPI = { S, openNew, refreshPreview }; // for automated tests
})();
