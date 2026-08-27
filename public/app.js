'use strict';

// ---------- small helpers ----------
const $ = (id) => document.getElementById(id);
const state = {
  config: null,
  token: null,
  userId: null,      // numeric Orash user id used by lookups (createuser / userId)
  goods: [],         // cached goods list for line-item dropdowns
};

function setPill(el, text, kind) {
  el.textContent = text;
  el.className = 'pill ' + (kind || '');
}

/**
 * The login state is shown in two places: as a pill on the gate, and as the
 * sub-line of the profile button in the rail. Same text, different chrome.
 */
function setLoginState(text, kind) {
  const gate = $('gateState');
  if (gate) setPill(gate, text, kind);
  const sub = $('loginState');
  if (sub) {
    sub.textContent = text;
    sub.className = 'profile-sub ' + (kind || '');
  }
}

// ---------- busy affordances ----------

/** Shimmer placeholder on a control whose options are still being fetched. */
function skeleton(on, ...ids) {
  for (const id of ids) $(id)?.classList.toggle('loading', !!on);
}

/** Runs an async action with a spinner inside the button that started it. */
async function withSpinner(id, label, fn) {
  const btn = $(id);
  if (!btn) return fn();
  const html = btn.innerHTML;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${label}`;
  try {
    return await fn();
  } finally {
    btn.innerHTML = html;
    btn.disabled = wasDisabled;
  }
}

async function callProxy(name, { method = 'POST', query = null, body = null } = {}) {
  let url = '/proxy/' + name;
  let init = { method };
  if (method === 'GET') {
    const qs = new URLSearchParams(query || {});
    url += '?' + qs.toString();
  } else {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body || {});
  }
  const res = await fetch(url, init);
  const json = await res.json();
  return { httpStatus: res.status, ...json };
}

// Deployment configuration, not a form field: the server reads ORASH_BASE_URL
// from .env and hands it to the panel through /config. Nothing in the UI asks
// for it or shows it.
function baseUrl() { return state.config?.defaults?.baseUrl || ''; }
function uniqueID() { return $('database').value; }

/** Is the selected database the production one? */
function isProdDb() { return uniqueID() === state.config?.databases?.prod; }

/**
 * Prod is dangerous, not forbidden. The server decides — it refuses writes to
 * the production database unless ALLOW_PROD_WRITE=1, and reports which it is in
 * /config. The panel must read that same flag: gating the buttons on "is prod"
 * alone left the operator unable to submit even after the server had been told
 * to allow it, and the block looked like an upstream failure.
 */
function prodWriteBlocked() { return isProdDb() && !state.config?.allowProdWrite; }

// Extract an array of rows from the various Orash "content" shapes.
function rowsFrom(data) {
  if (!data) return [];
  const c = data.content;
  if (Array.isArray(c)) return c;
  if (c && Array.isArray(c.orashMisDatabases)) return c.orashMisDatabases;
  if (c && typeof c === 'object') return [c];
  return [];
}

// Fill a <select> with rows, picking value/label from candidate key lists.
function fillSelect(sel, rows, valueKeys, labelKeys, { keepFirst = true, placeholder } = {}) {
  const first = keepFirst ? sel.options[0] : null;
  sel.innerHTML = '';
  if (placeholder) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = placeholder; sel.appendChild(o);
  } else if (first) {
    sel.appendChild(first);
  }
  const pick = (row, keys) => {
    for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k];
    return undefined;
  };
  for (const row of rows) {
    const val = pick(row, valueKeys);
    let label = pick(row, labelKeys);
    const dep = row.departmentName || row.departmentCode;
    if (dep && labelKeys[0] !== 'departmentName') label = `${label} — ${dep}`;
    const o = document.createElement('option');
    o.value = val != null ? val : '';
    o.textContent = label != null ? `${label} (${val})` : String(val);
    o.dataset.row = JSON.stringify(row);
    sel.appendChild(o);
  }
  return rows.length;
}

// ---------- config + databases ----------
async function loadConfig() {
  const res = await fetch('/config');
  state.config = await res.json();
  if (state.config.mock) $('mockBadge').classList.remove('hidden');
}

function markDatabaseBadge() {
  const uid = uniqueID();
  const badge = $('dbBadge');
  const dbs = state.config?.databases || {};
  const opt = $('database').selectedOptions[0];
  const name = opt ? opt.textContent : '—';
  if (uid === dbs.prod) {
    // Still the loudest badge on the page — but an allowed prod write is a
    // warning, not a stop sign, so it drops the red and the alarm pulse.
    const blocked = prodWriteBlocked();
    badge.className = 'db-badge ' + (blocked ? 'prod' : 'prod-live');
    badge.textContent = blocked
      ? 'پایگاه داده: تولید (Production) ⛔'
      : 'پایگاه داده: تولید (Production) ⚠ ثبت واقعی';
    $('prodWarn').classList.toggle('hidden', !blocked);
  } else if (uid === dbs.test) {
    badge.className = 'db-badge test';
    badge.textContent = 'پایگاه داده: تست ✓';
    $('prodWarn').classList.add('hidden');
  } else if (uid) {
    badge.className = 'db-badge unknown';
    badge.textContent = 'پایگاه داده: ' + name;
    $('prodWarn').classList.add('hidden');
  } else {
    badge.className = 'db-badge unknown';
    badge.textContent = 'پایگاه داده: —';
    $('prodWarn').classList.add('hidden');
  }
  refreshSubmitEnabled();
}

async function loadDatabases() {
  setLoginState('در حال خواندن پایگاه داده‌ها…', 'busy');
  skeleton(true, 'database', 'username');
  const r = await callProxy('databases', { method: 'GET', query: { baseUrl: baseUrl() } });
  skeleton(false, 'database');
  if (!r.ok) {
    // Nothing can be selected, let alone logged into, while the service is
    // unreachable — so say so on the gate instead of leaving empty dropdowns.
    skeleton(false, 'username');
    setLoginState('سامانه در دسترس نیست', 'bad');
    showRaw(r);
    $('database').innerHTML = '<option value="">— در دسترس نیست —</option>';
    $('username').innerHTML = '<option value="">— در دسترس نیست —</option>';
    $('btnLogin').disabled = true;
    reportUnreachable(r);
    markDatabaseBadge();
    return;
  }
  $('btnLogin').disabled = false;
  $('loginStatus').classList.add('hidden');
  const rows = rowsFrom(r.data);
  const sel = $('database');
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = '— انتخاب کنید —'; sel.appendChild(ph);
  const dbs = state.config?.databases || {};
  for (const row of rows) {
    const o = document.createElement('option');
    o.value = row.uniqueID;
    let tag = '';
    if (row.uniqueID === dbs.test) tag = ' [تست]';
    else if (row.uniqueID === dbs.prod) tag = ' [تولید]';
    o.textContent = `${row.companyName || row.name}${tag}`;
    sel.appendChild(o);
    if (row.uniqueID === dbs.test) o.selected = true; // default to test DB
  }
  setLoginState('وارد نشده', '');
  markDatabaseBadge();
  await loadUsers();
}

async function loadUsers() {
  const uid = uniqueID();
  const sel = $('username');
  if (!uid) {
    skeleton(false, 'username');
    sel.innerHTML = '<option value="">— ابتدا پایگاه داده را انتخاب کنید —</option>';
    return;
  }
  skeleton(true, 'username');
  const r = await callProxy('users', { method: 'GET', query: { baseUrl: baseUrl(), uniqueID: uid } });
  skeleton(false, 'username');
  const rows = rowsFrom(r.data);
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = ''; ph.textContent = rows.length ? '— انتخاب کنید —' : '— کاربری یافت نشد —';
  sel.appendChild(ph);
  for (const row of rows) {
    const o = document.createElement('option');
    o.value = row.userName;
    o.textContent = `${row.fullName || row.userName} (id: ${row.id})`;
    o.dataset.id = row.id;
    sel.appendChild(o);
  }
  if (rows.length === 1) sel.selectedIndex = 1;
}

// ---------- login gate ----------

const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * The proxy answers 502 with the real cause (ECONNREFUSED, EHOSTUNREACH, a
 * timeout) when it cannot reach the Orash host — Node itself only says "fetch
 * failed", so this is the only place the operator can learn what is wrong.
 */
function reportUnreachable(r) {
  const reason = r.error || (r.httpStatus ? 'HTTP ' + r.httpStatus : 'دلیل نامشخص');
  showStatus('loginStatus', 'bad', 'سامانه اوراش در دسترس نیست',
    `<p>${escHtml(reason)}</p>`
    + '<ul>'
    + `<li>آدرس سرویس را بررسی کنید: <span class="mono" dir="ltr">${escHtml(baseUrl())}</span></li>`
    + '<li>مطمئن شوید سرور اوراش روشن و روی شبکه در دسترس است.</li>'
    + '<li>سپس «بارگذاری مجدد پایگاه داده‌ها» را بزنید.</li>'
    + '</ul>');
}

/** True when the proxy could not reach Orash at all (as opposed to a rejection). */
const isUnreachable = (r) => !r.ok && r.httpStatus === 502;

/**
 * The gate and the dashboard are two views of one page: the dashboard's own
 * elements (the rail pill, the database badge, the scanner cards) already exist
 * while the gate is up, so entering is just a swap — no state to rebuild.
 */
function enterApp(displayName) {
  $('loginView').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  window.scrollTo(0, 0);

  const dbOpt = $('database').selectedOptions[0];
  const name = displayName || $('username').value || '—';
  $('s_database').textContent = dbOpt ? dbOpt.textContent : '—';
  $('s_user').textContent = name;
  $('profileName').textContent = name;
  $('s_write').textContent = prodWriteBlocked()
    ? 'ثبت روی پایگاه تولید مسدود است'
    : (isProdDb() ? 'ثبت مجاز است — روی پایگاه تولید' : 'ثبت مجاز است');
  setPill($('sessionState'), 'متصل ✓', 'good');

  // Scanners are only attached once there is a session to submit into.
  if (document.body.dataset.entered !== '1') {
    document.body.dataset.entered = '1';
    document.dispatchEvent(new CustomEvent('orash:entered'));
  }
}

/** Back to the gate. The token is dropped, so nothing can be submitted again. */
function logout() {
  state.token = null;
  state.userId = null;
  $('password').value = '';
  $('loginStatus').classList.add('hidden');
  $('appShell').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  setPill($('sessionState'), 'خارج شد', 'bad');
  $('profileName').textContent = 'وارد نشده';
  setLoginState('وارد نشده', '');
  $('btnLoadLookups').disabled = true;
  refreshSubmitEnabled();
}

async function login() {
  const uid = uniqueID();
  const gate = (kind, title, detail) => showStatus('loginStatus', kind, title, detail);
  if (!uid) { gate('bad', 'پایگاه داده انتخاب نشده', '<p>یک پایگاه داده را از فهرست انتخاب کنید.</p>'); return; }
  const userOpt = $('username').selectedOptions[0];
  const username = $('username').value;
  const password = $('password').value;
  if (!username) { gate('bad', 'نام کاربری انتخاب نشده', '<p>کاربر مورد نظر را از فهرست انتخاب کنید.</p>'); return; }

  gate('busy', 'در حال ورود…', '');
  setLoginState('در حال ورود…', 'busy');
  const r = await withSpinner('btnLogin', 'در حال ورود…', () => callProxy('auth', {
    method: 'POST',
    body: { baseUrl: baseUrl(), body: { username, password, uniqueID: uid } },
  }));
  showRaw(r);
  const content = r.data?.content;
  if (r.ok && content?.token) {
    state.token = content.token;
    state.userId = userOpt?.dataset.id ? Number(userOpt.dataset.id) : null;
    setLoginState('ورود موفق ✓ (' + (content.name || username) + ')', 'good');
    $('btnLoadLookups').disabled = false;
    setPill($('lookupState'), 'آماده بارگذاری', '');
    console.log('[login] success', { username, uniqueID: uid, name: content.name, userId: state.userId });
    $('loginStatus').classList.add('hidden');
    enterApp(content.name || username);
    refreshSubmitEnabled();          // unblock the forms before the slow part
    await loadLookups();
  } else {
    state.token = null;
    // On failure the useful reason is in content (a string), while message is just "fail".
    const reason = (typeof content === 'string' && content)
      ? content
      : (r.data?.message || r.error || ('HTTP ' + r.httpStatus));
    if (isUnreachable(r)) {
      setLoginState('سامانه در دسترس نیست', 'bad');
      reportUnreachable(r);
    } else {
      setLoginState('ورود ناموفق', 'bad');
      gate('bad', 'ورود ناموفق ✗', `<p>${escHtml(reason)}</p>`);
    }
    // Log the failure for debugging (never log the password).
    console.error('[login] failed', {
      username,
      uniqueID: uid,
      reason,
      proxyOk: r.ok,
      httpStatus: r.httpStatus,
      upstreamStatus: r.upstreamStatus,
      responseCode: r.data?.responseCode,
      hasError: r.data?.hasError,
      message: r.data?.message,
      content: r.data?.content,
      proxyError: r.error,
    });
  }
  refreshSubmitEnabled();
}

// ---------- lookups (service-provided data) ----------
async function lookup(name, extraData = {}) {
  const body = { baseUrl: baseUrl(), token: state.token,
    body: { uniqueID: uniqueID(), data: { userId: state.userId, ...extraData } } };
  return callProxy(name, { method: 'POST', body });
}

async function loadLookups() {
  if (!state.token) { alert('ابتدا وارد شوید.'); return; }
  setPill($('lookupState'), 'در حال بارگذاری…', 'busy');
  skeleton(true, 'departmentCode', 'hsc', 't2', 'pc', 'createuser');
  try {
    // createuser is the logged-in user
    fillSelect($('createuser'), state.userId != null ? [{ id: state.userId, name: $('username').value }] : [],
      ['id'], ['name'], { placeholder: '—' });
    if (state.userId != null) $('createuser').selectedIndex = 1;

    const [dep, sto, taf] = await Promise.all([
      lookup('departments'),
      lookup('storages'),
      lookup('tafsili'),
    ]);
    fillSelect($('departmentCode'), rowsFrom(dep.data), ['departmentCode'], ['departmentName'], { placeholder: '— انتخاب —' });
    fillSelect($('hsc'), rowsFrom(sto.data), ['storageCode'], ['storageName'], { placeholder: '— انتخاب —' });
    fillSelect($('t2'), rowsFrom(taf.data), ['tafsiliCode'], ['tafsiliName'], { placeholder: '— بدون تفصیلی —' });

    // Accounts (sender) — GetCustomer needs branch flags + current user
    const cus = await lookup('customers', {
      flagDepartment: false, fromDepartment: 0, toDepartment: 0, currentUserId: state.userId,
    });
    fillSelect($('pc'), rowsFrom(cus.data), ['code'], ['name'], { placeholder: '— انتخاب حساب —' });

    // Goods — cache for line-item dropdowns
    const goods = await lookup('goods', {
      // Types the live service actually enforces — not the PDF's: showStockFlg
      // binds to Int64 and rejects a boolean outright (HTTP 400). See
      // docs/orash-web-service-api.md §5.2.
      showStockFlg: 0, flagDepartment: true, fromDepartment: 0, toDepartment: 0,
      currentUserId: state.userId, withFi: false,
    });
    state.goods = goodsRowsFrom(goods.data);

    // (re)build any existing line rows so their goods dropdown fills
    document.querySelectorAll('#linesBody tr').forEach(fillGoodsSelectInRow);
    if (!$('linesBody').children.length) addLine();

    const counts = `شعبه:${rowsFrom(dep.data).length} انبار:${rowsFrom(sto.data).length} حساب:${rowsFrom(cus.data).length} تفصیلی:${rowsFrom(taf.data).length} کالا:${state.goods.length}`;
    setPill($('lookupState'), 'بارگذاری شد ✓ (' + counts + ')', 'good');
    showRaw({ note: 'lookups loaded', departments: dep.data, storages: sto.data, tafsili: taf.data, customers: cus.data, goods: goods.data });
  } catch (e) {
    setPill($('lookupState'), 'خطا: ' + e.message, 'bad');
  } finally {
    skeleton(false, 'departmentCode', 'hsc', 't2', 'pc', 'createuser');
  }
  refreshSubmitEnabled();
}

// ---------- line items ----------
function storageOptionsHtml() {
  let html = '<option value="">— انبار ردیف —</option>';
  for (const o of $('hsc').options) {
    if (!o.value) continue;
    html += `<option value="${o.value}">${o.textContent}</option>`;
  }
  return html;
}

function fillGoodsSelectInRow(tr) {
  const sel = tr.querySelector('.gs');
  const current = sel.value;
  sel.innerHTML = '<option value="">— انتخاب کالا —</option>';
  for (const g of state.goods) {
    const code = g.code ?? g.goodCode ?? g.Code;
    const name = g.name ?? g.goodName ?? g.Name ?? code;
    const o = document.createElement('option');
    o.value = code;
    o.textContent = `${name} (${code})`;
    o.dataset.row = JSON.stringify(g);
    sel.appendChild(o);
  }
  if (current) sel.value = current;
}

function addLine() {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><select class="gs"><option value="">— ابتدا داده‌ها را بارگذاری کنید —</option></select></td>
    <td><input class="gc" type="number" min="0" step="any" placeholder="تعداد" /></td>
    <td><input class="fp" type="number" min="0" step="any" placeholder="نرخ" /></td>
    <td><select class="itms">${storageOptionsHtml()}</select></td>
    <td><input class="ide" type="text" placeholder="اختیاری" /></td>
    <td><button class="del ghost" title="حذف">✕</button></td>`;
  tr.querySelector('.del').addEventListener('click', () => tr.remove());
  // default row storage to header storage
  const itms = tr.querySelector('.itms');
  if ($('hsc').value) itms.value = $('hsc').value;
  $('linesBody').appendChild(tr);
  if (state.goods.length) fillGoodsSelectInRow(tr);
}

// ---------- build payload ----------
function buildPayload() {
  const hid = 'h' + Date.now();
  const lines = [];
  document.querySelectorAll('#linesBody tr').forEach((tr, i) => {
    const gs = tr.querySelector('.gs').value;
    const gc = tr.querySelector('.gc').value;
    const fp = tr.querySelector('.fp').value;
    if (!gs && !gc && !fp) return; // skip empty rows
    lines.push({
      hid,
      iid: String(i + 1),
      gs: String(gs),
      gc: String(gc),
      fp: String(fp),
      ide: tr.querySelector('.ide').value || '',
      itms: String(tr.querySelector('.itms').value || $('hsc').value || ''),
    });
  });

  const header = {
    hid,
    pc: $('pc').value,
    hde: $('hde').value || '',
    ft: $('ft').value,
    hsc: $('hsc').value,
    fd: lines,
  };
  const t2 = $('t2').value;
  if (t2) header.t2 = t2;

  const data = {
    createuser: state.userId,
    createdate: $('createdate').value.trim(),
    createtime: $('createtime').value.trim(),
    departmentCode: Number($('departmentCode').value) || 0,
    value: [header],
  };
  if ($('visitorId').value) data.visitorId = Number($('visitorId').value);
  if ($('factNo').value) data.factNo = $('factNo').value.trim();

  return { uniqueID: uniqueID(), data };
}

function validate(payload) {
  const errs = [];
  const d = payload.data;
  if (!payload.uniqueID) errs.push('پایگاه داده انتخاب نشده');
  if (d.createuser == null) errs.push('کاربر ایجادکننده مشخص نیست (ورود کنید)');
  if (!d.createdate) errs.push('تاریخ سند خالی است');
  if (!d.createtime) errs.push('ساعت سند خالی است');
  if (!d.departmentCode) errs.push('شعبه انتخاب نشده');
  const h = d.value[0];
  if (!h.pc) errs.push('حساب فرستنده (pc) انتخاب نشده');
  if (!h.hsc) errs.push('انبار سربرگ (hsc) انتخاب نشده');
  if (h.ft === '' || h.ft == null) errs.push('نوع فاکتور مشخص نیست');
  if (!h.fd.length) errs.push('حداقل یک ردیف کالا لازم است');
  h.fd.forEach((l, i) => {
    if (!l.gs) errs.push(`ردیف ${i + 1}: کالا انتخاب نشده`);
    if (!l.gc) errs.push(`ردیف ${i + 1}: تعداد خالی است`);
    if (!l.itms) errs.push(`ردیف ${i + 1}: انبار خالی است`);
  });
  return errs;
}

// ---------- submit + status ----------
function refreshSubmitEnabled() {
  const noWrite = prodWriteBlocked();
  const blocked = !state.token || noWrite;
  const title = noWrite ? 'ثبت روی پایگاه تولید مسدود است' : (!state.token ? 'ابتدا وارد شوید' : '');
  for (const id of ['btnSubmit', 'btnSubmitGood']) {
    const b = $(id);
    if (!b) continue;
    b.disabled = blocked;
    b.title = title;
  }
  for (const id of ['btnLoadGoodsRef', 'btnLoadCodeRef']) {
    const ref = $(id);
    if (ref) ref.disabled = !state.token;
  }
  // The scanner panel mirrors the same login/database gate (scan-ui.js).
  if (typeof onPanelStateChanged === 'function') onPanelStateChanged();
}

// Generic status renderer. First arg is the target element id.
function showStatus(elId, kind, title, detailHtml) {
  const el = $(elId);
  el.className = 'status ' + kind;
  el.classList.remove('hidden');
  el.innerHTML = `<strong>${title}</strong>${detailHtml || ''}`;
}

function showRaw(obj) { $('rawResponse').textContent = JSON.stringify(obj, null, 2); }

// Parse the shared Orash response envelope into a normalized result.
function interpret(r) {
  const data = r.data || {};
  const items = Array.isArray(data.content) ? data.content : [];
  const item = items[0] || {};
  const httpLine = `HTTP ${r.upstreamStatus} · responseCode ${data.responseCode} · hasError ${data.hasError}`;
  // Business errors live in content[].errorCode (0 = ok). CreateRecPay uses 1 for errors,
  // everything else uses -1, so treat any non-zero as failure.
  const failed = data.hasError === true
    || (item.errorCode !== undefined && Number(item.errorCode) !== 0);
  const httpOk = r.upstreamStatus >= 200 && r.upstreamStatus < 300;
  return { data, items, item, httpLine, ok: !failed && httpOk };
}

async function submit() {
  const payload = buildPayload();
  const errs = validate(payload);
  if (errs.length) {
    showStatus('statusArea', 'bad', 'اعتبارسنجی ناموفق', '<ul><li>' + errs.join('</li><li>') + '</li></ul>');
    return;
  }
  showStatus('statusArea', 'busy', 'در حال ارسال…', '');
  const r = await withSpinner('btnSubmit', 'در حال ارسال…', () => callProxy('createInvoice', {
    method: 'POST',
    body: { baseUrl: baseUrl(), token: state.token, uniqueID: payload.uniqueID, body: payload },
  }));
  showRaw(r);

  if (r.httpStatus === 403) { showStatus('statusArea', 'bad', 'مسدود شد', `<p>${r.error}</p>`); return; }
  if (!r.ok) { showStatus('statusArea', 'bad', 'خطای شبکه/پروکسی', `<p>${r.error || ''}</p>`); return; }

  const res = interpret(r);
  if (res.ok) {
    showStatus('statusArea', 'good', 'موفق ✓ — فاکتور ثبت شد',
      `<p>کد/شماره: <b>${res.item.content ?? '—'}</b></p><p>${res.item.errorMessage || res.data.message || ''}</p><p class="mono">${res.httpLine}</p>`);
  } else {
    const msgs = res.items.length
      ? '<ul><li>' + res.items.map((it) => `[${it.errorCode}] ${it.errorMessage}`).join('</li><li>') + '</li></ul>'
      : `<p>${res.data.message || 'خطای نامشخص'}</p>`;
    showStatus('statusArea', 'bad', 'ناموفق ✗', msgs + `<p class="mono">${res.httpLine}</p>`);
  }
}

// ---------- CreateGood ----------
const gVal = (id) => $(id).value.trim();
const gNum = (id) => (gVal(id) === '' ? undefined : Number(gVal(id)));

/**
 * Codes that are fixed for every good this panel registers, and are not the
 * operator's to change — the form only shows them. They must stay in step with
 * FIXED in lib/label-qr.js and the LQ_* constants in excel/LabelQR.bas, which
 * put the same numbers on a printed label.
 *
 * `secondGroupCodeRef` is deliberately not here: it is still chosen per good.
 */
const LOCKED_GOOD_FIELDS = {
  unitIdRef: { value: 5, label: 'متر' },
  unitPackingCodeRef: { value: 1, label: 'کلاف' },
  mainGroupCodeRef: { value: 1, label: 'نوع محصول' },
};

/**
 * Re-derive the sub-group from whatever the code field holds now, and show it.
 *
 * When the goods code names exactly one family the field is read-only, like the
 * other reference codes. When its Excel code is shared by two families the
 * operator has to pick, so a select appears listing only those candidates.
 */
function refreshSecondGroup() {
  const view = $('g_secondGroupCodeRef_view');
  const pick = $('g_secondGroupCodeRef_pick');
  const hidden = $('g_secondGroupCodeRef');
  const code = gVal('g_code');
  if (!code) {
    pick.classList.add('hidden');
    hidden.value = '';
    view.textContent = '— کد کالا را وارد کنید —';
    view.classList.remove('bad');
    return;
  }
  const sub = SecondGroup.resolve(code);
  if (sub.status === 'ambiguous') {
    view.textContent = `کد اکسل «${sub.excel}» مشترک است — یکی را انتخاب کنید:`;
    view.classList.remove('bad');
    pick.classList.remove('hidden');
    // Rebuild only when the candidates changed, so a choice survives retyping.
    const want = sub.matches.map((m) => m.orash).join(',');
    if (pick.dataset.candidates !== want) {
      pick.dataset.candidates = want;
      pick.innerHTML = '';
      for (const m of sub.matches) {
        const o = document.createElement('option');
        o.value = String(m.orash);
        o.textContent = `${m.name} — ${m.orash}`;
        pick.appendChild(o);
      }
      pick.value = String(sub.matches[0].orash);   // never leave it unset
    }
    hidden.value = pick.value;
    return;
  }
  pick.classList.add('hidden');
  pick.dataset.candidates = '';
  if (sub.status === 'ok') {
    hidden.value = String(sub.code);
    view.textContent = `${sub.code} — ${sub.matches[0].name}`;
    view.classList.remove('bad');
  } else {
    hidden.value = '';
    view.textContent = sub.message;
    view.classList.add('bad');
  }
}

// ---------- settings: the sub-group table ----------

/**
 * The editable copy of the sub-group table.
 *
 * It is edited as plain rows and only becomes the table in force once the
 * server has accepted it — validation lives in second-group.js so the browser
 * and the server agree on what a legal table is.
 */
const sgEdit = { rows: [], savedAt: null, source: 'default' };

function sgSetStatus(text, kind) {
  const box = $('sgStatus');
  box.className = 'status' + (kind ? ' ' + kind : '');
  box.textContent = text;
  box.classList.toggle('hidden', !text);
}

function renderSettingsTable() {
  const body = document.querySelector('#sgTable tbody');
  if (!body) return;
  body.innerHTML = '';
  sgEdit.rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    const cell = (child) => { const td = document.createElement('td'); td.appendChild(child); tr.appendChild(td); return td; };

    const name = document.createElement('input');
    name.type = 'text'; name.value = row.name || ''; name.placeholder = 'نام محصول';
    name.addEventListener('input', () => { sgEdit.rows[i].name = name.value; });
    cell(name);

    const excel = document.createElement('input');
    excel.type = 'text'; excel.inputMode = 'numeric'; excel.maxLength = 2;
    excel.value = row.excel == null ? '' : row.excel; excel.placeholder = '—';
    excel.addEventListener('input', () => { sgEdit.rows[i].excel = excel.value; });
    cell(excel).className = 'narrow';

    const orash = document.createElement('input');
    orash.type = 'number'; orash.min = '1';
    orash.value = row.orash == null ? '' : row.orash;
    orash.addEventListener('input', () => { sgEdit.rows[i].orash = orash.value; });
    cell(orash).className = 'narrow';

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'ghost danger'; del.textContent = 'حذف';
    del.title = 'حذف این ردیف';
    del.addEventListener('click', () => { sgEdit.rows.splice(i, 1); renderSettingsTable(); });
    cell(del).className = 'narrow';

    body.appendChild(tr);
  });
  setPill($('sgState'), `${sgEdit.rows.length} ردیف` + (sgEdit.source === 'file' ? ' — ذخیره‌شده' : ' — جدول اولیه'), 'ok');
}

/** Take the server's table as the one in force, and show it. */
function sgAdopt(payload) {
  sgEdit.rows = payload.groups.map((g) => ({ ...g }));
  sgEdit.savedAt = payload.savedAt || null;
  sgEdit.source = payload.source || 'default';
  SecondGroup.setGroups(payload.groups);
  renderSettingsTable();
  renderSubGroupTable();
  refreshSecondGroup();
}

async function loadSettingsTable(quiet) {
  try {
    const res = await fetch('/settings/second-groups');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'خطای نامشخص');
    sgAdopt(json);
    if (!quiet) sgSetStatus('جدول از سرور خوانده شد.', 'ok');
  } catch (err) {
    sgSetStatus('خواندن جدول از سرور ناموفق بود: ' + (err.message || err), 'bad');
  }
}

async function saveSettingsTable() {
  // Check here first so every problem is listed at once, rather than the one
  // the server happens to hit first.
  const { errors } = SecondGroup.validate(sgEdit.rows);
  if (errors.length) { sgSetStatus(errors.join('\n'), 'bad'); return; }
  sgSetStatus('در حال ذخیره…', 'busy');
  try {
    const res = await fetch('/settings/second-groups', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups: sgEdit.rows }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'خطای نامشخص');
    sgAdopt(json);
    sgSetStatus(`ذخیره شد — ${json.groups.length} ردیف. لیبل‌های بعدی از همین جدول استفاده می‌کنند.`, 'ok');
  } catch (err) {
    sgSetStatus('ذخیره ناموفق بود: ' + (err.message || err), 'bad');
  }
}

/** The sub-group table, so the operator can see where a number came from. */
function renderSubGroupTable() {
  const body = document.querySelector('#subGroupTable tbody');
  if (!body) return;
  const shared = new Set();
  const byExcel = {};
  for (const g of SecondGroup.GROUPS) {
    if (!g.excel) continue;
    if (byExcel[g.excel]) shared.add(g.excel);
    byExcel[g.excel] = true;
  }
  body.innerHTML = '';
  for (const g of SecondGroup.GROUPS) {
    const tr = document.createElement('tr');
    if (g.excel && shared.has(g.excel)) tr.className = 'shared-excel';
    for (const text of [g.name, g.excel || '—', String(g.orash)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

/** Force the locked codes onto a record, whatever a scanned QR claimed. */
function applyLockedGoodFields(data) {
  for (const [field, { value }] of Object.entries(LOCKED_GOOD_FIELDS)) data[field] = value;
  // The sub-group follows the goods code, not the QR: a label printed before
  // the mapping existed carries no sub-group at all, and one printed with a
  // stale mapping carries the wrong one.
  const sub = SecondGroup.resolve(data.code || '');
  if (sub.status === 'ok') data.secondGroupCodeRef = sub.code;
  else delete data.secondGroupCodeRef;
  return data;
}

/** Paint the locked codes into their read-only slots. */
function showLockedGoodFields() {
  for (const [field, { value, label }] of Object.entries(LOCKED_GOOD_FIELDS)) {
    const el = $('g_' + field);
    if (el) el.textContent = `${value} — ${label}`;
  }
}

// Only the required fields for CreateGood on this deployment.
function buildGoodPayload() {
  const data = {
    code: gVal('g_code'),
    name: gVal('g_name'),
    type: Number($('g_type').value),
    serial: gVal('g_serial'),
    unitIdRef: LOCKED_GOOD_FIELDS.unitIdRef.value,
    unitPackingCodeRef: LOCKED_GOOD_FIELDS.unitPackingCodeRef.value,
    mainGroupCodeRef: LOCKED_GOOD_FIELDS.mainGroupCodeRef.value,
    secondGroupCodeRef: gNum('g_secondGroupCodeRef'),   // set by refreshSecondGroup()
    isActive: true,
  };
  return { uniqueID: uniqueID(), data };
}

const SERIAL_RE = /^\d+(-[A-Za-z]+)?$/; // "123" or "123-a"

function validateGood(payload) {
  const errs = [];
  const d = payload.data;
  if (!payload.uniqueID) errs.push('پایگاه داده انتخاب نشده');
  if (!state.token) errs.push('ابتدا وارد شوید (توکن لازم است)');
  if (!d.code) errs.push('کد کالا الزامی است');
  else if (!/^\d+$/.test(d.code)) errs.push('کد کالا باید فقط عدد باشد');
  if (!d.name) errs.push('عنوان کالا الزامی است');
  if (!d.type) errs.push('نوع مشخص نیست');
  if (!d.serial) errs.push('سریال کالا الزامی است');
  else if (!SERIAL_RE.test(d.serial)) errs.push('سریال باید عدد یا به شکل «عدد-حرف» باشد (مثل 123-a)');
  if (d.unitIdRef === undefined) errs.push('کد واحد شمارش (unitIdRef) الزامی است');
  if (d.unitPackingCodeRef === undefined) errs.push('کد نوع بسته‌بندی (unitPackingCodeRef) الزامی است');
  if (d.mainGroupCodeRef === undefined) errs.push('کد گروه اصلی الزامی است');
  if (d.secondGroupCodeRef === undefined) {
    errs.push('گروه فرعی از کد کالا به دست نیامد: ' + SecondGroup.resolve(d.code || '').message);
  }
  return errs;
}

/**
 * Send one CreateGood request and normalize the outcome.
 * Shared by the manual form and by every scanned code, so both paths report
 * success and failure identically.
 * @param {object} data  the CreateGood `data` object
 * @returns {Promise<{ok:boolean, code:?string, message:string, httpLine:string, blocked?:boolean}>}
 */
async function postGood(data) {
  const r = await callProxy('createGood', {
    method: 'POST',
    body: { baseUrl: baseUrl(), token: state.token, uniqueID: uniqueID(), body: { uniqueID: uniqueID(), data } },
  });
  showRaw(r);

  if (r.httpStatus === 403) return { ok: false, code: null, message: r.error, httpLine: '', blocked: true };
  if (!r.ok) return { ok: false, code: null, message: r.error || 'خطای شبکه/پروکسی', httpLine: '' };

  const res = interpret(r);
  const message = res.items.length
    ? res.items.map((it) => it.errorMessage).filter(Boolean).join(' / ')
    : (res.data.message || '');
  return {
    ok: res.ok,
    code: res.ok ? (res.item.content ?? null) : null,
    message,
    httpLine: res.httpLine,
    items: res.items,
  };
}

async function submitGood() {
  const payload = buildGoodPayload();
  const errs = validateGood(payload);
  if (errs.length) {
    showStatus('goodStatus', 'bad', 'اعتبارسنجی ناموفق', '<ul><li>' + errs.join('</li><li>') + '</li></ul>');
    return;
  }
  showStatus('goodStatus', 'busy', 'در حال ارسال…', '');
  const res = await withSpinner('btnSubmitGood', 'در حال ارسال…', () => postGood(payload.data));

  if (res.blocked) { showStatus('goodStatus', 'bad', 'مسدود شد', `<p>${res.message}</p>`); return; }
  if (res.ok) {
    showStatus('goodStatus', 'good', 'موفق ✓ — کالا ثبت شد',
      `<p>کد کالا: <b>${res.code ?? '—'}</b></p><p>${res.message}</p><p class="mono">${res.httpLine}</p>`);
  } else {
    showStatus('goodStatus', 'bad', 'ناموفق ✗',
      `<p>${res.message || 'خطای نامشخص'}</p><p class="mono">${res.httpLine}</p>`);
  }
}

// Form <-> plain data object, so a scan can prefill the form and the form can
// supply defaults for fields a QR code omits.
// The locked codes are absent on purpose: a scanned QR must not be able to
// change them either, so nothing ever writes them back into the form.
const GOOD_FIELD_INPUTS = {
  code: 'g_code', name: 'g_name', serial: 'g_serial',
  secondGroupCodeRef: 'g_secondGroupCodeRef',
};

/** Everything the form currently holds, used as defaults under a scan. */
function goodFormDefaults() {
  const d = buildGoodPayload().data;
  for (const k of Object.keys(d)) if (d[k] === undefined || d[k] === '') delete d[k];
  return d;
}

/** Write a (possibly partial) CreateGood object back into the form. */
function applyGoodToForm(data) {
  for (const [field, id] of Object.entries(GOOD_FIELD_INPUTS)) {
    if (data[field] !== undefined && data[field] !== '') $(id).value = data[field];
  }
  if (data.type === 1 || data.type === 2) $('g_type').value = String(data.type);
  refreshSecondGroup();
}

async function loadGoodsReference() {
  if (!state.token) { alert('ابتدا وارد شوید.'); return; }
  $('goodsRefWrap').classList.remove('hidden');
  $('goodsRefWrap').open = true;
  $('goodsRefJson').textContent = 'در حال بارگذاری…';
  const goods = await lookup('goods', {
    showStockFlg: 0, flagDepartment: true, fromDepartment: 0, toDepartment: 0,
    currentUserId: state.userId, withFi: false,
  });
  state.goods = rowsFrom(goods.data);
  $('goodsRefJson').textContent = JSON.stringify(goods.data, null, 2);
}

/**
 * The reference codes CreateGood demands — unit, packing, main and second
 * group — have no lookup endpoint of their own (see docs/orash-web-service-api.md
 * §5.1). The only place they surface is on goods that already exist, so this
 * reads GetGoods once and collects every distinct value it saw for each of the
 * four, keeping any *Code/*Id sibling the response happens to carry next to the
 * name — that pairing is the only way to learn which number means "قرقره".
 */
/** Reference values worth listing even where the panel no longer offers a choice. */
const CODE_REF_REPORT_ONLY = [
  { title: 'گروه فرعی (secondGroupCodeRef) — از کد کالا',
    nameKeys: ['secondGroupName'], codeKeys: ['secondGroupCodeRef', 'secondGroupCode'] },
  { title: 'واحد شمارش (unitIdRef) — قفل‌شده',
    nameKeys: ['unitsName', 'unitName'], codeKeys: ['unitIdRef', 'unitId', 'unitCode'] },
  { title: 'نوع بسته‌بندی (unitPackingCodeRef) — قفل‌شده',
    nameKeys: ['unitPackingName'], codeKeys: ['unitPackingCodeRef', 'unitPackingCode'] },
  { title: 'گروه اصلی (mainGroupCodeRef) — قفل‌شده',
    nameKeys: ['mainGroupName'], codeKeys: ['mainGroupCodeRef', 'mainGroupCode'] },
];

/**
 * The rows inside a GetGoods answer. `rowsFrom` handles the shapes the other
 * lookups use, but this endpoint's response schema is undocumented (the PDF
 * gives request bodies only), so a wrapper object around the real array would
 * come back as a single meaningless "row" and every dropdown would end up
 * empty. Go one level deeper and take the longest array of objects we find.
 */
function goodsRowsFrom(data) {
  const rows = rowsFrom(data);
  if (rows.length !== 1 || Array.isArray(rows[0])) return rows;
  const only = rows[0];
  if (!only || typeof only !== 'object') return rows;
  let best = null;
  for (const v of Object.values(only)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object'
        && (!best || v.length > best.length)) best = v;
  }
  return best || rows;
}

/** Distinct {name, codes} pairs one field showed across the goods that came back. */
function collectRefValues(rows, field) {
  const seen = new Map();   // name -> Set of codes seen with it
  for (const row of rows) {
    const nameKey = field.nameKeys.find((k) => row[k] !== undefined && row[k] !== null && row[k] !== '');
    const codeKey = field.codeKeys.find((k) => row[k] !== undefined && row[k] !== null && row[k] !== '');
    const name = nameKey ? String(row[nameKey]).trim() : '';
    if (!name && !codeKey) continue;
    const key = name || String(row[codeKey]);
    if (!seen.has(key)) seen.set(key, new Set());
    if (codeKey) seen.get(key).add(Number(row[codeKey]));
  }
  return [...seen.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'fa'))
    .map(([name, codes]) => ({ name, codes: [...codes] }));
}




/**
 * The reference codes CreateGood demands — unit, packing, main and second
 * group — have no lookup endpoint of their own (see docs/orash-web-service-api.md
 * §5.1). The only place they surface is on goods that already exist, so this
 * reads GetGoods once and collects every distinct value it saw for each of the
 * four, keeping any *Code/*Id sibling the response happens to carry next to the
 * name — that pairing is the only way to learn which number means "قرقره".
 */
async function loadCodeReference() {
  if (!state.token) { alert('ابتدا وارد شوید.'); return; }
  const btn = $('btnLoadCodeRef');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'در حال دریافت…'; }
  $('codeRefWrap').classList.remove('hidden');
  $('codeRefJson').textContent = 'در حال بارگذاری…';
  try {
    const goods = await lookup('goods', {
      // Types the live service actually enforces — not the PDF's: showStockFlg
      // binds to Int64 and rejects a boolean outright (HTTP 400). See
      // docs/orash-web-service-api.md §5.2.
      showStockFlg: 0, flagDepartment: true, fromDepartment: 0, toDepartment: 0,
      currentUserId: state.userId, withFi: false,
    });
    // The proxy reports an upstream failure in-band (ok:true, upstreamStatus
    // 4xx/5xx), so an unchecked call turns a broken service into four silently
    // empty dropdowns. Say what the service said instead.
    if (goods.upstreamStatus >= 400) {
      const d = goods.data || {};
      let detail = d.title || d.message || '';
      try { detail = JSON.parse(d.detail).Message || detail; } catch { /* not nested JSON */ }
      const fields = d.errors ? ' — ' + Object.keys(d.errors).join('، ') : '';
      throw new Error(`سرویس GetGoods خطا داد (HTTP ${goods.upstreamStatus}): ${detail}${fields}`);
    }
    const rows = goodsRowsFrom(goods.data);
    state.goods = rows;
    const summary = {};
    const describe = (values) => values.map((v) => (v.codes.length
      ? { name: v.name, code: v.codes.length === 1 ? v.codes[0] : v.codes }
      : { name: v.name, code: 'نامعلوم — پاسخ سرویس کد را برنمی‌گرداند' }));
    // Listed but not offered: these three are fixed in code. Seeing what the
    // database actually uses is still how we would notice a wrong constant.
    for (const field of CODE_REF_REPORT_ONLY) summary[field.title] = describe(collectRefValues(rows, field));
    // An empty list is almost always a field-name mismatch, not an empty
    // database — so show what the row actually had, instead of just "—".
    const empty = Object.entries(summary).filter(([, v]) => !v.length).map(([k]) => k);
    if (rows.length && empty.length) {
      summary['— فیلدهای موجود در پاسخ سرویس —'] = Object.keys(rows[0]);
      summary['— بدون مقدار —'] = empty;
      summary['— یک سطر نمونه —'] = rows[0];
    }
    $('codeRefJson').textContent = rows.length
      ? JSON.stringify(summary, null, 2)
      : 'هیچ کالایی برنگشت؛ فهرست‌ها خالی ماند.';
  } catch (err) {
    $('codeRefWrap').open = true;
    $('codeRefJson').textContent = 'خطا در دریافت: ' + (err && err.message ? err.message : err);
  } finally {
    if (btn) { btn.disabled = !state.token; btn.textContent = label; }
  }
}

// ---------- tabs ----------
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tabpanel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + name));
  // The profile lives in the rail foot rather than the nav, so it is not a .tab.
  $('btnProfile').classList.toggle('active', name === 'profile');
  window.scrollTo(0, 0);
}

// ---------- wire up ----------
window.addEventListener('DOMContentLoaded', async () => {
  // The gate must never be left saying "preparing…": if even the local panel
  // server cannot be reached, that is itself the message.
  try {
    await loadConfig();
    await loadDatabases();
  } catch (err) {
    setLoginState('خطا در آماده‌سازی', 'bad');
    $('btnLogin').disabled = true;
    showStatus('loginStatus', 'bad', 'ارتباط با سرور پنل برقرار نشد',
      `<p>${escHtml(err.message)}</p><p class="hint">سرویس پنل را بررسی کنید و صفحه را دوباره باز کنید.</p>`);
  }

  $('btnReloadDbs').addEventListener('click', loadDatabases);
  $('database').addEventListener('change', async () => { markDatabaseBadge(); await loadUsers(); });
  $('btnLogin').addEventListener('click', login);
  $('btnLogout').addEventListener('click', logout);
  $('btnProfile').addEventListener('click', () => switchTab('profile'));
  // Enter in the password field submits, as a login form should.
  $('password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('btnLogin').disabled) { e.preventDefault(); login(); }
  });
  $('btnLoadLookups').addEventListener('click', loadLookups);
  $('btnAddLine').addEventListener('click', addLine);
  $('hsc').addEventListener('change', () => {
    // keep row storages in sync with header when they were empty
    document.querySelectorAll('#linesBody .itms').forEach((s) => { if (!s.value) s.value = $('hsc').value; });
  });
  $('btnPreview').addEventListener('click', () => {
    $('previewJson').textContent = JSON.stringify(buildPayload(), null, 2);
    $('previewWrap').classList.remove('hidden');
    $('previewWrap').open = true;
  });
  $('btnSubmit').addEventListener('click', submit);

  // Tabs
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // CreateGood handlers
  showLockedGoodFields();
  renderSubGroupTable();
  refreshSecondGroup();
  loadSettingsTable(true);
  $('sgAdd').addEventListener('click', () => {
    sgEdit.rows.push({ name: '', excel: '', orash: '' });
    renderSettingsTable();
    sgSetStatus('ردیف تازه اضافه شد؛ برای اعمال، «ذخیره» را بزنید.', '');
  });
  $('sgSave').addEventListener('click', saveSettingsTable);
  $('sgReload').addEventListener('click', () => loadSettingsTable(false));
  $('sgReset').addEventListener('click', () => {
    if (!confirm('جدول به همان چیزی که اول تحویل داده شده برمی‌گردد. ادامه می‌دهید؟')) return;
    sgEdit.rows = SecondGroup.GROUPS.map((g) => ({ ...g }));
    renderSettingsTable();
    sgSetStatus('جدول اولیه بازگردانده شد — هنوز ذخیره نشده.', '');
  });

  $('g_code').addEventListener('input', refreshSecondGroup);
  $('g_secondGroupCodeRef_pick').addEventListener('change', () => {
    $('g_secondGroupCodeRef').value = $('g_secondGroupCodeRef_pick').value;
  });
  $('btnSubmitGood').addEventListener('click', submitGood);
  $('btnLoadGoodsRef').addEventListener('click', loadGoodsReference);
  $('btnLoadCodeRef').addEventListener('click', loadCodeReference);
  $('btnPreviewGood').addEventListener('click', () => {
    $('goodPreviewJson').textContent = JSON.stringify(buildGoodPayload(), null, 2);
    $('goodPreviewWrap').classList.remove('hidden');
    $('goodPreviewWrap').open = true;
  });
});
