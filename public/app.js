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

function baseUrl() { return $('baseUrl').value.trim(); }
function uniqueID() { return $('database').value; }

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
  if (state.config.defaults?.baseUrl && !$('baseUrl').value) {
    $('baseUrl').value = state.config.defaults.baseUrl;
  }
  if (state.config.mock) $('mockBadge').classList.remove('hidden');
}

function markDatabaseBadge() {
  const uid = uniqueID();
  const badge = $('dbBadge');
  const dbs = state.config?.databases || {};
  const opt = $('database').selectedOptions[0];
  const name = opt ? opt.textContent : '—';
  if (uid === dbs.prod) {
    badge.className = 'db-badge prod';
    badge.textContent = 'پایگاه داده: تولید (Production) ⛔';
    $('prodWarn').classList.remove('hidden');
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
  setPill($('loginState'), 'در حال خواندن پایگاه داده‌ها…', 'busy');
  skeleton(true, 'database', 'username');
  const r = await callProxy('databases', { method: 'GET', query: { baseUrl: baseUrl() } });
  skeleton(false, 'database');
  if (!r.ok) {
    skeleton(false, 'username');
    setPill($('loginState'), 'خطا در اتصال', 'bad');
    showRaw(r);
    return;
  }
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
  setPill($('loginState'), 'وارد نشده', '');
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

// ---------- login ----------
async function login() {
  const uid = uniqueID();
  if (!uid) { alert('ابتدا پایگاه داده را انتخاب کنید.'); return; }
  const userOpt = $('username').selectedOptions[0];
  const username = $('username').value;
  const password = $('password').value;
  if (!username) { alert('نام کاربری را انتخاب کنید.'); return; }

  setPill($('loginState'), 'در حال ورود…', 'busy');
  const r = await withSpinner('btnLogin', 'در حال ورود…', () => callProxy('auth', {
    method: 'POST',
    body: { baseUrl: baseUrl(), body: { username, password, uniqueID: uid } },
  }));
  showRaw(r);
  const content = r.data?.content;
  if (r.ok && content?.token) {
    state.token = content.token;
    state.userId = userOpt?.dataset.id ? Number(userOpt.dataset.id) : null;
    setPill($('loginState'), 'ورود موفق ✓ (' + (content.name || username) + ')', 'good');
    $('btnLoadLookups').disabled = false;
    setPill($('lookupState'), 'آماده بارگذاری', '');
    console.log('[login] success', { username, uniqueID: uid, name: content.name, userId: state.userId });
    await loadLookups();
  } else {
    state.token = null;
    // On failure the useful reason is in content (a string), while message is just "fail".
    const reason = (typeof content === 'string' && content)
      ? content
      : (r.data?.message || r.error || ('HTTP ' + r.httpStatus));
    setPill($('loginState'), 'ورود ناموفق: ' + reason, 'bad');
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
      showStockFlg: false, flagDepartment: false, fromDepartment: 0, toDepartment: 0,
      currentUserId: state.userId, withFi: false,
    });
    state.goods = rowsFrom(goods.data);

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
  const isProd = uniqueID() === state.config?.databases?.prod;
  const blocked = !state.token || isProd;
  const title = isProd ? 'ثبت روی پایگاه تولید مسدود است' : (!state.token ? 'ابتدا وارد شوید' : '');
  for (const id of ['btnSubmit', 'btnSubmitGood']) {
    const b = $(id);
    if (!b) continue;
    b.disabled = blocked;
    b.title = title;
  }
  const ref = $('btnLoadGoodsRef');
  if (ref) ref.disabled = !state.token;
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

// Only the required fields for CreateGood on this deployment.
function buildGoodPayload() {
  const data = {
    code: gVal('g_code'),
    name: gVal('g_name'),
    type: Number($('g_type').value),
    serial: gVal('g_serial'),
    unitIdRef: gNum('g_unitIdRef'),
    unitPackingCodeRef: gNum('g_unitPackingCodeRef'),
    mainGroupCodeRef: gNum('g_mainGroupCodeRef'),
    secondGroupCodeRef: gNum('g_secondGroupCodeRef'),
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
  if (d.secondGroupCodeRef === undefined) errs.push('کد گروه فرعی الزامی است');
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
const GOOD_FIELD_INPUTS = {
  code: 'g_code', name: 'g_name', serial: 'g_serial', unitIdRef: 'g_unitIdRef',
  unitPackingCodeRef: 'g_unitPackingCodeRef', mainGroupCodeRef: 'g_mainGroupCodeRef',
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
}

async function loadGoodsReference() {
  if (!state.token) { alert('ابتدا وارد شوید.'); return; }
  $('goodsRefWrap').classList.remove('hidden');
  $('goodsRefWrap').open = true;
  $('goodsRefJson').textContent = 'در حال بارگذاری…';
  const goods = await lookup('goods', {
    showStockFlg: false, flagDepartment: false, fromDepartment: 0, toDepartment: 0,
    currentUserId: state.userId, withFi: false,
  });
  state.goods = rowsFrom(goods.data);
  $('goodsRefJson').textContent = JSON.stringify(goods.data, null, 2);
}

// ---------- tabs ----------
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tabpanel').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + name));
}

// ---------- wire up ----------
window.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await loadDatabases();

  $('btnReloadDbs').addEventListener('click', loadDatabases);
  $('database').addEventListener('change', async () => { markDatabaseBadge(); await loadUsers(); });
  $('btnLogin').addEventListener('click', login);
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
  $('btnSubmitGood').addEventListener('click', submitGood);
  $('btnLoadGoodsRef').addEventListener('click', loadGoodsReference);
  $('btnPreviewGood').addEventListener('click', () => {
    $('goodPreviewJson').textContent = JSON.stringify(buildGoodPayload(), null, 2);
    $('goodPreviewWrap').classList.remove('hidden');
    $('goodPreviewWrap').open = true;
  });
});
