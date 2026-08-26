'use strict';

/**
 * ScanSources - the ways a QR code can reach the panel.
 *
 * All four sources emit the same event, `scan` with `{ text, source }`, so the
 * rest of the app never cares where a code came from:
 *
 *   host      The same USB scanner, but read by the panel server and forwarded
 *            over SSE. Preferred on desktop: it needs no browser permission, so
 *            it survives a browser restart, which the Web Serial grant does not
 *            for devices without a USB serial number. Linux/macOS server only.
 *   serial   Web Serial API. Covers the Datalogic Gryphon in "RS-232 emulation"
 *            mode, which enumerates as a CDC device: /dev/ttyACM* on Linux, a
 *            COM port on Windows 10/11, /dev/cu.usbmodem* on macOS. Chrome and
 *            Edge 89+ expose it identically on every desktop OS. Used when the
 *            server cannot read the device itself (Windows, SERIAL_HOST=0).
 *   keyboard  Keyboard-wedge (HID) scanners, which "type" the code. Works in
 *            every browser on every OS with no driver and no permission, so it
 *            is the fallback when Web Serial is unavailable (e.g. Firefox).
 *   camera    getUserMedia + BarcodeDetector, with a bundled jsQR fallback for
 *            browsers that lack the Shape Detection API. Needs a secure context.
 *   phone     Server-Sent Events from the pairing relay (see lib/scan-relay.js).
 *
 * Nothing here touches the DOM beyond the <video> element the camera needs.
 */
(function (global) {

  const GRYPHON_VENDOR_ID = 0x05f9;   // PSC Scanning / Datalogic

  // Idle-gap framing for scanners configured without a suffix. 400ms comfortably
  // clears the inter-chunk gaps seen at 9600 baud; a payload still open after
  // 3s is treated as all that is coming.
  const IDLE_FLUSH_MS = 400;
  const TRUNCATED_WAIT_MS = 3000;

  /** Minimal event emitter shared by every source. */
  function emitter() {
    const handlers = {};
    return {
      on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return this; },
      emit(evt, payload) { for (const fn of handlers[evt] || []) { try { fn(payload); } catch (e) { console.error('[scan]', evt, e); } } },
    };
  }

  /** Suppress the repeats a scanner fires when a code stays in view. */
  function deduper(windowMs) {
    let last = '', lastAt = 0;
    return (text) => {
      const now = Date.now();
      if (text === last && now - lastAt < windowMs) { lastAt = now; return false; }
      last = text; lastAt = now;
      return true;
    };
  }

  // ------------------------------------------------------------------ serial

  const serial = Object.assign(emitter(), {
    name: 'serial',
    supported: typeof navigator !== 'undefined' && 'serial' in navigator,
    port: null,
    baudRate: 9600,          // Gryphon RS-232 factory default
    connected: false,
    _keepReading: false,
    _reader: null,
    _dedupe: deduper(300),

    /** Ports the user already granted; lets us reconnect without a click. */
    async grantedPorts() {
      if (!this.supported) return [];
      try { return await navigator.serial.getPorts(); } catch { return []; }
    },

    /** Prompts the browser's device picker. Must be called from a user gesture. */
    async choosePort({ anyDevice = false } = {}) {
      if (!this.supported) throw new Error('این مرورگر از Web Serial پشتیبانی نمی‌کند');
      const options = anyDevice ? {} : { filters: [{ usbVendorId: GRYPHON_VENDOR_ID }] };
      return navigator.serial.requestPort(options);
    },

    describe(port) {
      const info = port?.getInfo?.() || {};
      if (info.usbVendorId == null) return 'دستگاه سریال';
      const hex = (n) => n.toString(16).padStart(4, '0');
      const known = info.usbVendorId === GRYPHON_VENDOR_ID ? ' (Datalogic Gryphon)' : '';
      return `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId ?? 0)}${known}`;
    },

    async open(port, baudRate) {
      if (this.connected) await this.close();
      this.port = port;
      this.baudRate = baudRate || this.baudRate;
      await port.open({ baudRate: this.baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
      this.connected = true;
      this.emit('status', { state: 'connected', detail: `${this.describe(port)} @ ${this.baudRate} baud` });
      this._readLoop();          // deliberately not awaited: it runs until close()
    },

    async _readLoop() {
      this._keepReading = true;
      // Bytes, not text: the device's encoding is only decidable over a whole
      // payload (ScanCore.decodeScan), and a chunk boundary can fall inside a
      // multi-byte character. Decoding per chunk loses both.
      let buffer = new Uint8Array(0);
      let flushTimer = null;
      const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };

      // Some scanners are configured without a suffix, so also flush on silence.
      // A gap is not the end of a code, though: at 9600 baud a long JSON QR
      // needs hundreds of milliseconds on the wire and arrives in chunks. Wait
      // for the payload to close before flushing, or half of it is reported as
      // a whole scan. IDLE_FLUSH_MS is the gap after a payload that already
      // looks complete; TRUNCATED_WAIT_MS is the ceiling before giving up on
      // the rest ever arriving.
      let waited = 0;
      const flush = () => {
        const text = ScanCore.decodeScan(buffer).trim();
        if (ScanCore.looksTruncated(text) && waited < TRUNCATED_WAIT_MS) {
          waited += IDLE_FLUSH_MS;
          flushTimer = setTimeout(flush, IDLE_FLUSH_MS);
          return;
        }
        waited = 0;
        buffer = new Uint8Array(0);
        if (text && this._dedupe(text)) this.emit('scan', { text, source: 'serial' });
      };

      while (this.port?.readable && this._keepReading) {
        this._reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this._reader.read();
            if (done) break;
            buffer = buffer.length ? concat(buffer, value) : new Uint8Array(value);
            let idx;
            while ((idx = buffer.findIndex((b) => b === 0x0D || b === 0x0A)) !== -1) {
              const line = ScanCore.decodeScan(buffer.subarray(0, idx)).trim();
              buffer = buffer.slice(idx + 1);
              if (line && this._dedupe(line)) this.emit('scan', { text: line, source: 'serial' });
            }
            clearTimeout(flushTimer);
            waited = 0;
            if (buffer) flushTimer = setTimeout(flush, IDLE_FLUSH_MS);
          }
        } catch (err) {
          if (this._keepReading) this.emit('status', { state: 'error', detail: err.message });
        } finally {
          try { this._reader.releaseLock(); } catch { /* already released */ }
          this._reader = null;
        }
      }
      clearTimeout(flushTimer);
    },

    async close() {
      this._keepReading = false;
      try { await this._reader?.cancel(); } catch { /* nothing to cancel */ }
      try { await this.port?.close(); } catch { /* already closed */ }
      this.connected = false;
      this.port = null;
      this.emit('status', { state: 'disconnected', detail: '' });
    },

    /** Reopen a previously granted port, e.g. on page load or after replug. */
    async autoConnect(baudRate) {
      const [port] = await this.grantedPorts();
      if (!port) return false;
      try { await this.open(port, baudRate); return true; }
      catch (err) {
        // The usual cause on Linux: the user is not in the group owning /dev/ttyACM0.
        this.emit('status', { state: 'error', detail: err.message });
        return false;
      }
    },

    watchPlugEvents() {
      if (!this.supported) return;
      navigator.serial.addEventListener('disconnect', (e) => {
        if (e.target === this.port) {
          this.connected = false;
          this.port = null;
          this.emit('status', { state: 'disconnected', detail: 'دستگاه جدا شد' });
        }
      });
      navigator.serial.addEventListener('connect', () => {
        if (!this.connected) this.autoConnect(this.baudRate);
      });
    },
  });

  // ---------------------------------------------------------------- keyboard

  /**
   * Keyboard-wedge scanners type far faster than a person and end with Enter.
   * We watch inter-key timing so ordinary typing in the form is never captured.
   */
  const keyboard = Object.assign(emitter(), {
    name: 'keyboard',
    supported: true,
    enabled: false,
    maxGapMs: 60,        // a human rarely sustains <60ms between keys
    minLength: 4,
    idleFlushMs: 200,    // for scanners configured without a suffix
    _buffer: '',
    _times: [],
    _timer: null,
    _dedupe: deduper(300),

    _reset() { this._buffer = ''; this._times = []; clearTimeout(this._timer); },

    _isFastBurst() {
      if (this._times.length < 2) return false;
      const gaps = this._times.slice(1).map((t, i) => t - this._times[i]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      return avg <= this.maxGapMs;
    },

    _commit() {
      const text = this._buffer.trim();
      const fast = this._isFastBurst();
      this._reset();
      if (!fast || text.length < this.minLength) return false;
      if (this._dedupe(text)) this.emit('scan', { text, source: 'keyboard' });
      return true;
    },

    _onKeyDown(e) {
      if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
      const now = performance.now();
      const gap = this._times.length ? now - this._times[this._times.length - 1] : 0;
      if (gap > 300) this._reset();       // a new burst

      if (e.key === 'Enter' || e.key === 'Tab') {
        // Only swallow the key when this really was a scan.
        if (this._buffer.length >= this.minLength && this._isFastBurst()) {
          e.preventDefault();
          e.stopPropagation();
          this._commit();
        } else {
          this._reset();
        }
        return;
      }
      if (e.key.length !== 1) return;     // arrows, shift, F-keys...

      this._buffer += e.key;
      this._times.push(now);
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        if (this._buffer.length >= 8) this._commit(); else this._reset();
      }, this.idleFlushMs);
    },

    start() {
      if (this._handler) return;
      this._handler = (e) => this._onKeyDown(e);
      // Capture phase: a scanner burst must not be consumed by a focused input.
      document.addEventListener('keydown', this._handler, true);
      this.enabled = true;
      this.emit('status', { state: 'connected', detail: 'در انتظار اسکن' });
    },

    stop() {
      if (this._handler) document.removeEventListener('keydown', this._handler, true);
      this._handler = null;
      this.enabled = false;
      this._reset();
      this.emit('status', { state: 'disconnected', detail: '' });
    },
  });

  // ------------------------------------------------------------------ camera

  const camera = Object.assign(emitter(), {
    name: 'camera',
    running: false,
    stream: null,
    video: null,
    _detector: null,
    _raf: null,
    _canvas: null,
    _dedupe: deduper(1500),

    get secureContext() { return typeof isSecureContext === 'undefined' ? true : isSecureContext; },
    get supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },

    async decoders() {
      // Prefer the browser's native detector; it is much cheaper than jsQR.
      if ('BarcodeDetector' in global) {
        try {
          const formats = await global.BarcodeDetector.getSupportedFormats();
          if (formats.includes('qr_code')) {
            this._detector = new global.BarcodeDetector({ formats: ['qr_code'] });
            return 'BarcodeDetector';
          }
        } catch { /* fall through to jsQR */ }
      }
      return typeof global.jsQR === 'function' ? 'jsQR' : null;
    },

    async listCameras() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter((d) => d.kind === 'videoinput');
      } catch { return []; }
    },

    async start(videoEl, { deviceId } = {}) {
      if (!this.supported) throw new Error('این مرورگر به دوربین دسترسی ندارد');
      if (!this.secureContext) {
        throw new Error('دسترسی به دوربین فقط روی HTTPS یا localhost ممکن است');
      }
      await this.stop();

      const constraints = {
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video = videoEl;
      videoEl.srcObject = this.stream;
      videoEl.setAttribute('playsinline', '');   // iOS refuses to inline-play without it
      await videoEl.play();

      const engine = await this.decoders();
      if (!engine) throw new Error('هیچ رمزگشای QR در دسترس نیست');
      this.running = true;
      this.emit('status', { state: 'connected', detail: 'دوربین روشن است (' + engine + ')' });
      this._tick();
      return engine;
    },

    _frameToImageData() {
      const v = this.video;
      if (!v.videoWidth) return null;
      // Downscale: QR decoding does not need more than ~640px and this keeps
      // the loop cheap enough for a phone.
      const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
      const w = Math.round(v.videoWidth * scale);
      const h = Math.round(v.videoHeight * scale);
      if (!this._canvas) this._canvas = document.createElement('canvas');
      const c = this._canvas;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h);
    },

    /**
     * jsQR hands back an empty `data` when the byte payload is not valid UTF-8
     * — which happens whenever a QR was generated by a tool that wrote Persian
     * text in a legacy code page. Decoding the raw bytes ourselves tells the
     * operator that rather than silently ignoring the code.
     */
    _textFromJsQR(res) {
      if (res.data) return res.data;
      const bytes = Uint8Array.from(res.binaryData || []);
      if (!bytes.length) return null;
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        this.emit('status', {
          state: 'error',
          detail: 'QR خوانده شد ولی متن آن UTF-8 نیست؛ QR را دوباره با کدگذاری UTF-8 بسازید',
        });
        return null;
      }
    },

    async _decodeOnce() {
      if (this._detector) {
        const codes = await this._detector.detect(this.video);
        return codes.length ? codes[0].rawValue : null;
      }
      const img = this._frameToImageData();
      if (!img) return null;
      const res = global.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      return res ? this._textFromJsQR(res) : null;
    },

    _tick() {
      if (!this.running) return;
      const next = () => { this._raf = setTimeout(() => this._tick(), 100); };
      this._decodeOnce()
        .then((text) => {
          if (text && this._dedupe(text)) {
            this.emit('scan', { text, source: 'camera' });
            this.emit('hit', { text });
          }
        })
        .catch((err) => this.emit('status', { state: 'error', detail: err.message }))
        .finally(next);
    },

    /** Torch is only exposed on some Android devices. */
    async toggleTorch(on) {
      const track = this.stream?.getVideoTracks?.()[0];
      if (!track || !('torch' in (track.getCapabilities?.() || {}))) return false;
      await track.applyConstraints({ advanced: [{ torch: !!on }] });
      return true;
    },

    async stop() {
      this.running = false;
      clearTimeout(this._raf);
      for (const t of this.stream?.getTracks?.() || []) t.stop();
      if (this.video) this.video.srcObject = null;
      this.stream = null;
      this.emit('status', { state: 'disconnected', detail: '' });
    },
  });

  // -------------------------------------------------------------------- host

  /**
   * The USB scanner as read by the panel *server* (see lib/serial-host.js).
   *
   * This is the preferred path on a desktop machine. Chrome only remembers a
   * Web Serial grant for USB devices that report a serial number, and handheld
   * scanners usually do not, so the browser path re-prompts on every restart.
   * When the server owns the device there is nothing to grant: the panel just
   * listens, and reconnects on its own if the stream drops.
   */
  const host = Object.assign(emitter(), {
    name: 'host',
    supported: typeof EventSource !== 'undefined',
    available: false,          // server says it is enabled on this platform
    open: false,               // server currently has the device
    info: {},
    _es: null,

    /** One-shot state read, used before deciding which source to show. */
    async probe() {
      try {
        const res = await fetch('/scan/host');
        const json = await res.json();
        if (!json.ok) return null;
        this.available = !!json.enabled;
        this.open = !!json.open;
        this.info = json;
        return json;
      } catch { return null; }
    },

    listen() {
      if (!this.supported || this._es) return;
      this._es = new EventSource('/scan/host/stream');
      const state = (st) => {
        this.info = st;
        this.open = !!st.open;
        this.emit('status', st.open
          ? { state: 'connected', detail: `${st.label || st.device} @ ${st.baud} baud` }
          : { state: st.error ? 'error' : 'disconnected', detail: st.error || '' });
      };
      this._es.addEventListener('ready', (e) => state(JSON.parse(e.data)));
      this._es.addEventListener('status', (e) => state(JSON.parse(e.data)));
      this._es.addEventListener('scan', (e) => {
        const msg = JSON.parse(e.data);
        this.emit('scan', { text: msg.text, source: 'host' });
      });
      // EventSource retries by itself; say nothing unless it stays down.
      this._es.onerror = () => { this.open = false; };
    },

    /** Ask the server to look for the device again. */
    async retry() {
      try {
        const res = await fetch('/scan/host/retry', { method: 'POST' });
        return await res.json();
      } catch { return null; }
    },

    close() { if (this._es) { this._es.close(); this._es = null; } },
  });

  // ------------------------------------------------------------------- phone

  /** Receives scans a paired phone pushes through the server relay. */
  const phone = Object.assign(emitter(), {
    name: 'phone',
    supported: typeof EventSource !== 'undefined',
    token: null,
    code: null,
    urls: [],
    peers: { panel: 0, phone: 0 },
    _es: null,

    /** Ask the server for a pairing session, then listen on it. */
    async pair() {
      const res = await fetch('/scan/session', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'ایجاد نشست ناموفق بود');
      this.token = json.token;
      this.code = json.code;
      this.urls = json.urls;
      this.secure = json.secure;
      this.listen();
      return json;
    },

    listen() {
      this.close();
      this._es = new EventSource(`/scan/stream?role=panel&token=${encodeURIComponent(this.token)}`);
      this._es.addEventListener('ready', (e) => {
        this.peers = JSON.parse(e.data).peers;
        this.emit('status', { state: 'connected', detail: 'آماده اتصال گوشی' });
      });
      this._es.addEventListener('peers', (e) => {
        this.peers = JSON.parse(e.data);
        this.emit('peers', this.peers);
      });
      this._es.addEventListener('scan', (e) => {
        const msg = JSON.parse(e.data);
        this.emit('scan', { text: msg.text, source: 'phone', id: msg.id });
      });
      this._es.onerror = () => this.emit('status', { state: 'error', detail: 'ارتباط قطع شد؛ در حال اتصال دوباره' });
    },

    /** Report an outcome back so the phone can show it next to the scan. */
    async report(result) {
      if (!this.token) return;
      try {
        await fetch('/scan/result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: this.token, ...result }),
        });
      } catch { /* the phone simply misses this update */ }
    },

    close() {
      if (this._es) { this._es.close(); this._es = null; }
    },
  });

  global.ScanSources = { serial, host, keyboard, camera, phone, GRYPHON_VENDOR_ID, deduper };
})(typeof window !== 'undefined' ? window : globalThis);
