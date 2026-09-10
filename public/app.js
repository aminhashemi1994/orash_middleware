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
  // The service rejecting our token means the session is over, whatever the
  // clock says — drop it rather than let every later call fail silently.
  if (json && json.upstreamStatus === 401 && state.token) {
    clearSession();
    state.token = null;
    setLoginState('نشست منقضی شده — دوباره وارد شوید', 'bad');
    logout();
  }
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
  const dbs = state.config?.databases || {};
  // Only the production company is offered. The service also returns the test
  // and template databases, but this panel is used against the real one, and an
  // operator picking the wrong entry would register goods nowhere useful.
  const rows = rowsFrom(r.data).filter((row) => row.uniqueID === dbs.prod);
  const sel = $('database');
  sel.innerHTML = '';
  if (!rows.length) {
    // The service answered, but not with the database this panel is configured
    // for — say so rather than show an empty box.
    sel.innerHTML = '<option value="">— پایگاه داده تولید یافت نشد —</option>';
    $('btnLogin').disabled = true;
    setLoginState('پایگاه داده تولید در پاسخ سرویس نبود', 'bad');
    markDatabaseBadge();
    return;
  }
  for (const row of rows) {
    const o = document.createElement('option');
    o.value = row.uniqueID;
    o.textContent = row.companyName || row.name;
    o.selected = true;
    sel.appendChild(o);
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
/**
 * Keeping the operator signed in across a refresh.
 *
 * The session lives in this browser's own localStorage and nowhere else — it is
 * never sent anywhere, so signing in here has no effect on any other machine,
 * and a phone or a second PC still has to sign in for itself. It expires two
 * hours after signing in, whatever the Orash token's own lifetime, so a
 * forgotten browser does not stay able to write to production all day.
 */
const SESSION_KEY = 'orash.session';
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function saveSession(name) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      token: state.token,
      userId: state.userId,
      name,
      uniqueID: uniqueID(),
      username: $('username').value,
      expiresAt: Date.now() + SESSION_TTL_MS,
    }));
  } catch { /* private mode, or storage disabled — sign-in still works */ }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* nothing to clear */ }
}

/** @returns {object|null} the stored session, or null when absent or expired. */
function readSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!raw || !raw.token) return null;
    if (!(raw.expiresAt > Date.now())) { clearSession(); return null; }
    return raw;
  } catch { return null; }
}

/** How long is left, for the profile panel. */
function sessionRemaining(expiresAt) {
  const mins = Math.max(0, Math.round((expiresAt - Date.now()) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)} ساعت و ${mins % 60} دقیقه` : `${mins} دقیقه`;
}

/**
 * Come back to a signed-in panel after a refresh.
 * @returns {boolean} whether a session was restored.
 */
function restoreSession() {
  const saved = readSession();
  if (!saved) return false;
  // The database list is already loaded; only a session for the database this
  // panel is configured for can be resumed.
  const sel = $('database');
  if (![...sel.options].some((o) => o.value === saved.uniqueID)) { clearSession(); return false; }
  sel.value = saved.uniqueID;
  state.token = saved.token;
  state.userId = saved.userId;
  if (saved.username) $('username').value = saved.username;
  markDatabaseBadge();
  enterApp(saved.name);
  setLoginState('ورود موفق ✓ (' + (saved.name || '') + ')', 'good');
  refreshSubmitEnabled();
  $('s_session').textContent = `تا ${sessionRemaining(saved.expiresAt)} دیگر معتبر است`;
  return true;
}

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
  clearSession();
  state.token = null;
  state.userId = null;
  $('s_session').textContent = '—';
  $('password').value = '';
  $('loginStatus').classList.add('hidden');
  $('appShell').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  setPill($('sessionState'), 'خارج شد', 'bad');
  $('profileName').textContent = 'وارد نشده';
  setLoginState('وارد نشده', '');
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
    console.log('[login] success', { username, uniqueID: uid, name: content.name, userId: state.userId });
    saveSession(content.name || username);
    $('s_session').textContent = `تا ${sessionRemaining(Date.now() + SESSION_TTL_MS)} دیگر معتبر است`;
    $('loginStatus').classList.add('hidden');
    enterApp(content.name || username);
    refreshSubmitEnabled();          // unblock the forms before the slow part
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

/** A read-only service call, wrapped in the envelope every lookup shares. */
async function lookup(name, extraData = {}) {
  const body = { baseUrl: baseUrl(), token: state.token,
    body: { uniqueID: uniqueID(), data: { userId: state.userId, ...extraData } } };
  return callProxy(name, { method: 'POST', body });
}

/**
 * The reference lists a warehouse document needs.
 *
 * `userId` sits beside `uniqueID`, not inside `data` — put it in `data` and
 * every one of these answers «کد کاربر صحيح نيست» with an otherwise valid
 * request. That is the whole reason these lookups looked broken for so long.
 */
async function listFor(name) {
  const body = { baseUrl: baseUrl(), token: state.token,
    body: { uniqueID: uniqueID(), userId: state.userId } };
  const r = await callProxy(name, { method: 'POST', body });
  if (!r.ok) throw new Error(r.error || 'خطای شبکه/پروکسی');
  const rows = rowsFrom(r.data);
  const bad = rows.length === 1 && JSON.stringify(rows[0]).includes('صحيح نيست');
  if (bad) throw new Error(Object.values(rows[0]).find((v) => typeof v === 'string' && v.includes('نيست')));
  return rows;
}

// ---------- submit + status ----------
function refreshSubmitEnabled() {
  const noWrite = prodWriteBlocked();
  const blocked = !state.token || noWrite;
  const title = noWrite ? 'ثبت روی پایگاه تولید مسدود است' : (!state.token ? 'ابتدا وارد شوید' : '');
  const b = $('btnSubmitGood');
  if (b) { b.disabled = blocked; b.title = title; }
  for (const id of ['btnLoadGoodsRef', 'btnLoadCodeRef', 'btnDocLoad', 'ddLoad']) {
    const ref = $(id);
    if (ref) ref.disabled = !state.token;
  }
  const doc = $('btnDocSubmit');
  if (doc) { doc.disabled = blocked; doc.title = title; }
  if (typeof showDocUser === 'function') showDocUser();
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
/**
 * What each QR mode implies. `mode: "L"` — a label — means the good is measured
 * in metres and packed in کلاف, so those codes are not carried in the QR and are
 * not the operator's to change: they follow from the mode.
 *
 * Only `unitIdRef` reaches CreateGood. The packing code belongs to the step
 * after registration, and is kept here so both read one definition.
 */
const MODE_DEFAULTS = {
  L: {
    unitIdRef: { value: 5, label: 'متر' },
    unitPackingCodeRef: { value: 2, label: 'کلاف' },
  },
};

/** The codes shown on the form, for the only mode the panel registers today. */
const LOCKED_GOOD_FIELDS = MODE_DEFAULTS.L;


// ---------- warehouse receipt / issue ----------

/**
 * Both halves of every reference value are shown — «30 — انبار کالای ساخته شده»
 * — because a warehouse picked by name alone is a warehouse picked wrongly when
 * two of them read alike, and a code alone means nothing to the operator.
 */
const withCode = (code, name) => `${code} — ${name}`;

/**
 * A searchable reference field.
 *
 * Not a `<datalist>`: the browser's own popup takes no styling, ignores the
 * page's direction, and shows a code and a Persian name jammed into one line.
 * This is a list this panel draws itself — right-to-left, code and name in
 * their own columns, keyboard-navigable, and matching on either half.
 */
const combos = new Map();

function combo(inputId) {
  if (combos.has(inputId)) return combos.get(inputId);
  const input = $(inputId);
  const list = $(inputId + '_list');
  const api = { rows: [], code: '', shown: [], active: -1 };

  const label = (row) => `${row.code} — ${row.name}`;

  const close = () => {
    list.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
    api.active = -1;
  };

  const choose = (row) => {
    api.code = String(row.code);
    input.value = label(row);
    close();
  };

  const render = (query) => {
    const q = String(query || '').trim().toLowerCase();
    // Cap what is drawn: two thousand accounts would otherwise be two thousand
    // elements on every keystroke.
    api.shown = (q ? api.rows.filter((r) => label(r).toLowerCase().includes(q)) : api.rows).slice(0, 200);
    list.innerHTML = '';
    if (!api.shown.length) {
      const li = document.createElement('li');
      li.className = 'combo-empty';
      li.textContent = api.rows.length ? 'موردی پیدا نشد' : 'فهرست بارگذاری نشده';
      list.appendChild(li);
    }
    api.shown.forEach((row, i) => {
      const li = document.createElement('li');
      li.className = 'combo-item';
      li.setAttribute('role', 'option');
      li.innerHTML = `<span class="combo-code">${escHtml(row.code)}</span>`
        + `<span class="combo-name">${escHtml(row.name)}</span>`;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(row); });
      li.addEventListener('mouseenter', () => setActive(i));
      list.appendChild(li);
    });
    list.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    setActive(api.shown.length ? 0 : -1);
  };

  const setActive = (i) => {
    api.active = i;
    [...list.querySelectorAll('.combo-item')].forEach((el, n) => {
      el.classList.toggle('active', n === i);
      if (n === i) el.scrollIntoView({ block: 'nearest' });
    });
  };

  input.addEventListener('input', () => { api.code = ''; render(input.value); });
  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.classList.contains('hidden')) return render(input.value);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = (api.active + step + api.shown.length) % (api.shown.length || 1);
      setActive(next);
    } else if (e.key === 'Enter') {
      if (api.active >= 0 && api.shown[api.active]) { e.preventDefault(); choose(api.shown[api.active]); }
    } else if (e.key === 'Escape') {
      close();
    }
  });

  api.setRows = (rows, codeKey, nameKey) => {
    api.rows = rows.map((r) => ({ code: r[codeKey], name: r[nameKey] }));
    // Keep whatever was already chosen, now that its label can be resolved.
    if (api.code) api.setCode(api.code);
  };
  api.setCode = (code) => {
    if (code === undefined || code === null || code === '') return;
    api.code = String(code);
    const hit = api.rows.find((r) => String(r.code) === api.code);
    input.value = hit ? label(hit) : api.code;
  };
  /** The chosen code — or, if the operator typed a bare code, that. */
  api.getCode = () => api.code || codeFromLabel(input.value);
  api.clear = () => { api.code = ''; input.value = ''; };

  combos.set(inputId, api);
  return api;
}

/** Every reference field, and the list each one draws from. */
const COMBO_FIELDS = {
  storageCode: { doc: 'd_storage', settings: 'dd_storage', route: 'storages', codeKey: 'storageCode', nameKey: 'storageName' },
  departmentCode: { doc: 'd_department', settings: 'dd_department', route: 'departments', codeKey: 'departmentCode', nameKey: 'departmentName' },
  accountCode: { doc: 'd_account', settings: 'dd_account', route: 'customers', codeKey: 'code', nameKey: 'name' },
};

/** Read every list once and hand the same rows to both forms. */
async function loadComboRows() {
  const entries = Object.entries(COMBO_FIELDS);
  const results = await Promise.all(entries.map(([, f]) => listFor(f.route)));
  entries.forEach(([, f], i) => {
    for (const id of [f.doc, f.settings]) combo(id).setRows(results[i], f.codeKey, f.nameKey);
  });
  return Object.fromEntries(entries.map(([key], i) => [key, results[i]]));
}

async function loadDocLookups() {
  if (!state.token) { alert('ابتدا وارد شوید.'); return; }
  setPill($('docState'), 'در حال بارگذاری…', 'busy');
  try {
    const rows = await loadComboRows();
    setPill($('docState'), `${rows.storageCode.length} انبار · ${rows.accountCode.length} تفصیلی`, 'ok');
    applyDocDefaults();
    showDocUser();
    docSetStatus('', '');
  } catch (err) {
    setPill($('docState'), 'ناموفق', 'bad');
    docSetStatus('بارگذاری فهرست‌ها ناموفق بود: ' + (err.message || err), 'bad');
  }
}

function docSetStatus(text, kind, html) {
  const box = $('docStatus');
  box.className = 'status' + (kind ? ' ' + kind : '');
  box.innerHTML = html || escHtml(text);
  box.classList.toggle('hidden', !text && !html);
}

/** The leading number of «120001 — رفاه ناظران». */
const codeFromLabel = (v) => String(v || '').trim().split('—')[0].trim();

/**
 * Today, as Orash writes dates: `1405/06/19`.
 *
 * Built from parts rather than a formatted string — the formatted one is
 * `06/19/1405 AP`, in the wrong order and with an era suffix.
 */
function jalaliNow() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${parts.year}/${pad(parts.month)}/${pad(parts.day)}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Scans worth putting on a document: everything that parsed cleanly. */
function docSourceRows() {
  const queue = (window.ScanPanel && window.ScanPanel.scan && window.ScanPanel.scan.queue) || [];
  return queue.filter((i) => i.status !== 'invalid').map((i) => i.data);
}

function renderDocLines() {
  const { lines, errors } = WarehouseDoc.aggregate(docSourceRows());
  const body = document.querySelector('#docTable tbody');
  body.innerHTML = '';
  if (!lines.length) {
    const tr = document.createElement('tr');
    tr.className = 'table-empty';
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = 'سطری ساخته نشد — صف اسکن خالی است یا هیچ ردیفی کامل نبود.';
    tr.appendChild(td);
    body.appendChild(tr);
  }
  for (const l of lines) {
    const tr = document.createElement('tr');
    for (const cell of [l.code, l.name, withCode(l.packingId, l.packingTitle),
                        l.lengthValue, l.count, l.quantity]) {
      const td = document.createElement('td');
      td.textContent = String(cell);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  $('btnDocSubmit').disabled = !lines.length || !state.token || prodWriteBlocked();
  if (errors.length) {
    docSetStatus(' ', 'bad', `<strong>${errors.length} ردیف کنار گذاشته شد</strong><ul><li>`
      + errors.map(escHtml).join('</li><li>') + '</li></ul>');
  } else if (!lines.length) {
    docSetStatus('صف اسکن خالی است — چیزی برای ثبت نیست.', '');
  } else {
    docSetStatus(`${lines.length} سطر آماده‌ی ثبت است.`, 'ok');
  }
  return lines;
}

async function submitDoc() {
  const lines = renderDocLines();
  if (!lines.length) return;

  const kind = $('d_kind').value;
  const missing = [];
  const createuser = state.userId;
  if (!createuser) missing.push('کاربر (دوباره وارد شوید)');
  const storageCode = combo('d_storage').getCode(); if (!storageCode) missing.push('انبار');
  const departmentCode = combo('d_department').getCode(); if (!departmentCode) missing.push('شعبه');
  const accountCode = combo('d_account').getCode(); if (!accountCode) missing.push('حساب تفصیلی');
  if (missing.length) {
    docSetStatus('این موارد انتخاب نشده‌اند: ' + missing.join('، '), 'bad');
    return;
  }

  const { date, time } = jalaliNow();
  const doc = WarehouseDoc.build({
    kind, lines, createuser, departmentCode, storageCode, accountCode,
    createdate: date, createtime: time, description: gVal('d_description'),
  });
  const title = WarehouseDoc.DOC_TYPES[kind].title;

  docSetStatus(`در حال ثبت ${title}…`, 'busy');
  const r = await withSpinner('btnDocSubmit', 'در حال ثبت…', () => callProxy('createInvoice', {
    method: 'POST',
    body: { baseUrl: baseUrl(), token: state.token, uniqueID: uniqueID(),
            body: { uniqueID: uniqueID(), ...doc } },
  }));
  showRaw(r);
  if (r.httpStatus === 403) { docSetStatus(r.error, 'bad'); return; }
  if (!r.ok) { docSetStatus('ناموفق: ' + (r.error || 'خطای شبکه/پروکسی'), 'bad'); return; }

  const res = interpret(r);
  const message = res.items.map((it) => it.errorMessage).filter(Boolean).join(' / ') || res.data.message || '';
  if (res.ok) {
    docSetStatus(' ', 'good', `<strong>${escHtml(title)} ثبت شد ✓</strong><p>${escHtml(message)}</p>`
      + `<p class="mono">${escHtml(res.httpLine)}</p>`);
  } else {
    docSetStatus(' ', 'bad', `<strong>ثبت ${escHtml(title)} ناموفق بود</strong><p>${escHtml(message)}</p>`
      + `<p class="mono">${escHtml(res.httpLine)}</p>`);
  }
}

// ---------- settings: warehouse-document defaults ----------

// `createuser` is deliberately absent: a document is filed by whoever is signed
// in, so it is taken from the session and is neither chosen nor defaulted.
const DOC_DEFAULT_FIELDS = {
  kind: 'dd_kind', storageCode: 'dd_storage', departmentCode: 'dd_department',
  accountCode: 'dd_account',
};
/** Same values, in the document form itself. */
const DOC_FORM_FIELDS = {
  kind: 'd_kind', storageCode: 'd_storage', departmentCode: 'd_department',
  accountCode: 'd_account',
};

let docDefaults = {};

function ddSetStatus(text, kind) {
  const box = $('ddStatus');
  box.className = 'status' + (kind ? ' ' + kind : '');
  box.textContent = text;
  box.classList.toggle('hidden', !text);
}

/** Which list belongs to which field. `kind` is a plain two-option select. */
/** Who the document will be filed by — the signed-in user, always. */
function showDocUser() {
  const el = $('d_user');
  if (!el) return;
  const name = $('profileName') ? $('profileName').textContent : '';
  el.textContent = state.userId
    ? `${state.userId}${name && name !== 'وارد نشده' ? ' — ' + name : ''}`
    : '— وارد نشده —';
}

/** Put the saved defaults into the document form. */
function applyDocDefaults() {
  for (const [key, id] of Object.entries(DOC_FORM_FIELDS)) {
    const value = docDefaults[key];
    if (value === undefined || value === '') continue;
    if (key === 'kind') { $(id).value = value; continue; }
    combo(id).setCode(value);
  }
}

async function loadDocDefaults(quiet) {
  try {
    const res = await fetch('/settings/doc-defaults');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'خطای نامشخص');
    docDefaults = json.defaults || {};
    for (const [key, id] of Object.entries(DOC_DEFAULT_FIELDS)) {
      const value = docDefaults[key] || '';
      if (key === 'kind') { $(id).value = value; continue; }
      combo(id).clear();
      combo(id).setCode(value);
    }
    setPill($('ddState'), Object.keys(docDefaults).length ? `${Object.keys(docDefaults).length} مقدار` : 'خالی', 'ok');
    if (!quiet) ddSetStatus('پیش‌فرض‌ها از سرور خوانده شد.', 'ok');
  } catch (err) {
    ddSetStatus('خواندن پیش‌فرض‌ها ناموفق بود: ' + (err.message || err), 'bad');
  }
}

async function saveDocDefaults() {
  const defaults = {};
  for (const [key, id] of Object.entries(DOC_DEFAULT_FIELDS)) {
    defaults[key] = key === 'kind' ? $(id).value : combo(id).getCode();
  }
  ddSetStatus('در حال ذخیره…', 'busy');
  try {
    const res = await fetch('/settings/doc-defaults', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaults }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'خطای نامشخص');
    docDefaults = json.defaults || {};
    setPill($('ddState'), `${Object.keys(docDefaults).length} مقدار`, 'ok');
    ddSetStatus('ذخیره شد. در فرم رسید و حواله از پیش پر می‌شود.', 'ok');
  } catch (err) {
    ddSetStatus('ذخیره ناموفق بود: ' + (err.message || err), 'bad');
  }
}

/** The settings page needs the same lists the document form fills. */
async function loadDocDefaultLists() {
  if (!state.token) { alert('ابتدا وارد شوید.'); return; }
  ddSetStatus('در حال بارگذاری…', 'busy');
  try {
    await loadComboRows();
    await loadDocDefaults(true);
    ddSetStatus('فهرست‌ها بارگذاری شد؛ انتخاب کنید و «ذخیره» را بزنید.', 'ok');
  } catch (err) {
    ddSetStatus('بارگذاری ناموفق بود: ' + (err.message || err), 'bad');
  }
}

// ---------- settings: the packing table ----------

const pkEdit = { rows: [], savedAt: null, source: 'default' };

function pkSetStatus(text, kind) {
  const box = $('pkStatus');
  box.className = 'status' + (kind ? ' ' + kind : '');
  box.textContent = text;
  box.classList.toggle('hidden', !text);
}

function renderPackingTable() {
  const body = document.querySelector('#pkTable tbody');
  if (!body) return;
  body.innerHTML = '';
  pkEdit.rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    const cell = (child) => { const td = document.createElement('td'); td.appendChild(child); tr.appendChild(td); return td; };

    const title = document.createElement('input');
    title.type = 'text'; title.value = row.title || ''; title.placeholder = 'مثلاً: کلاف-زرد';
    title.addEventListener('input', () => { pkEdit.rows[i].title = title.value; });
    cell(title);

    const id = document.createElement('input');
    id.type = 'number'; id.min = '1'; id.value = row.id == null ? '' : row.id;
    id.addEventListener('input', () => { pkEdit.rows[i].id = id.value; });
    cell(id).className = 'narrow';

    const del = document.createElement('button');
    del.type = 'button'; del.className = 'ghost danger'; del.textContent = 'حذف';
    del.addEventListener('click', () => { pkEdit.rows.splice(i, 1); renderPackingTable(); });
    cell(del).className = 'narrow';

    body.appendChild(tr);
  });
  setPill($('pkState'), `${pkEdit.rows.length} ردیف` + (pkEdit.source === 'file' ? ' — ذخیره‌شده' : ' — جدول اولیه'), 'ok');
}

function pkAdopt(payload) {
  pkEdit.rows = payload.packings.map((p) => ({ ...p }));
  pkEdit.savedAt = payload.savedAt || null;
  pkEdit.source = payload.source || 'default';
  Packing.setPackings(payload.packings);
  renderPackingTable();
}

async function loadPackingTable(quiet) {
  try {
    const res = await fetch('/settings/packings');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'خطای نامشخص');
    pkAdopt(json);
    if (!quiet) pkSetStatus('جدول از سرور خوانده شد.', 'ok');
  } catch (err) {
    pkSetStatus('خواندن جدول بسته‌بندی ناموفق بود: ' + (err.message || err), 'bad');
  }
}

async function savePackingTable() {
  const { errors } = Packing.validate(pkEdit.rows);
  if (errors.length) { pkSetStatus(errors.join('\n'), 'bad'); return; }
  pkSetStatus('در حال ذخیره…', 'busy');
  try {
    const res = await fetch('/settings/packings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packings: pkEdit.rows }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'خطای نامشخص');
    pkAdopt(json);
    pkSetStatus(`ذخیره شد — ${json.packings.length} ردیف.`, 'ok');
  } catch (err) {
    pkSetStatus('ذخیره ناموفق بود: ' + (err.message || err), 'bad');
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

/** Force the locked codes onto a record, whatever a scanned QR claimed. */
function applyLockedGoodFields(data) {
  for (const [field, { value }] of Object.entries(LOCKED_GOOD_FIELDS)) {
    if (value === null) delete data[field];
    else data[field] = value;
  }
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
    if (el) el.textContent = value === null ? label : `${value} — ${label}`;
  }
}

// Only the required fields for CreateGood on this deployment.
/**
 * The body CreateGood needs, and nothing else.
 *
 * Measured against the live service on 2026-08-27: only `code`, `name`, `type`
 * and `unitIdRef` are required — main group, sub-group and packing are checked
 * only when present, so omitting them is accepted. Everything else about the
 * cable (متراژ, رنگ, گروه) belongs to the step that follows registration.
 */
function buildGoodPayload() {
  const data = {
    code: gVal('g_code'),
    name: gVal('g_name'),
    type: 1,                                        // کالا
    unitIdRef: LOCKED_GOOD_FIELDS.unitIdRef.value,  // متر, from mode L
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
  if (d.unitIdRef === undefined) errs.push('کد واحد شمارش (unitIdRef) الزامی است');
  return errs;
}


/**
 * Send one CreateGood request and normalize the outcome.
 * Shared by the manual form and by every scanned code, so both paths report
 * success and failure identically.
 * @param {object} data  the CreateGood `data` object
 * @returns {Promise<{ok:boolean, code:?string, message:string, httpLine:string, blocked?:boolean}>}
 */
/**
 * Ask before registering. Resolves true when the operator chose to register.
 *
 * A promise rather than `confirm()`: the panel has to show what it is about to
 * write, and the two answers are not "ok/cancel" but two different decisions —
 * register it here, or leave it to accounting.
 */
function askToRegister(data) {
  const wrap = $('askWrap');
  $('askFacts').innerHTML = [
    ['کد کالا', data.code],
    ['عنوان', data.name],
    ['واحد شمارش', `${LOCKED_GOOD_FIELDS.unitIdRef.value} — ${LOCKED_GOOD_FIELDS.unitIdRef.label}`],
  ].map(([k, v]) => `<div class="chip"><dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd></div>`).join('');
  wrap.classList.remove('hidden');

  return new Promise((resolve) => {
    const done = (answer) => {
      wrap.classList.add('hidden');
      $('askConfirm').removeEventListener('click', yes);
      $('askCancel').removeEventListener('click', no);
      document.removeEventListener('keydown', onKey);
      resolve(answer);
    };
    const yes = () => done(true);
    const no = () => done(false);
    const onKey = (e) => { if (e.key === 'Escape') no(); };
    $('askConfirm').addEventListener('click', yes);
    $('askCancel').addEventListener('click', no);
    document.addEventListener('keydown', onKey);
    $('askConfirm').focus();
  });
}

/**
 * Is this goods code already registered in Orash?
 *
 * `GetGoods` would be the obvious way to ask, but it is broken on this server
 * («Procedure or function SearchGoods has too many arguments specified»), so the
 * question is put to CreateGood itself. CreateGood checks for a duplicate code
 * *before* it checks `goodCategoryIdRef`, so a request carrying a category that
 * cannot exist is always rejected — and which rejection comes back is the
 * answer:
 *
 *   «مقدار فيلد کد کالا و خدمات تکراري است»  → the code is already registered
 *   «کد طبقه بندي صحيح نيست»                 → it is not, and nothing was created
 *
 * Nothing is ever written: the guard stops the request one step before creation.
 */
const CATEGORY_GUARD = 8123;   // a goodCategoryIdRef that does not exist

async function goodExists(data) {
  const probe = { ...ScanCore.forService(data), goodCategoryIdRef: CATEGORY_GUARD };
  const r = await callProxy('createGood', {
    method: 'POST',
    body: { baseUrl: baseUrl(), token: state.token, uniqueID: uniqueID(),
            body: { uniqueID: uniqueID(), data: probe } },
  });
  if (r.httpStatus === 403) return { ok: false, blocked: true, message: r.error };
  if (!r.ok) return { ok: false, message: r.error || 'خطای شبکه/پروکسی' };

  const res = interpret(r);
  const text = (res.item.errorMessage || res.data.message || '').trim();
  if (text.includes('تکراري است') && text.includes('کد کالا')) {
    return { ok: true, exists: true, message: text };
  }
  if (text.includes('طبقه بندي')) return { ok: true, exists: false, message: text };
  // Anything else means the question was not answered — a duplicate *name*, a
  // rejected code, a service fault. Report it rather than guess.
  return { ok: false, message: text || 'پاسخ سرویس شناخته نشد', httpLine: res.httpLine };
}

async function postGood(data) {
  // `mode` and anything else local to this system never leaves it.
  const body = ScanCore.forService(data);
  const r = await callProxy('createGood', {
    method: 'POST',
    body: { baseUrl: baseUrl(), token: state.token, uniqueID: uniqueID(),
            body: { uniqueID: uniqueID(), data: body } },
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

  // Look before writing: a good that is already registered needs nothing done,
  // and one that is not is the operator's decision, not ours.
  showStatus('goodStatus', 'busy', 'در حال بررسی وجود کالا…', '');
  const found = await withSpinner('btnSubmitGood', 'در حال بررسی…', () => goodExists(payload.data));
  if (!found.ok) {
    showStatus('goodStatus', 'bad', found.blocked ? 'مسدود شد' : 'بررسی وجود کالا ناموفق بود',
      `<p>${escHtml(found.message)}</p>`);
    return;
  }
  if (found.exists) {
    showStatus('goodStatus', 'good', 'کالا از قبل در اوراش ثبت است',
      `<p>کد <b>${escHtml(payload.data.code)}</b> قبلاً ثبت شده؛ کاری لازم نیست.</p>`);
    return;
  }

  if (!await askToRegister(payload.data)) {
    showStatus('goodStatus', 'busy', 'ثبت نشد',
      `<p>کد <b>${escHtml(payload.data.code)}</b> در اوراش نیست. برای ثبت به تیم حسابداری اطلاع دهید.</p>`);
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
const GOOD_FIELD_INPUTS = { code: 'g_code', name: 'g_name' };

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
    restoreSession();
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

  // Tabs
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // CreateGood handlers
  showLockedGoodFields();
  loadSettingsTable(true);
  loadPackingTable(true);
  for (const f of Object.values(COMBO_FIELDS)) { combo(f.doc); combo(f.settings); }
  loadDocDefaults(true);
  $('ddLoad').addEventListener('click', loadDocDefaultLists);
  $('ddSave').addEventListener('click', saveDocDefaults);
  $('ddClear').addEventListener('click', () => {
    for (const [key, id] of Object.entries(DOC_DEFAULT_FIELDS)) {
      if (key === 'kind') $(id).value = '';
      else combo(id).clear();
    }
    ddSetStatus('همه پاک شد — برای اعمال، «ذخیره» را بزنید.', '');
  });
  $('btnDocLoad').addEventListener('click', loadDocLookups);
  $('btnDocPreview').addEventListener('click', renderDocLines);
  $('btnDocSubmit').addEventListener('click', submitDoc);
  $('pkAdd').addEventListener('click', () => {
    pkEdit.rows.push({ title: '', id: '' });
    renderPackingTable();
    pkSetStatus('ردیف تازه اضافه شد؛ برای اعمال، «ذخیره» را بزنید.', '');
  });
  $('pkSave').addEventListener('click', savePackingTable);
  $('pkReload').addEventListener('click', () => loadPackingTable(false));
  $('pkReset').addEventListener('click', () => {
    if (!confirm('جدول بسته‌بندی به حالت اولیه برمی‌گردد. ادامه می‌دهید؟')) return;
    pkEdit.rows = Packing.PACKINGS.map((p) => ({ ...p }));
    renderPackingTable();
    pkSetStatus('جدول اولیه بازگردانده شد — هنوز ذخیره نشده.', '');
  });
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

  $('btnSubmitGood').addEventListener('click', submitGood);
  $('btnLoadGoodsRef').addEventListener('click', loadGoodsReference);
  $('btnLoadCodeRef').addEventListener('click', loadCodeReference);
  $('btnPreviewGood').addEventListener('click', () => {
    // Show what the service will actually receive, not the internal record.
    const p = buildGoodPayload();
    $('goodPreviewJson').textContent = JSON.stringify({ ...p, data: ScanCore.forService(p.data) }, null, 2);
    $('goodPreviewWrap').classList.remove('hidden');
    $('goodPreviewWrap').open = true;
  });
});
