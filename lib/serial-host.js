'use strict';

/**
 * Host-side serial scanner: the server reads the device, not the browser.
 *
 * Why this exists. Chrome only remembers a Web Serial grant for a USB device
 * that reports a serial number; for anything else it cannot recognise the same
 * device after a relaunch, so the port picker comes back every time the browser
 * restarts. Most handheld scanners — the Datalogic Gryphon among them — expose
 * no serial number, and no page can suppress that prompt: requestPort() is
 * required to be behind a user gesture.
 *
 * The panel server runs on the same machine as the scanner, so it can own the
 * device instead. It configures the line with `stty`, reads it with a plain
 * `fs` read stream, and hands decoded text to the panel over SSE — the same way
 * a paired phone does. No permission dialog, no per-restart click, and still no
 * dependency: `stty` is part of coreutils and is present anywhere /dev is.
 *
 * Linux and macOS only. On Windows there is no device node to read and the
 * browser path is the only option.
 *
 * Env:
 *   SERIAL_HOST=0        turn this off and use the browser path only
 *   SERIAL_DEVICE=/dev/ttyACM0   pin the device instead of auto-detecting
 *   SERIAL_BAUD=9600     line speed (Gryphon factory default)
 */

const fs = require('fs');
const { EventEmitter } = require('events');
const { execFile } = require('child_process');

const serialCheck = require('./serial-check');
const scanCore = require('../public/scan-core');

const SUPPORTED = process.platform === 'linux' || process.platform === 'darwin';
const ENABLED = process.env.SERIAL_HOST !== '0' && SUPPORTED;
const PINNED = process.env.SERIAL_DEVICE || null;
const BAUD = Number(process.env.SERIAL_BAUD || 9600);

const POLL_MS = 3000;          // how often we look for a device to open
const DEDUPE_MS = 300;         // a scanner repeats while a code stays in view
// Idle-gap framing for devices configured without a suffix. At 9600 baud a
// long JSON QR takes hundreds of milliseconds and arrives in several chunks,
// so a short gap is mid-payload, not the end of a code.
const IDLE_FLUSH_MS = 400;
const TRUNCATED_WAIT_MS = 3000;   // ceiling on waiting for a payload to close

class SerialHost extends EventEmitter {
  constructor() {
    super();
    this.enabled = ENABLED;
    this.supported = SUPPORTED;
    this.baud = BAUD;
    this.device = null;         // path currently open
    this.label = null;
    this.open = false;
    this.busy = false;          // the device exists but another program holds it
    this.error = null;          // last failure, in Persian, for the panel
    this.scans = 0;
    this.lastScanAt = null;
    this._stream = null;
    this._buffer = '';
    this._flushTimer = null;
    this._waited = 0;
    this._last = { text: '', at: 0 };
    this._timer = null;
    this._opening = false;
  }

  status() {
    const probe = this.enabled ? serialCheck.inspect() : null;
    return {
      enabled: this.enabled,
      supported: this.supported,
      open: this.open,
      busy: this.busy,
      device: this.device,
      label: this.label,
      baud: this.baud,
      error: this.error,
      scans: this.scans,
      lastScanAt: this.lastScanAt,
      // The presence check the panel would otherwise have to ask for separately.
      presence: probe ? probe.status : null,
      hint: probe ? probe.hint : null,
      fix: probe ? probe.fix : null,
      deviceLabel: probe ? probe.deviceLabel : null,
    };
  }

  /** Look again now, instead of waiting for the next poll. */
  retry() {
    this.error = null;
    this.busy = false;
    this._tick();
    return this.status();
  }

  /** Start watching for the scanner. Safe to call once at boot. */
  start() {
    if (!this.enabled || this._timer) return this;
    this._timer = setInterval(() => this._tick(), POLL_MS);
    this._timer.unref?.();
    this._tick();
    return this;
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
    this._close();
  }

  /** Which device to read, if any. */
  _pick() {
    if (PINNED) return fs.existsSync(PINNED) ? { path: PINNED, label: PINNED, accessible: true } : null;
    const info = serialCheck.inspect();
    const usable = info.devices.filter((d) => d.accessible);
    // Prefer the one udev names like a scanner; fall back to a lone serial port.
    return usable.find((d) => d.isScanner) || (usable.length === 1 ? usable[0] : null);
  }

  _tick() {
    if (this.open || this._opening) {
      // A device pulled out mid-read does not always error, so check it is there.
      if (this.device && !fs.existsSync(this.device)) {
        this._fail('دستگاه جدا شد');
        this._close();
      }
      return;
    }
    const dev = this._pick();
    if (dev) this._open(dev).catch(() => { /* _fail already reported it */ });
  }

  async _open(dev) {
    this._opening = true;
    try {
      await this._configure(dev.path);
      const stream = fs.createReadStream(dev.path, { flags: 'r', highWaterMark: 256 });

      stream.on('data', (chunk) => this._ingest(chunk));
      stream.on('error', (err) => {
        // EACCES is the common one: the account is not in the port's group.
        this._fail(err.code === 'EACCES'
          ? `دسترسی به ${dev.path} وجود ندارد (${err.code}) — دستور scripts/linux-serial-access.sh را اجرا کنید`
          : `خواندن ${dev.path} ناموفق بود (${err.code || err.message})`);
        this._close();
      });
      stream.on('close', () => { if (this.open) { this._fail('ارتباط با دستگاه بسته شد'); this._close(); } });

      this._stream = stream;
      this.device = dev.path;
      this.label = dev.label || dev.path;
      this.open = true;
      this.error = null;
      this._announce();
      console.log(`[serial] host reader attached to ${dev.path} @ ${this.baud} baud — ${this.label}`);
    } catch (err) {
      this._fail(err.message);
    } finally {
      this._opening = false;
    }
  }

  /**
   * Put the line in raw mode at the scanner's speed. Without this the tty keeps
   * whatever termios it was left with — canonical mode, echo, a stale baud rate
   * — and the reads either block or come back as mojibake.
   */
  _configure(devPath) {
    const flag = process.platform === 'darwin' ? '-f' : '-F';
    const args = [flag, devPath, String(this.baud),
      'cs8', '-cstopb', '-parenb',     // 8N1
      'raw', '-echo', '-echoe', '-echok', '-crtscts',
      'min', '1', 'time', '0'];
    return new Promise((resolve, reject) => {
      execFile('stty', args, { timeout: 4000 }, (err, _out, stderr) => {
        if (!err) { this.busy = false; return resolve(); }
        const detail = (stderr || err.message).trim().split('\n')[0];
        // The usual holder on a desktop Linux is ModemManager, which probes
        // every CDC-ACM device on plug; a browser tab that already opened the
        // port through Web Serial does the same. Either way this is not our
        // device to take, and the panel should fall back to the browser path.
        if (/busy/i.test(detail)) {
          this.busy = true;
          reject(new Error(`پورت ${devPath} در اختیار برنامه دیگری است. معمولاً ModemManager یا تبی از مرورگر که قبلاً همین پورت را باز کرده است.`));
        } else {
          reject(new Error(`تنظیم پورت ${devPath} ناموفق بود: ${detail}`));
        }
      });
    });
  }

  _ingest(chunk) {
    this._buffer += chunk.toString('utf8');
    let idx;
    while ((idx = this._buffer.search(/[\r\n]/)) !== -1) {
      const line = this._buffer.slice(0, idx).trim();
      this._buffer = this._buffer.slice(idx + 1);
      if (line) this._emitScan(line);
    }
    clearTimeout(this._flushTimer);
    this._waited = 0;
    if (this._buffer) this._armFlush();
  }

  /** Flush on silence, but only once the payload can already be whole. */
  _armFlush() {
    this._flushTimer = setTimeout(() => {
      if (scanCore.looksTruncated(this._buffer) && this._waited < TRUNCATED_WAIT_MS) {
        this._waited += IDLE_FLUSH_MS;
        this._armFlush();
        return;
      }
      this._waited = 0;
      const text = this._buffer.trim();
      this._buffer = '';
      if (text) this._emitScan(text);
    }, IDLE_FLUSH_MS);
    this._flushTimer.unref?.();
  }

  _emitScan(text) {
    const now = Date.now();
    if (text === this._last.text && now - this._last.at < DEDUPE_MS) { this._last.at = now; return; }
    this._last = { text, at: now };
    this.scans++;
    this.lastScanAt = now;
    console.log(`[serial] scan ${this.scans}: ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
    this.emit('scan', { text, source: 'host', at: now });
  }

  _fail(message) {
    if (this.error === message) return;      // do not spam an unchanged failure
    this.error = message;
    console.error('[serial] ' + message);
    this._announce();
  }

  _close() {
    clearTimeout(this._flushTimer);
    this._buffer = '';
    if (this._stream) {
      const s = this._stream;
      this._stream = null;
      try { s.destroy(); } catch { /* already gone */ }
    }
    const was = this.open;
    this.open = false;
    this.device = null;
    this.label = null;
    if (was) this._announce();
  }

  _announce() { this.emit('status', this.status()); }
}

module.exports = new SerialHost();
