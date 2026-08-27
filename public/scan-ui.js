'use strict';

/**
 * Scanner panel for the "ثبت کالا / خدمات" tab.
 *
 * Pipeline, identical for every source (USB serial, keyboard wedge, camera,
 * paired phone):
 *
 *   raw text -> ScanCore.parse -> merge with the form's defaults -> validate
 *            -> queue row -> postGood() -> row shows the service's own answer
 *
 * Loads after app.js and reuses its globals ($, state, postGood, uniqueID...).
 */
(function () {

  const SOURCE_LABELS = {
    serial: 'بارکدخوان USB',
    host: 'بارکدخوان USB (سرور)',
    keyboard: 'بارکدخوان صفحه‌کلیدی',
    camera: 'دوربین',
    phone: 'گوشی',
    manual: 'ورود دستی',
  };

  const scan = {
    queue: [],          // rows shown in the table, newest first
    seq: 0,
    busy: false,        // one CreateGood in flight at a time
    pending: [],        // items waiting for their turn
  };

  // qrcode-generator defaults to a latin1 byte encoder, which mangles every
  // Persian character. Everything we generate is UTF-8.
  if (typeof qrcode === 'function' && qrcode.stringToBytesFuncs['UTF-8']) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  }

  const el = (id) => document.getElementById(id);

  // Auto-submit decides whether a scan reaches the service unattended, so it is
  // a labelled toggle button rather than a checkbox.
  //
  // It is deliberately NOT remembered. Writing to the database unattended is a
  // decision about the batch in front of the operator, not a preference: a
  // toggle left on last week must not silently register today's first scan. So
  // every page load starts at خاموش and the operator turns it on for the run.
  const autoSubmit = () => el('btnAutoSubmit').getAttribute('aria-pressed') === 'true';

  function setAutoSubmit(on) {
    const btn = el('btnAutoSubmit');
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('on', on);
    el('autoSubmitLabel').textContent = on ? 'ثبت خودکار: روشن' : 'ثبت خودکار: خاموش';
    el('autoSubmitHint').textContent = on
      ? 'هر QR بلافاصله اعتبارسنجی و در سرویس ثبت می‌شود.'
      : 'اسکن‌ها در صف می‌مانند؛ برای ارسال، «ثبت» هر ردیف یا «ثبت همه» را بزنید.';
    renderQueue();
  }
  // Off by default on purpose: the form supplies the defaults for fields a QR
  // omits, so writing each scan back into it would let one scanned value (or one
  // bad one) silently change how every later scan is completed.
  const fillForm = () => el('scanFillForm').checked;

  // ------------------------------------------------------------------ status

  /** One call updates both the pill inside a source card and its device chip. */
  function setSourceStatus(source, kind, text) {
    const pill = el('st_' + source);
    if (pill) {
      pill.className = 'pill ' + (kind || '');
      pill.textContent = text;
    }
    const chip = el('dev_' + source);
    if (chip) {
      chip.dataset.state = { good: 'on', busy: 'busy', bad: 'bad' }[kind] || 'off';
      const state = chip.querySelector('.dev-state');
      if (state) {
        state.textContent = text;
        state.title = text;
      }
    }
  }

  function log(kind, title, html) {
    const box = el('scanStatus');
    box.className = 'status ' + kind;
    box.classList.remove('hidden');
    box.innerHTML = `<strong>${title}</strong>${html || ''}`;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ------------------------------------------------------------------- queue

  // status -> [glyph, label, pill kind]
  const STATUS_UI = {
    pending: ['⋯', 'در صف', ''],
    sending: ['', 'در حال ارسال', 'busy'],
    ok:      ['✓', 'ثبت شد', 'good'],
    failed:  ['✗', 'ناموفق', 'bad'],
    invalid: ['!', 'ناقص', 'bad'],
    held:    ['◷', 'آماده ثبت', ''],
  };

  /**
   * Each scan is rendered as a card, not a table row: the fields have very
   * different widths (a code, a long Persian name, a service message), which no
   * shared column grid can hold without something overflowing or misaligning.
   */
  function renderQueue() {
    const body = el('scanQueueBody');
    body.innerHTML = '';

    for (const item of scan.queue) {
      const [glyph, label, kind] = STATUS_UI[item.status] || ['?', item.status, ''];
      const row = document.createElement('article');
      row.className = 'qrow';
      row.dataset.status = item.status;

      row.innerHTML = `
        <div class="q-ring">${glyph}</div>
        <div class="q-main">
          <div class="q-title">
            <span class="q-code">${esc(item.data.code || '—')}</span>
            <span class="q-name">${esc(item.data.name || 'بدون عنوان')}</span>
          </div>
          <div class="q-meta">
            <span>${esc(SOURCE_LABELS[item.source] || item.source)}</span>
            <span class="dot">•</span>
            <span class="mono">${esc(item.at)}</span>
            ${item.message ? `<span class="dot">•</span><span class="q-msg">${esc(item.message)}</span>` : ''}
          </div>
        </div>
        <div class="q-side">
          <span class="pill ${kind}">${esc(label)}</span>
          <div class="q-actions"></div>
        </div>`;

      const actions = row.querySelector('.q-actions');
      const addBtn = (text, title, fn) => {
        const b = document.createElement('button');
        b.className = 'ghost tiny';
        b.textContent = text;
        b.title = title;
        b.addEventListener('click', fn);
        actions.appendChild(b);
      };
      if (item.status === 'held' || item.status === 'failed' || item.status === 'invalid') {
        addBtn('ثبت', 'ارسال به سرویس', () => enqueueSend(item));
      }
      addBtn('در فرم', 'ریختن مقادیر در فرم پیش‌فرض', () => {
        applyGoodToForm(item.data);
        log('busy', 'در فرم قرار گرفت', '<p>مقادیر این ردیف در فرم نوشته شد.</p>');
      });
      addBtn('JSON', 'نمایش داده خام', () => {
        el('scanRawJson').textContent = JSON.stringify({ raw: item.raw, data: item.data }, null, 2);
        el('scanRawWrap').classList.remove('hidden');
        el('scanRawWrap').open = true;
      });
      addBtn('✕', 'حذف', () => {
        scan.queue = scan.queue.filter((x) => x !== item);
        renderQueue();
      });
      body.appendChild(row);
    }

    el('queueEmpty').classList.toggle('hidden', scan.queue.length > 0);
    el('scanCount').textContent = String(scan.queue.length);
    el('scanOkCount').textContent = String(scan.queue.filter((i) => i.status === 'ok').length);
    el('scanBadCount').textContent = String(scan.queue.filter((i) => i.status === 'failed' || i.status === 'invalid').length);

    const waiting = scan.queue.filter((i) => i.status === 'held' || i.status === 'failed').length;
    el('btnScanSendAll').disabled = waiting === 0;
    el('btnScanSendAll').textContent = waiting ? `ثبت ${waiting} ردیف در انتظار` : 'ثبت ردیف‌های در انتظار';
  }

  function nowLabel() {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }

  // ------------------------------------------------------------------ intake

  /** Entry point for every source. */
  function handleScan({ text, source }) {
    const parsed = ScanCore.parse(text);
    beep(parsed.ok);

    if (!parsed.ok) {
      log('bad', 'محتوای اسکن‌شده خوانده نشد', `<p>${esc(parsed.error)}</p><pre>${esc(text.slice(0, 400))}</pre>`);
      ScanSources.phone.report({ ok: false, message: parsed.error, source });
      return;
    }

    const defaults = goodFormDefaults();
    for (const record of parsed.records) {
      // The locked codes win over anything the QR carried: a label printed
      // before they changed must not register a good with the old values.
      const data = applyLockedGoodFields(ScanCore.withDefaults(record.data, defaults));
      const errs = ScanCore.validate(data);
      const item = {
        id: ++scan.seq,
        at: nowLabel(),
        source,
        raw: parsed.raw,
        kind: parsed.kind,
        data,
        notes: [...record.notes, ...(record.unknown.length ? ['فیلدهای ناشناخته نادیده گرفته شد: ' + record.unknown.join(', ')] : [])],
        status: errs.length ? 'invalid' : 'held',
        message: errs.length ? errs.join(' • ') : record.notes.join(' • '),
      };
      scan.queue.unshift(item);
      if (fillForm()) applyGoodToForm(data);

      if (errs.length) {
        log('bad', 'داده ناقص است — ثبت نشد',
          `<p>${esc(errs.join(' • '))}</p><p class="hint">مقادیر پیش‌فرض فرم بالا برای فیلدهای جاافتاده استفاده می‌شوند؛ آن‌ها را پر کنید و دکمه «ثبت» همان ردیف را بزنید.</p>`);
        ScanSources.phone.report({ ok: false, message: errs.join(' • '), name: data.name, source });
      } else if (autoSubmit()) {
        enqueueSend(item);
      } else {
        log('busy', 'اسکن شد — آماده ثبت',
          `<p>${esc(data.name || data.code || '')} در صف قرار گرفت. «ثبت همه» را بزنید یا «ثبت خودکار» را روشن کنید.</p>`);
      }
    }
    renderQueue();
  }

  // ------------------------------------------------------------------ sender

  function canSend() {
    if (!state.token) return 'ابتدا وارد شوید (توکن لازم است)';
    if (!uniqueID()) return 'پایگاه داده انتخاب نشده';
    if (typeof prodWriteBlocked === 'function' && prodWriteBlocked()) return 'ثبت روی پایگاه تولید مسدود است';
    return null;
  }

  function enqueueSend(item) {
    const blocked = canSend();
    if (blocked) {
      item.status = 'invalid';
      item.message = blocked;
      renderQueue();
      log('bad', 'ارسال ممکن نیست', `<p>${esc(blocked)}</p>`);
      return;
    }
    item.status = 'pending';
    if (!scan.pending.includes(item)) scan.pending.push(item);
    renderQueue();
    drainQueue();
  }

  /** Serial sender: the service assigns codes, so parallel writes are risky. */
  async function drainQueue() {
    if (scan.busy) return;
    const item = scan.pending.shift();
    if (!item) return;
    scan.busy = true;
    item.status = 'sending';
    renderQueue();

    try {
      const res = await postGood(item.data);
      item.status = res.ok ? 'ok' : 'failed';
      item.message = res.ok
        ? (res.message || `کد ${res.code}`)
        : (res.message || 'خطای نامشخص');
      if (res.ok && res.code && !item.data.code) item.data.code = res.code;

      log(res.ok ? 'good' : 'bad',
        res.ok ? `ثبت شد ✓ — ${esc(item.data.name || '')}` : `ناموفق ✗ — ${esc(item.data.name || '')}`,
        `<p>${esc(item.message)}</p>${res.httpLine ? `<p class="mono">${esc(res.httpLine)}</p>` : ''}`);

      ScanSources.phone.report({
        ok: res.ok, code: res.code, message: item.message, name: item.data.name, source: item.source,
      });
    } catch (err) {
      item.status = 'failed';
      item.message = err.message;
      log('bad', 'خطا در ارسال', `<p>${esc(err.message)}</p>`);
      ScanSources.phone.report({ ok: false, message: err.message, name: item.data.name, source: item.source });
    } finally {
      scan.busy = false;
      renderQueue();
      if (scan.pending.length) drainQueue();
    }
  }

  function sendAll() {
    for (const item of [...scan.queue].reverse()) {           // oldest first
      if (item.status === 'held' || item.status === 'failed') enqueueSend(item);
    }
  }

  // -------------------------------------------------------------------- beep

  /** Short audio confirmation: the operator is looking at the item, not the screen. */
  let audioCtx = null;
  function beep(ok) {
    if (!el('scanBeep').checked) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = ok ? 880 : 240;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + (ok ? 0.09 : 0.25));
    } catch { /* autoplay policy, no audio device: not worth reporting */ }
  }

  // ------------------------------------------------------------------ serial

  /**
   * Web Serial is a desktop story. On a phone the scanner *is* the camera, so
   * the USB card is hidden rather than shown as unsupported, and nothing tries
   * to open a port. `'serial' in navigator` is already false on mobile Chrome,
   * but that only tells us the API is missing — not that a USB scanner would be
   * the wrong thing to ask for.
   */
  const isHandheld = () =>
    /Android|iPhone|iPad|iPod|IEMobile|BlackBerry|Opera Mini|Mobile Safari/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && !window.matchMedia('(pointer: fine)').matches);

  const serialBaud = () => Number(el('serialBaud').value);

  function serialNotice(kind, html) {
    const p = el('serialNotice');
    if (!p) return;
    p.className = 'hint' + (kind === 'bad' ? ' warn' : '');
    p.innerHTML = html || '';
    p.classList.toggle('hidden', !html);
  }

  /** What the server can see in /dev and /sys. null when it cannot be asked. */
  async function serialProbe() {
    try {
      const res = await fetch('/scan/serial-check');
      const json = await res.json();
      return json && json.ok ? json : null;
    } catch { return null; }
  }

  let lastProbeStatus = null;
  let hidSuggested = false;

  /** Turn a probe result into the card's state, the chip, and (once) a log entry. */
  function reportSerial(info, announce) {
    const status = info?.status || 'unknown';
    const fresh = status !== lastProbeStatus;
    lastProbeStatus = status;
    const say = (kind, title, html) => { if (announce || fresh) log(kind, title, html); };

    const devLine = info?.deviceLabel ? `<p class="hint">${esc(info.deviceLabel)}</p>` : '';
    const fixLine = info?.fix ? `<p>راه حل: <code dir="ltr">${esc(info.fix)}</code></p>` : '';

    switch (status) {
      // The port exists and this user may open it; only the browser's own
      // per-device permission is missing, and that needs a click by design.
      case 'ready':
        setSourceStatus('serial', 'busy', 'نیازمند تأیید یک‌باره');
        serialNotice('', `دستگاه <span class="mono" dir="ltr">${esc(info.port)}</span> آماده است. یک بار دکمه «اتصال» را بزنید و دستگاه را در پنجره مرورگر تأیید کنید؛ از آن پس در هر بار باز شدن صفحه خودکار وصل می‌شود.`);
        say('busy', 'بارکدخوان پیدا شد — یک بار تأیید لازم است',
          `<p>مرورگر اجازه باز کردن پورت را فقط با تأیید کاربر می‌دهد. دکمه «اتصال» را بزنید.</p>${devLine}`);
        break;

      // Windows: the OS hands COM ports to the logged-in user, so there is
      // nothing to inspect and no way to tell "unplugged" from "not granted".
      case 'unsupported':
        setSourceStatus('serial', 'busy', 'نیازمند تأیید یک‌باره');
        serialNotice('', 'اگر بارکدخوان به USB وصل است، یک بار دکمه «اتصال» را بزنید و آن را در پنجره مرورگر تأیید کنید؛ از آن پس خودکار وصل می‌شود.');
        say('busy', 'یک بار تأیید دستگاه لازم است', `<p>${esc(info.hint || '')}</p>`);
        break;

      case 'hid-mode':
        setSourceStatus('serial', 'bad', 'در حالت صفحه‌کلید');
        serialNotice('bad', esc(info.hint));
        say('bad', 'بارکدخوان در حالت سریال نیست', `<p>${esc(info.hint)}</p>`);
        // It is plugged in and it does type, so the keyboard-wedge source is the
        // one that can actually read it — switch to it instead of stopping here.
        if (!hidSuggested && !ScanSources.keyboard.enabled) {
          hidSuggested = true;
          el('kbEnabled').checked = true;
          ScanSources.keyboard.start();
        }
        break;

      case 'no-permission':
      case 'needs-relogin':
        setSourceStatus('serial', 'bad', 'بدون دسترسی به پورت');
        serialNotice('bad', esc(info.hint));
        say('bad', 'دسترسی به پورت بارکدخوان وجود ندارد', `<p>${esc(info.hint)}</p>${fixLine}`);
        break;

      case 'no-device':
        setSourceStatus('serial', 'bad', 'دستگاه متصل نیست');
        serialNotice('bad', 'بارکدخوان به USB متصل نیست. دستگاه را وصل کنید؛ اتصال خودکار انجام می‌شود.');
        say('bad', 'بارکدخوان متصل نیست',
          '<p>هیچ دستگاه بارکدخوانی روی USB این کامپیوتر پیدا نشد. کابل را وصل کنید — پنل خودش دستگاه را می‌بیند و وصل می‌شود.</p>'
          + '<p class="hint">برای اسکن بدون بارکدخوان می‌توانید از دوربین همین کامپیوتر یا از گوشی استفاده کنید.</p>');
        break;

      default:
        setSourceStatus('serial', 'bad', 'متصل نیست');
        serialNotice('bad', 'وضعیت دستگاه مشخص نشد؛ دکمه «اتصال» را بزنید.');
        break;
    }
  }

  // -------------------------------------------------- host-side serial bridge

  /**
   * Preferred path for the USB scanner: the panel server holds the device and
   * streams scans here (lib/serial-host.js).
   *
   * The reason is a Chrome rule, not a preference. A Web Serial grant is only
   * remembered for USB devices that report a serial number; handheld scanners
   * generally do not, so the browser cannot recognise the same device after a
   * relaunch and asks the operator to pick the port again — every single time.
   * requestPort() must be behind a user gesture, so no page can avoid that.
   * When the server owns the device there is no permission to grant and nothing
   * to click, on this or any later start.
   */
  let hostMode = false;

  function reportHost(st) {
    const label = st.label || st.device || st.deviceLabel || 'بارکدخوان';

    if (st.open) {
      setSourceStatus('serial', 'good', `متصل — ${label}`);
      serialNotice('', `دستگاه <span class="mono" dir="ltr">${esc(st.device || '')}</span> روی سرور باز است و اسکن‌ها مستقیم به این صفحه می‌رسند. مرورگر هیچ اجازه‌ای لازم ندارد، بنابراین با بستن و باز کردن مرورگر دوباره سؤال نمی‌شود.`);
      return;
    }

    const fixLine = st.fix ? `<p>راه حل: <code dir="ltr">${esc(st.fix)}</code></p>` : '';

    switch (st.presence) {
      case 'no-device':
        setSourceStatus('serial', 'bad', 'دستگاه متصل نیست');
        serialNotice('bad', 'بارکدخوان به USB متصل نیست. دستگاه را وصل کنید؛ سرور خودش آن را می‌بیند و باز می‌کند.');
        break;

      case 'hid-mode':
        setSourceStatus('serial', 'bad', 'در حالت صفحه‌کلید');
        serialNotice('bad', esc(st.hint || ''));
        if (!hidSuggested && !ScanSources.keyboard.enabled) {
          hidSuggested = true;
          el('kbEnabled').checked = true;
          ScanSources.keyboard.start();
        }
        break;

      case 'no-permission':
      case 'needs-relogin':
        setSourceStatus('serial', 'bad', 'بدون دسترسی به پورت');
        serialNotice('bad', esc(st.hint || ''));
        log('bad', 'سرور به پورت بارکدخوان دسترسی ندارد', `<p>${esc(st.hint || '')}</p>${fixLine}`);
        break;

      default:
        setSourceStatus('serial', st.error ? 'bad' : '', st.error ? 'خطا' : 'در انتظار دستگاه');
        serialNotice(st.error ? 'bad' : '', esc(st.error || st.hint || 'در انتظار دستگاه…'));
        break;
    }
  }

  /** Switch the card over to the host bridge and start listening. */
  function useHostBridge(st) {
    hostMode = true;
    el('serialBrowserFoot').classList.add('hidden');
    el('serialHostFoot').classList.remove('hidden');
    ScanSources.host.on('scan', handleScan);
    ScanSources.host.on('status', () => reportHost(ScanSources.host.info));
    ScanSources.host.listen();
    reportHost(st);
  }

  /**
   * Connect to the scanner without a click when that is possible.
   *
   * Web Serial only hands back ports the user has already approved for this
   * origin, and requestPort() requires a user gesture — so a scanner seen for
   * the first time still needs one click, after which every later page load
   * reconnects on its own. When no port can be opened, the server tells us why:
   * nothing plugged in (an error the operator must fix), a device in
   * keyboard mode, missing permissions, or simply no browser grant yet.
   */
  async function serialSync({ announce = false } = {}) {
    const S = ScanSources.serial;
    if (!S.supported || S.connected) return null;

    // Only on the first pass: the background watcher must not make the pill
    // flicker through "checking…" every few seconds.
    if (lastProbeStatus === null) setSourceStatus('serial', 'busy', 'در حال بررسی دستگاه…');
    if (await S.autoConnect(serialBaud())) {
      lastProbeStatus = 'connected';
      serialNotice('', '');
      return 'connected';                 // the 'status' event already reported it
    }

    const info = await serialProbe();
    reportSerial(info, announce);
    return info?.status || 'unknown';
  }

  /**
   * A scanner plugged in later must not require a reload. Web Serial's own
   * `connect` event only fires for devices this origin already has permission
   * for, so polling the server is what covers a first-time device.
   */
  function watchSerialPresence() {
    setInterval(() => {
      if (document.hidden || hostMode || ScanSources.serial.connected) return;
      serialSync();                        // only logs when the situation changed
    }, 6000);
  }

  /**
   * Decide how this machine reads the USB scanner, once, after login.
   * Server-side first; Web Serial whenever the server cannot do it (Windows,
   * SERIAL_HOST=0, or — the common case on a hosted deployment — no scanner on
   * the server at all).
   */
  async function startScannerSource() {
    const st = await ScanSources.host.probe();
    // `enabled` only says the server *would* read a device: it is true on any
    // Linux/macOS host, including one reached over the network with the scanner
    // plugged into the operator's own machine. Take the host path only when a
    // device is actually there, or the browser path never runs and the operator
    // is never asked for the one-time Web Serial permission.
    const hostHasDevice = !!st && (st.open || st.presence === 'ready');
    // `busy` means the port exists but another program holds it — ModemManager,
    // or a browser tab that already owns it through Web Serial. The server
    // cannot take it, so the browser path is the one that can still work.
    if (st && st.enabled && !st.busy && hostHasDevice) { useHostBridge(st); return; }

    if (st && st.busy) {
      log('busy', 'سرور نتوانست بارکدخوان را در اختیار بگیرد',
        `<p>${esc(st.error || '')}</p><p class="hint">اتصال از طریق مرورگر امتحان می‌شود. برای اینکه اتصال همیشه خودکار باشد، دستور زیر را یک بار اجرا کنید:</p>`
        + '<p><code dir="ltr">sudo ./scripts/linux-serial-access.sh</code></p>');
    }

    if (!ScanSources.serial.supported) {
      el('btnSerialConnect').disabled = true;
      el('btnSerialAny').disabled = true;
      setSourceStatus('serial', 'bad', 'در این مرورگر پشتیبانی نمی‌شود');
      serialNotice('bad', 'Web Serial در این مرورگر نیست و سرور هم دستگاه را نمی‌خواند. از Chrome یا Edge ۸۹+ استفاده کنید، یا بارکدخوان را در حالت صفحه‌کلید (HID) بگذارید.');
      return;
    }
    ScanSources.serial.watchPlugEvents();
    serialSync({ announce: false });
    watchSerialPresence();
  }

  async function serialConnect(anyDevice) {
    const S = ScanSources.serial;
    if (!S.supported) {
      log('bad', 'Web Serial پشتیبانی نمی‌شود',
        '<p>این مرورگر از Web Serial پشتیبانی نمی‌کند. از Chrome یا Edge نسخه ۸۹ به بالا استفاده کنید، یا بارکدخوان را در حالت صفحه‌کلید (HID) بگذارید و گزینه «بارکدخوان صفحه‌کلیدی» را روشن کنید.</p>');
      return;
    }
    try {
      setSourceStatus('serial', 'busy', 'در حال اتصال…');
      const port = await S.choosePort({ anyDevice });
      await S.open(port, serialBaud());
      lastProbeStatus = 'connected';
      serialNotice('', '');
      log('good', 'بارکدخوان متصل شد', '<p>از این پس در هر بار باز شدن صفحه خودکار وصل می‌شود.</p>');
    } catch (err) {
      // NotFoundError just means the user dismissed the browser's device picker.
      if (err.name === 'NotFoundError') {
        lastProbeStatus = null;
        serialSync();                      // put the card back to what is really there
        return;
      }
      setSourceStatus('serial', 'bad', 'اتصال ناموفق');
      // Chrome only ever says "Failed to open serial port", so ask the server —
      // it runs as the same user and can see the actual device permissions.
      log('bad', 'اتصال به بارکدخوان ناموفق بود', `<p>${esc(err.message)}</p><p class="hint">در حال بررسی علت…</p>`);
      const detail = await diagnoseSerial();
      log('bad', 'اتصال به بارکدخوان ناموفق بود', `<p>${esc(err.message)}</p>${detail}`);
    }
  }

  /** Turns the server's device inspection into an actionable message. */
  async function diagnoseSerial() {
    let info;
    try {
      const res = await fetch('/scan/serial-check');
      info = await res.json();
    } catch {
      return '';
    }
    if (!info.hint) return '';

    const devices = (info.devices || [])
      .map((d) => `${d.label || d.path} — ${d.path} (${d.group || '?'} ${d.mode || ''}) ${d.accessible ? '✓ قابل دسترسی' : '✗ بدون دسترسی'}`)
      .join('<br>');

    return `<p><b>علت:</b> ${esc(info.hint)}</p>`
      + (info.fix ? `<p>راه حل: <code dir="ltr">${esc(info.fix)}</code></p>` : '')
      + (info.needsRelogin ? '<p class="hint">تا وقتی از حساب خارج و دوباره وارد نشوید، مرورگر همچنان نمی‌تواند پورت را باز کند.</p>' : '')
      + (devices ? `<p class="hint">${devices}</p>` : '');
  }

  // ------------------------------------------------------------------ camera

  async function cameraStart() {
    const C = ScanSources.camera;
    try {
      setSourceStatus('camera', 'busy', 'در حال روشن شدن…');
      el('cameraWrap').classList.remove('hidden');
      el('cameraIdle').classList.add('hidden');
      const engine = await C.start(el('scanVideo'), { deviceId: el('cameraSelect').value || undefined });
      const cams = await C.listCameras();
      const sel = el('cameraSelect');
      if (cams.length && sel.options.length <= 1) {
        sel.innerHTML = '';
        cams.forEach((c, i) => {
          const o = document.createElement('option');
          o.value = c.deviceId;
          o.textContent = c.label || `دوربین ${i + 1}`;
          sel.appendChild(o);
        });
      }
      log('good', 'دوربین روشن شد', `<p>موتور رمزگشایی: ${esc(engine)}</p>`);
    } catch (err) {
      el('cameraWrap').classList.add('hidden');
      el('cameraIdle').classList.remove('hidden');
      setSourceStatus('camera', 'bad', 'خطا');
      const insecure = !window.isSecureContext;
      const hint = insecure
        ? `<p class="hint">این صفحه روی HTTP باز شده است و مرورگر اجازه دوربین نمی‌دهد. همین صفحه را روی نشانی HTTPS باز کنید${state.config?.https?.enabled ? ` (پورت ${state.config.https.port})` : ''} یا از localhost استفاده کنید.</p>`
        : '';
      log('bad', 'دوربین باز نشد', `<p>${esc(err.message)}</p>${hint}`);
    }
  }

  async function cameraStop() {
    await ScanSources.camera.stop();
    el('cameraWrap').classList.add('hidden');
    el('cameraIdle').classList.remove('hidden');
  }

  // ------------------------------------------------------------------- phone

  function renderPairing(session) {
    el('pairWrap').classList.remove('hidden');
    el('pairCode').textContent = session.code;

    // Prefer an HTTPS url: the phone camera will not open without it.
    const url = session.urls.find((u) => u.startsWith('https://')) || session.urls[0] || '';
    el('pairUrl').textContent = url;
    el('pairUrl').href = url;

    const canvas = el('pairQr');
    try {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      const cells = qr.getModuleCount();
      const size = 4;
      const quiet = 4;
      canvas.width = canvas.height = (cells + quiet * 2) * size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
          if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * size, (r + quiet) * size, size, size);
        }
      }
    } catch (err) {
      console.error('[pair] qr render failed', err);
    }

    if (!session.secure) {
      el('pairWarn').classList.remove('hidden');
    } else {
      el('pairWarn').classList.add('hidden');
    }
  }

  async function startPairing() {
    try {
      setSourceStatus('phone', 'busy', 'در حال آماده‌سازی…');
      const session = await ScanSources.phone.pair();
      renderPairing(session);
      setSourceStatus('phone', '', 'در انتظار گوشی');
    } catch (err) {
      setSourceStatus('phone', 'bad', 'خطا');
      log('bad', 'اتصال گوشی ناموفق بود', `<p>${esc(err.message)}</p>`);
    }
  }

  // --------------------------------------------------------- sample QR maker

  /** Renders the form's current values as a QR code, for testing the whole path. */
  function renderSampleQr() {
    const data = goodFormDefaults();
    const text = JSON.stringify(data);
    el('sampleJson').textContent = JSON.stringify(data, null, 2);
    el('sampleWrap').classList.remove('hidden');
    const canvas = el('sampleQr');
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text, 'Byte');
      qr.make();
      const cells = qr.getModuleCount();
      const size = Math.max(2, Math.floor(300 / cells));
      const quiet = 4;
      canvas.width = canvas.height = (cells + quiet * 2) * size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
          if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * size, (r + quiet) * size, size, size);
        }
      }
      el('sampleHint').textContent = `${text.length} کاراکتر`;
    } catch (err) {
      el('sampleHint').textContent = 'ساخت QR ناموفق بود: ' + err.message + ' (داده‌ها را کوتاه‌تر کنید)';
    }
  }

  // ---------------------------------------------------------------- wiring up

  /** Called by app.js whenever login/database state changes. */
  window.onPanelStateChanged = function onPanelStateChanged() {
    const blocked = canSend();
    const pill = el('scanGate');
    if (!pill) return;
    if (blocked) {
      pill.className = 'pill bad';
      pill.textContent = blocked;
    } else {
      pill.className = 'pill good';
      pill.textContent = 'آماده ثبت';
    }
    renderQueue();
  };

  window.addEventListener('DOMContentLoaded', () => {
    // --- sources -> one handler
    for (const src of ['serial', 'keyboard', 'camera', 'phone']) {
      ScanSources[src].on('scan', handleScan);
      ScanSources[src].on('status', ({ state: st, detail }) => {
        const kind = st === 'connected' ? 'good' : st === 'error' ? 'bad' : '';
        const label = { connected: detail || 'متصل', disconnected: 'متصل نیست', error: detail }[st] || detail;
        setSourceStatus(src, kind, label);
      });
    }
    ScanSources.phone.on('peers', (p) => {
      setSourceStatus('phone', p.phone ? 'good' : '', p.phone ? `${p.phone} گوشی متصل` : 'در انتظار گوشی');
    });
    ScanSources.camera.on('hit', () => {
      const flash = el('cameraFlash');
      flash.classList.add('on');
      setTimeout(() => flash.classList.remove('on'), 180);
    });

    // --- serial
    el('btnSerialConnect').addEventListener('click', () => serialConnect(false));
    el('btnSerialAny').addEventListener('click', () => serialConnect(true));
    el('btnSerialDisconnect').addEventListener('click', () => {
      lastProbeStatus = 'connected';       // keep the watcher from re-announcing
      ScanSources.serial.close();
      serialNotice('', '');
    });
    // Auto-connect picks 9600; a device programmed differently must be able to
    // change speed without hunting for the disconnect button first.
    el('serialBaud').addEventListener('change', () => {
      const S = ScanSources.serial;
      if (!S.connected || !S.port) return;
      S.open(S.port, serialBaud()).catch((err) => {
        setSourceStatus('serial', 'bad', 'اتصال ناموفق');
        log('bad', 'تغییر سرعت ناموفق بود', `<p>${esc(err.message)}</p>`);
      });
    });

    el('btnSerialRetry').addEventListener('click', async () => {
      setSourceStatus('serial', 'busy', 'در حال جست‌وجو…');
      const st = await ScanSources.host.retry();
      if (st) reportHost(st);
    });

    if (isHandheld()) {
      // A phone scans with its camera; there is no USB device to attach.
      el('tile_serial')?.classList.add('hidden');
      el('dev_serial')?.classList.add('hidden');
    } else {
      // Wait for the login gate: the scanner is only useful once there is a
      // session to submit into, and its messages belong on the dashboard, not
      // behind it.
      if (document.body.dataset.entered === '1') startScannerSource();
      else document.addEventListener('orash:entered', startScannerSource, { once: true });
    }

    // --- keyboard wedge
    el('kbEnabled').addEventListener('change', (e) => {
      if (e.target.checked) ScanSources.keyboard.start(); else ScanSources.keyboard.stop();
    });

    // --- camera
    el('btnCameraStart').addEventListener('click', cameraStart);
    el('btnCameraStop').addEventListener('click', cameraStop);
    el('cameraSelect').addEventListener('change', () => { if (ScanSources.camera.running) cameraStart(); });
    if (!ScanSources.camera.supported) setSourceStatus('camera', 'bad', 'دوربین در دسترس نیست');
    else if (!window.isSecureContext) setSourceStatus('camera', '', 'نیازمند HTTPS');

    // --- phone
    el('btnPair').addEventListener('click', startPairing);

    // --- manual paste
    el('btnManualScan').addEventListener('click', () => {
      const text = el('manualInput').value.trim();
      if (!text) return;
      handleScan({ text, source: 'manual' });
      el('manualInput').value = '';
    });

    // --- auto-submit toggle
    el('btnAutoSubmit').addEventListener('click', () => setAutoSubmit(!autoSubmit()));
    // Always off at load. See the note on the toggle above: this is a decision
    // per batch, not a saved preference, so a stale "on" cannot come back.
    setAutoSubmit(false);
    // Drop the value earlier versions stored, so it cannot surprise anyone.
    try { localStorage.removeItem('orash.scan.autoSubmit'); } catch { /* private mode */ }

    // --- queue controls
    el('btnScanSendAll').addEventListener('click', sendAll);
    el('btnScanClear').addEventListener('click', () => {
      scan.queue = scan.queue.filter((i) => i.status === 'sending' || i.status === 'pending');
      renderQueue();
    });

    // --- sample QR
    el('btnSampleQr').addEventListener('click', renderSampleQr);

    renderQueue();
    window.onPanelStateChanged();
  });

  // Exposed for debugging from the console.
  window.ScanPanel = { scan, handleScan, renderQueue };
})();
