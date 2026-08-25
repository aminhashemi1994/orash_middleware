'use strict';

/**
 * Phone scanner page.
 *
 * The phone never talks to Orash: it decodes a QR and posts the text to
 * /scan/push, and the paired desktop panel — which holds the login token, the
 * selected database and the form defaults — performs the CreateGood call and
 * pushes the outcome back here over SSE. That keeps one queue and one audit
 * trail on the panel, and keeps credentials off the phone.
 *
 * The pairing token arrives in the URL fragment (never sent to the server as
 * part of a request line) or is typed as the 6-digit code shown by the panel.
 */

const el = (id) => document.getElementById(id);
const camera = ScanSources.camera;

const link = {
  token: null,
  es: null,
  connected: false,
};

function setState(kind, text) {
  const pill = el('linkState');
  pill.className = 'pill ' + (kind || '');
  pill.textContent = text;
}

function historyItem(text, kind, detail) {
  const li = document.createElement('li');
  li.className = kind;
  li.innerHTML = `<span class="h-main"></span><span class="h-detail"></span>`;
  li.querySelector('.h-main').textContent = text;
  li.querySelector('.h-detail').textContent = detail || '';
  el('history').prepend(li);
  while (el('history').children.length > 25) el('history').lastChild.remove();
  return li;
}

function buzz(ok) {
  if (navigator.vibrate) navigator.vibrate(ok ? 60 : [60, 60, 60]);
}

// ---------------------------------------------------------------- connection

function connect(tokenOrCode) {
  link.token = String(tokenOrCode).trim();
  if (link.es) link.es.close();
  setState('busy', 'در حال اتصال…');

  link.es = new EventSource(`/scan/stream?role=phone&token=${encodeURIComponent(link.token)}`);

  link.es.addEventListener('ready', (e) => {
    const info = JSON.parse(e.data);
    link.connected = true;
    // The panel may address us by code; keep the code for display.
    setState(info.peers.panel ? 'good' : 'bad',
      info.peers.panel ? 'متصل به پنل ✓' : 'پنل باز نیست');
    el('pairCard').classList.add('hidden');
    localStorage.setItem('orash.scan.token', link.token);
  });

  link.es.addEventListener('peers', (e) => {
    const p = JSON.parse(e.data);
    setState(p.panel ? 'good' : 'bad', p.panel ? 'متصل به پنل ✓' : 'پنل باز نیست');
  });

  // The panel reports what Orash answered for the code we sent.
  link.es.addEventListener('result', (e) => {
    const r = JSON.parse(e.data);
    buzz(r.ok);
    const label = r.name || r.code || '';
    historyItem(
      (r.ok ? '✓ ' : '✗ ') + (label || 'پاسخ سرویس'),
      r.ok ? 'ok' : 'bad',
      [r.ok && r.code ? 'کد ' + r.code : '', r.message].filter(Boolean).join(' — '),
    );
  });

  link.es.onerror = () => {
    if (!link.connected) {
      setState('bad', 'نشست پیدا نشد — کد را دوباره وارد کنید');
      el('pairCard').classList.remove('hidden');
      link.es.close();
    } else {
      setState('busy', 'اتصال قطع شد؛ تلاش دوباره…');
    }
  };
}

async function push(text) {
  if (!link.token) {
    historyItem('ابتدا به پنل متصل شوید', 'bad', '');
    return;
  }
  // Show what we read even before the panel answers, so the operator can move on.
  const preview = ScanCore.parse(text);
  const first = preview.records[0]?.data || {};
  const li = historyItem('… ' + (first.name || first.code || text.slice(0, 30)), 'pending', 'ارسال شد، در انتظار پاسخ پنل');

  try {
    const res = await fetch('/scan/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: link.token, text, source: 'phone' }),
    });
    const json = await res.json();
    if (!json.ok) {
      li.className = 'bad';
      li.querySelector('.h-detail').textContent = json.error || 'ارسال ناموفق';
      setState('bad', 'نشست منقضی شده — دوباره متصل شوید');
      el('pairCard').classList.remove('hidden');
    } else if (!json.delivered) {
      li.className = 'bad';
      li.querySelector('.h-detail').textContent = 'هیچ پنلی متصل نیست؛ صفحه پنل را باز نگه دارید';
    }
  } catch (err) {
    li.className = 'bad';
    li.querySelector('.h-detail').textContent = err.message;
  }
}

// -------------------------------------------------------------------- camera

async function start() {
  try {
    el('cameraWrap').classList.remove('hidden');
    const engine = await camera.start(el('video'));
    el('cameraHint').textContent = 'QR را در کادر بگیرید (' + engine + ')';
  } catch (err) {
    el('cameraWrap').classList.add('hidden');
    const insecure = !window.isSecureContext;
    el('cameraHint').textContent = insecure
      ? 'مرورگر روی HTTP اجازه دوربین نمی‌دهد. این صفحه را با نشانی https باز کنید (همان QR پنل) و هشدار گواهی را بپذیرید.'
      : err.message;
  }
}

camera.on('scan', ({ text }) => {
  buzz(true);
  const flash = el('flash');
  flash.classList.add('on');
  setTimeout(() => flash.classList.remove('on'), 200);
  push(text);
});

// --------------------------------------------------------------------- wiring

window.addEventListener('DOMContentLoaded', () => {
  el('btnStart').addEventListener('click', start);
  el('btnStop').addEventListener('click', () => {
    camera.stop();
    el('cameraWrap').classList.add('hidden');
  });
  el('btnTorch').addEventListener('click', async () => {
    const ok = await camera.toggleTorch(!camera._torch);
    camera._torch = !camera._torch;
    if (!ok) el('cameraHint').textContent = 'این دستگاه چراغ قابل کنترل ندارد';
  });
  el('btnPair').addEventListener('click', () => {
    const v = el('pairInput').value.trim();
    if (v) connect(v);
  });
  el('btnManual').addEventListener('click', () => {
    const v = el('manualInput').value.trim();
    if (!v) return;
    push(v);
    el('manualInput').value = '';
  });

  // Token from the panel's QR (#<token>), or the last one used on this phone.
  const fragment = location.hash.replace(/^#/, '');
  const remembered = localStorage.getItem('orash.scan.token');
  if (fragment) connect(fragment);
  else if (remembered) connect(remembered);
  else setState('bad', 'متصل نیست');

  if (!window.isSecureContext) {
    el('cameraHint').textContent = 'توجه: این صفحه روی HTTP باز شده و دوربین کار نخواهد کرد. نشانی https پنل را باز کنید.';
  }
});
