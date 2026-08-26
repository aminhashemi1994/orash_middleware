'use strict';

/**
 * Orash Invoice Panel - local proxy server.
 *
 * Why a proxy: the Orash web service does not send CORS headers, so a browser
 * page cannot call it directly. This tiny Node server (built-in modules only)
 * sits in front of it, forwards whitelisted requests, and serves the static UI.
 *
 * It also hosts the phone scanner: an HTTPS listener (self-signed) so a phone
 * on the same LAN can use its camera, plus an SSE relay that forwards decoded
 * QR text from the phone to the desktop panel.
 *
 * Safety:
 *  - Only a fixed whitelist of upstream paths is reachable.
 *  - Writes (CreateGood / CreateInvoice) are blocked unless the target uniqueID
 *    is the configured TEST database, unless ALLOW_PROD_WRITE=1 is set.
 *
 * Env:
 *  PORT=4173          HTTP port
 *  HTTPS_PORT=4443    HTTPS port (phone camera needs a secure context)
 *  HTTPS=0            disable the HTTPS listener
 *  TLS_KEY / TLS_CERT use your own certificate instead of the generated one
 *  MOCK=1             answer from the built-in simulator instead of the real service
 *  ALLOW_PROD_WRITE=1 permit writes against the production database
 *  SERIAL_HOST=0      do not read the USB scanner here; use the browser instead
 *  SERIAL_DEVICE      pin the scanner's device node (default: auto-detect)
 *  SERIAL_BAUD=9600   scanner line speed
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// .env first: everything below reads process.env. Real environment variables
// still win, so `PORT=5000 node server.js` overrides the file.
const envFile = require('./lib/env').load();

const relay = require('./lib/scan-relay');
const { ensureCert, lanIPv4 } = require('./lib/self-signed');
const { mockForward } = require('./lib/mock-upstream');
const serialCheck = require('./lib/serial-check');
const serialHost = require('./lib/serial-host');
const labelQr = require('./lib/label-qr');

const PORT = Number(process.env.PORT || 4173);
// 0.0.0.0 for a LAN machine; behind a reverse proxy set HOST=127.0.0.1 so the
// service is unreachable except through nginx.
const HOST = process.env.HOST || '0.0.0.0';
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 4443);
const ENABLE_HTTPS = process.env.HTTPS !== '0';
const MOCK = process.env.MOCK === '1';
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 20000);
// The address a phone should use. Required behind a proxy: the LAN IP this
// process can see is not the address the phone can reach.
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
// Pre-filled default for the panel's "Base URL" field; users can still change it.
const ORASH_BASE_URL = process.env.ORASH_BASE_URL || 'http://192.168.3.210:5000';

// Known databases (from GetDatabasesInfo on 192.168.3.210:5000).
const TEST_DB = '61c7f1d6-0297-49e4-a02c-546b1c12f22c';   // Orash3 - "دیتای تست برای وب سرویس"
const PROD_DB = '44e66728-fea3-4fc9-b2bd-5ecb9bb893e2';   // Orash  - real production company
const ALLOW_PROD_WRITE = process.env.ALLOW_PROD_WRITE === '1';

// Upstream paths the proxy is allowed to forward to, and the HTTP method used.
const ROUTES = {
  databases:      { method: 'GET',  path: '/api/Install/GetDatabasesInfo', auth: false },
  users:          { method: 'GET',  path: '/api/Auth',                      auth: false },
  auth:           { method: 'POST', path: '/api/Auth',                      auth: false },
  departments:    { method: 'POST', path: '/api/v3/Department/GetDepartments', auth: true },
  storages:       { method: 'POST', path: '/api/v3/Storage/GetStorages',    auth: true },
  stock:          { method: 'POST', path: '/api/v3/Storage/GetStockStorage', auth: true },
  tafsili:        { method: 'POST', path: '/api/v3/Tafsili/GetTafsili2',     auth: true },
  customers:      { method: 'POST', path: '/api/v3/Customer/GetCustomer',    auth: true },
  goods:          { method: 'POST', path: '/api/v3/Good/GetGoods',          auth: true },
  createGood:     { method: 'POST', path: '/api/v3/Good/CreateGood',        auth: true, write: true },
  createInvoice:  { method: 'POST', path: '/api/v3/Invoice/CreateInvoice',  auth: true, write: true },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5 * 1024 * 1024) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/**
 * Forward a request to the Orash service.
 * payload: { baseUrl, uniqueID, token, query, body }
 */
async function forward(name, route, payload) {
  if (MOCK) return mockForward(name, payload);

  const { baseUrl, token } = payload;
  if (!baseUrl) throw new Error('baseUrl is required');

  const target = new URL(route.path, baseUrl);
  if (payload.query) {
    for (const [k, v] of Object.entries(payload.query)) {
      if (v !== undefined && v !== null && v !== '') target.searchParams.set(k, v);
    }
  }

  const headers = { 'Accept': '*/*' };
  const init = { method: route.method, headers };

  if (route.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(payload.body ?? {});
  }
  if (route.auth) {
    if (!token) throw new Error('this operation requires a token; log in first');
    headers['Authorization'] = 'bearer ' + token;
  }

  // Without a deadline an unreachable host leaves the panel spinning forever.
  init.signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    // Node collapses every network failure into "fetch failed"; the useful part
    // (ECONNREFUSED / EHOSTUNREACH / ETIMEDOUT) hides in the cause.
    if (err.name === 'TimeoutError') {
      throw new Error(`${target.origin} پاسخ نداد (بیش از ${UPSTREAM_TIMEOUT_MS / 1000} ثانیه)`);
    }
    const cause = err.cause?.code || err.cause?.message || err.message;
    throw new Error(`${target.origin} در دسترس نیست (${cause})`);
  }

  const text = await upstream.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: upstream.status, body: parsed };
}

function guardWrite(route, payload) {
  if (!route.write) return null;
  const uid = (payload.body && payload.body.uniqueID) || payload.uniqueID;
  if (uid === PROD_DB && !ALLOW_PROD_WRITE) {
    return 'Refusing to write to the PRODUCTION database (Orash). '
      + 'Set ALLOW_PROD_WRITE=1 to override. Use the test DB (Orash3) instead.';
  }
  return null;
}

// ---------------------------------------------------------------- scan relay

/**
 * URLs a phone can use to reach this server. HTTPS first: the camera needs a
 * secure context. Behind a reverse proxy the loopback address is useless to a
 * phone, so PUBLIC_URL wins outright when it is set.
 */
function phoneUrls() {
  if (PUBLIC_URL) return [`${PUBLIC_URL}/mobile.html`];

  const urls = [];
  for (const ip of lanIPv4()) {
    if (tlsReady) urls.push(`https://${ip}:${HTTPS_PORT}/mobile.html`);
    urls.push(`http://${ip}:${PORT}/mobile.html`);
  }
  return urls;
}

/**
 * Panels listening to the host-side scanner. Kept here rather than in
 * serial-host.js so that module stays about the device and knows nothing about
 * HTTP.
 */
/**
 * Is the browser making this request on the same machine as this process?
 *
 * Everything lib/serial-check.js and lib/serial-host.js report — /dev nodes,
 * /sys USB devices, port permissions — describes THIS machine. That is the
 * operator's machine only when the panel is opened on localhost. Behind nginx
 * on a public name (qr.tooscore.ir) the scanner is plugged into the operator's
 * own computer and the server can see nothing, so the panel must fall back to
 * Web Serial in the browser rather than report "no scanner plugged in".
 *
 * nginx always connects from 127.0.0.1, so the socket address alone is not
 * enough: a forwarded request is remote unless the forwarded chain is loopback
 * too (which is what a real localhost visit through the proxy looks like).
 */
function isLocalClient(req) {
  const loopback = (ip) => !ip ? false
    : /^(::1|::ffff:127\.|127\.)/.test(String(ip).trim());
  if (!loopback(req.socket.remoteAddress)) return false;
  const fwd = req.headers['x-forwarded-for'];
  if (!fwd) return true;
  return String(fwd).split(',').every(loopback);
}

const hostClients = new Set();

function hostSend(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
  catch { /* client vanished; its close handler removes it */ }
}

function hostBroadcast(event, data) {
  for (const res of hostClients) hostSend(res, event, data);
}

serialHost.on('scan', (msg) => hostBroadcast('scan', msg));
serialHost.on('status', (st) => hostBroadcast('status', st));

async function handleScanRoute(sub, req, res, url) {
  // GET /scan/serial-check -> why the browser could not open the scanner
  if (sub === 'serial-check' && req.method === 'GET') {
    const local = isLocalClient(req);
    // Remote panel: this machine's /dev says nothing about the operator's
    // scanner. Report it as uninspectable — the same answer Windows gives —
    // so the panel asks for the one-time Web Serial permission instead.
    if (!local) {
      return sendJson(res, 200, {
        ok: true, local, platform: process.platform, devices: [], usb: [], scanners: [],
        status: 'unsupported', fix: null,
        hint: 'پنل از راه دور باز شده است، بنابراین سرور نمی‌تواند بارکدخوان این کامپیوتر را ببیند. یک بار دکمه «اتصال» را بزنید و دستگاه را در پنجره مرورگر تأیید کنید.',
      });
    }
    return sendJson(res, 200, { ok: true, local, ...serialCheck.inspect() });
  }

  // GET /scan/host -> is the server reading the scanner, and on which device
  if (sub === 'host' && req.method === 'GET') {
    const local = isLocalClient(req);
    // The host reader owns a device on THIS machine; it is only the operator's
    // scanner when the panel is on localhost.
    if (!local) return sendJson(res, 200, { ok: true, local, enabled: false, supported: false, open: false });
    return sendJson(res, 200, { ok: true, local, ...serialHost.status() });
  }

  // GET /scan/host/stream -> SSE: scans read from the device on this machine
  if (sub === 'host/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    hostClients.add(res);
    // Claiming the tty is what this stream is for. Held only while a panel is
    // listening, so a browser using Web Serial on this machine finds the port
    // free — two owners of one tty is not possible, and the browser is the one
    // that cannot be told to wait.
    serialHost.attach();
    hostSend(res, 'ready', serialHost.status());

    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 25000);
    let dropped = false;
    const drop = () => {
      if (dropped) return;             // 'close' and 'error' both fire on a reload
      dropped = true;
      clearInterval(beat);
      hostClients.delete(res);
      serialHost.detach();
    };
    req.on('close', drop);
    req.on('error', drop);
    res.on('error', drop);
    return;
  }

  // POST /scan/host/retry -> look for the device again without waiting for the poll
  if (sub === 'host/retry' && req.method === 'POST') {
    serialHost.retry();
    return sendJson(res, 200, { ok: true, ...serialHost.status() });
  }

  // POST /scan/session -> the panel claims a pairing session
  if (sub === 'session' && req.method === 'POST') {
    const s = relay.createSession();
    return sendJson(res, 200, {
      ok: true, token: s.token, code: s.code,
      urls: phoneUrls().map((u) => `${u}#${s.token}`),
      secure: tlsReady,
    });
  }

  // GET /scan/stream?token=&role=panel|phone -> SSE
  if (sub === 'stream' && req.method === 'GET') {
    const session = relay.findSession(url.searchParams.get('token'));
    if (!session) return sendJson(res, 404, { ok: false, error: 'unknown or expired pairing session' });
    return relay.attach(session, url.searchParams.get('role'), req, res);
  }

  // POST /scan/push { token, text } -> phone hands a decoded QR to the panel
  if (sub === 'push' && req.method === 'POST') {
    const body = await readBody(req);
    const session = relay.findSession(body.token);
    if (!session) return sendJson(res, 404, { ok: false, error: 'unknown or expired pairing session' });
    if (!body.text) return sendJson(res, 400, { ok: false, error: 'text is required' });
    const delivered = relay.pushScan(session, body.text, body.source);
    console.log(`[scan] phone -> ${delivered} panel(s) : ${String(body.text).slice(0, 80).replace(/\s+/g, ' ')}`);
    return sendJson(res, 200, { ok: true, delivered, peers: relay.counts(session) });
  }

  // POST /scan/result { token, ... } -> panel reports the outcome back to the phone
  if (sub === 'result' && req.method === 'POST') {
    const body = await readBody(req);
    const session = relay.findSession(body.token);
    if (!session) return sendJson(res, 404, { ok: false, error: 'unknown or expired pairing session' });
    const { token, ...result } = body;
    relay.pushResult(session, result);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { ok: false, error: 'unknown scan route: ' + sub });
}

// ------------------------------------------------------------- http handler

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname.startsWith('/scan/')) {
      return await handleScanRoute(url.pathname.slice('/scan/'.length), req, res, url);
    }

    // API proxy endpoints under /proxy/<routeName>
    if (url.pathname.startsWith('/proxy/')) {
      const name = url.pathname.slice('/proxy/'.length);
      const route = ROUTES[name];
      if (!route) return sendJson(res, 404, { error: `unknown proxy route: ${name}` });

      // Build payload from query (GET) or JSON body (POST from the browser).
      let payload = {};
      if (req.method === 'POST') {
        payload = await readBody(req);
      } else {
        payload = {
          baseUrl: url.searchParams.get('baseUrl'),
          token: url.searchParams.get('token') || undefined,
          uniqueID: url.searchParams.get('uniqueID') || undefined,
          query: {},
        };
        for (const [k, v] of url.searchParams.entries()) {
          if (!['baseUrl', 'token'].includes(k)) payload.query[k] = v;
        }
      }

      const blocked = guardWrite(route, payload);
      if (blocked) return sendJson(res, 403, { error: blocked });

      try {
        const result = await forward(name, route, payload);
        if (name === 'auth') {
          const b = result.body || {};
          const uname = payload.body?.username;
          const uid = payload.body?.uniqueID;
          if (b && typeof b === 'object' && b.hasError === false && b.content?.token) {
            console.log(`[auth] OK    user=${uname} uniqueID=${uid} name=${b.content?.name}`);
          } else {
            // Never log the password; only the service's own reason.
            const reason = (typeof b.content === 'string' ? b.content : b.message) || `HTTP ${result.status}`;
            console.error(`[auth] FAIL  user=${uname} uniqueID=${uid} status=${result.status} reason=${reason}`);
          }
        }
        if (name === 'createGood') {
          const item = Array.isArray(result.body?.content) ? result.body.content[0] : null;
          console.log(`[good] name=${payload.body?.data?.name} -> ${item ? `[${item.errorCode}] ${item.errorMessage}` : `HTTP ${result.status}`}`);
        }
        return sendJson(res, 200, { ok: true, upstreamStatus: result.status, data: result.body });
      } catch (err) {
        if (name === 'auth') console.error(`[auth] ERROR user=${payload.body?.username} : ${err.message || err}`);
        return sendJson(res, 502, { ok: false, error: String(err.message || err) });
      }
    }

    // GET /label/qr.png?code=&serial=&name=  -> the label QR, for Excel to place
    // on the sheet. Also .svg for anything that prefers vectors, and .json to
    // see exactly what is being encoded. Excel sends three fields; lib/label-qr
    // supplies the rest and does the encoding.
    if (url.pathname.startsWith('/label/qr.')) {
      const format = url.pathname.slice('/label/qr.'.length);
      const q = url.searchParams;
      let label;
      try {
        label = labelQr.buildLabel({ code: q.get('code'), serial: q.get('serial'), name: q.get('name') });
      } catch (err) {
        // Plain text, not JSON: VBA reads the body straight into a MsgBox.
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`این فیلدها خالی هستند: ${(err.missing || []).join('، ')}`);
      }
      const text = JSON.stringify(label);
      console.log(`[label] ${format} code=${label.code} serial=${label.serial} name=${label.name.slice(0, 40)}`);

      if (format === 'json') return sendJson(res, 200, { ok: true, text, data: label });
      if (format === 'svg') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
        return res.end(labelQr.qrSvg(text).svg);
      }
      if (format === 'png') {
        // 10 device pixels per module keeps it crisp when printed small; a
        // caller printing larger can ask for more.
        const scale = Math.min(20, Math.max(2, Number(url.searchParams.get('scale')) || 10));
        const { png } = labelQr.qrPng(text, scale);
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': png.length,
          'Cache-Control': 'no-store',      // the sheet changes between two calls a second apart
        });
        return res.end(png);
      }
      return sendJson(res, 404, { ok: false, error: 'use /label/qr.png, .svg or .json' });
    }

    if (url.pathname === '/config') {
      return sendJson(res, 200, {
        defaults: { baseUrl: ORASH_BASE_URL },
        databases: { test: TEST_DB, prod: PROD_DB },
        allowProdWrite: ALLOW_PROD_WRITE,
        mock: MOCK,
        https: { enabled: tlsReady, port: HTTPS_PORT },
        phoneUrls: phoneUrls(),
        hostScanner: { enabled: serialHost.enabled, supported: serialHost.supported },
      });
    }

    // Static files from ./public
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    filePath = path.join(__dirname, 'public', path.normalize(filePath).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(path.join(__dirname, 'public'))) {
      return sendJson(res, 403, { error: 'forbidden' });
    }
    fs.readFile(filePath, (err, content) => {
      if (err) { sendJson(res, 404, { error: 'not found' }); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(content);
    });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ------------------------------------------------------------------- listen

let tlsReady = false;
let tls = null;
if (ENABLE_HTTPS) {
  tls = ensureCert(path.join(__dirname, '.certs'));
  tlsReady = !!tls;
}

const loopbackOnly = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';

http.createServer(handleRequest).listen(PORT, HOST, () => {
  console.log(`Orash panel (HTTP)  http://${loopbackOnly ? '127.0.0.1' : 'localhost'}:${PORT}   [bound to ${HOST}]`);
  if (!loopbackOnly) for (const ip of lanIPv4()) console.log(`                    http://${ip}:${PORT}`);
  if (PUBLIC_URL) console.log(`Public address      ${PUBLIC_URL}   [used for phone pairing]`);
  else if (loopbackOnly) {
    console.warn('[warn] bound to loopback with no PUBLIC_URL — a phone will have no address to pair with.');
  }
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use — the panel is probably already running.`);
    console.error(`Open http://localhost:${PORT} , or start this copy on another port: PORT=4174 npm start`);
    process.exit(1);
  }
  throw err;
});

if (tlsReady) {
  https.createServer({ key: tls.key, cert: tls.cert }, handleRequest).listen(HTTPS_PORT, HOST, () => {
    console.log(`Orash panel (HTTPS) https://localhost:${HTTPS_PORT}   [phone scanner]`);
    for (const ip of lanIPv4()) console.log(`                    https://${ip}:${HTTPS_PORT}`);
    console.log(`  certificate: ${tls.source}${tls.generated ? ' (newly generated)' : ''} — self-signed, expect a browser warning`);
  }).on('error', (err) => {
    console.error(`[tls] HTTPS listener failed on :${HTTPS_PORT} — ${err.message}`);
  });
} else if (ENABLE_HTTPS) {
  console.log('[tls] no certificate (openssl not found?) — phone camera scanning needs HTTPS.');
  console.log('      Install openssl, or set TLS_KEY/TLS_CERT, or run the phone page on a trusted origin.');
}

// The scanner is read on demand, not at boot: the device is opened only while
// a panel is listening on /scan/host/stream. Holding it here permanently would
// block Web Serial in a browser on this same machine, which is the only path a
// remotely opened panel has.
if (serialHost.enabled) {
  console.log('Scanner (host)      ready — the device is opened while a panel is listening');
} else if (!serialHost.supported) {
  console.log('Scanner (host)      not supported on this platform — the panel will use Web Serial');
} else {
  console.log('Scanner (host)      disabled (SERIAL_HOST=0) — the panel will use Web Serial');
}

if (envFile.file) console.log(`Config              ${envFile.file}  (${envFile.loaded.length} vars)`);
console.log(`Test DB  (Orash3): ${TEST_DB}`);
console.log(`Prod DB  (Orash) : ${PROD_DB}  [writes ${ALLOW_PROD_WRITE ? 'ALLOWED' : 'BLOCKED'}]`);
if (MOCK) console.log('MOCK=1 — requests are answered by the built-in simulator, nothing reaches Orash.');
