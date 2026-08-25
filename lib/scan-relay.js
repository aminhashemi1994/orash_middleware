'use strict';

/**
 * Phone -> panel scan relay.
 *
 * The desktop panel owns the Orash session (token, selected database, form
 * defaults). A phone must therefore not submit on its own; it only forwards the
 * decoded QR text to the panel, which runs the exact same pipeline it uses for
 * the USB scanner. Transport is Server-Sent Events, so no extra dependency.
 *
 * A session is a short-lived pairing between one panel and any number of
 * phones, addressed by an unguessable token (delivered by QR code) plus a
 * 6-digit code for typing by hand.
 */

const crypto = require('crypto');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;   // matches the Orash token lifetime
const HEARTBEAT_MS = 25 * 1000;               // keeps proxies from closing the SSE stream

/** @type {Map<string, {token:string, code:string, createdAt:number, clients:Set<object>}>} */
const sessions = new Map();

function newToken() { return crypto.randomBytes(16).toString('hex'); }

function newCode() {
  let code;
  do { code = String(crypto.randomInt(100000, 1000000)); }
  while ([...sessions.values()].some((s) => s.code === code));
  return code;
}

function sweep() {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      for (const c of s.clients) { try { c.res.end(); } catch { /* already gone */ } }
      sessions.delete(token);
    }
  }
}

function createSession() {
  sweep();
  const token = newToken();
  const session = { token, code: newCode(), createdAt: Date.now(), clients: new Set() };
  sessions.set(token, session);
  return session;
}

/** Look a session up by token, or by the 6-digit pairing code. */
function findSession(tokenOrCode) {
  if (!tokenOrCode) return null;
  const s = sessions.get(tokenOrCode);
  if (s) return s;
  return [...sessions.values()].find((x) => x.code === tokenOrCode) || null;
}

function counts(session) {
  let panel = 0, phone = 0;
  for (const c of session.clients) { if (c.role === 'phone') phone++; else panel++; }
  return { panel, phone };
}

function send(client, event, data) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch { /* client vanished; the close handler cleans up */ }
}

/** Broadcast to every client of a session whose role is in `roles`. */
function broadcast(session, roles, event, data) {
  let n = 0;
  for (const c of session.clients) {
    if (roles.includes(c.role)) { send(c, event, data); n++; }
  }
  return n;
}

function announcePeers(session) {
  broadcast(session, ['panel', 'phone'], 'peers', counts(session));
}

/** Attach an SSE stream to a session. Returns false when the token is unknown. */
function attach(session, role, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const client = { role: role === 'phone' ? 'phone' : 'panel', res };
  session.clients.add(client);

  send(client, 'ready', { role: client.role, code: session.code, peers: counts(session) });
  announcePeers(session);

  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, HEARTBEAT_MS);
  const drop = () => {
    clearInterval(beat);
    if (session.clients.delete(client)) announcePeers(session);
  };
  req.on('close', drop);
  req.on('error', drop);
  res.on('error', drop);
  return true;
}

/** Phone -> panel. Returns the number of panels that received it. */
function pushScan(session, text, source) {
  return broadcast(session, ['panel'], 'scan', {
    text: String(text),
    source: source || 'phone',
    at: Date.now(),
    id: crypto.randomBytes(6).toString('hex'),
  });
}

/** Panel -> phone: what happened to a scan the phone sent. */
function pushResult(session, result) {
  return broadcast(session, ['phone'], 'result', { ...result, at: Date.now() });
}

module.exports = { createSession, findSession, attach, pushScan, pushResult, counts, sweep, sessions };
