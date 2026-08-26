'use strict';

/**
 * Explains why Web Serial cannot open the scanner.
 *
 * Chrome reports only "Failed to open serial port" — it cannot say whether the
 * device is missing, held by another program, or simply unreadable by this user.
 * This server runs as the same user as the browser, so it can look at the device
 * node and give the operator the actual reason and the actual fix.
 *
 * It is also what answers "is a scanner plugged in at all?", which the panel
 * asks on load before deciding whether to auto-connect: the browser can only
 * see ports the user has already approved, while /dev and /sys show the truth.
 *
 * Linux and macOS only; on Windows the OS hands COM ports to the logged-in user
 * and there is nothing useful to inspect.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEVICE_RE = /^(ttyACM|ttyUSB|cu\.usb|tty\.usb)/;

// USB vendors that make handheld barcode/QR scanners. Used to tell "nothing is
// plugged in" apart from "the scanner is plugged in but not in serial mode" —
// two different problems with two different fixes.
const SCANNER_VENDORS = {
  '05f9': 'Datalogic / PSC',
  '05e0': 'Symbol / Zebra',
  '0c2e': 'Metrologic / Honeywell',
  '0536': 'Hand Held Products / Honeywell',
  '1eab': 'Newland',
  '065a': 'Opticon',
  '1504': 'CipherLab',
  '2dd6': 'Generalscan',
};

const SCANNER_NAME_RE = /scan|barcode|bar[ -]?code|\bqr\b|gryphon|quickscan|symbol|honeywell|newland|zebra/i;

const USB_SYS = '/sys/bus/usb/devices';

/** gid -> group name, without pulling in a dependency. */
function groupInfo(gid) {
  try {
    for (const line of fs.readFileSync('/etc/group', 'utf8').split('\n')) {
      const [name, , id, members] = line.split(':');
      if (Number(id) === gid) return { name, members: (members || '').split(',').filter(Boolean) };
    }
  } catch { /* macOS has no /etc/group worth reading */ }
  return { name: String(gid), members: [] };
}

/** The friendly name udev exposes, e.g. "Datalogic ADC Handheld Bardcode Scanner". */
function byIdLabel(devPath) {
  const dir = '/dev/serial/by-id';
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (path.resolve(dir, fs.readlinkSync(path.join(dir, entry))) === devPath) {
        return entry.replace(/^usb-/, '').replace(/-if\d+$/, '').replace(/_+/g, ' ').trim();
      }
    }
  } catch { /* no by-id directory */ }
  return null;
}

/**
 * USB devices as the kernel sees them, from /sys — so a scanner in HID
 * (keyboard) mode, which creates no serial port at all, is still visible.
 * Linux only; /sys does not exist elsewhere.
 */
function usbDevices() {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(USB_SYS); } catch { return out; }

  for (const name of entries) {
    // Ports look like "1-4" or "1-4.2"; skip root hubs ("usb1") and the
    // per-interface directories ("1-4:1.0").
    if (!/^\d+-[\d.]+$/.test(name)) continue;
    const dir = path.join(USB_SYS, name);
    const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8').trim(); } catch { return ''; } };

    const vendorId = read('idVendor').toLowerCase();
    if (!vendorId) continue;

    const classes = [];
    try {
      for (const sub of fs.readdirSync(dir)) {
        if (!sub.startsWith(name + ':')) continue;
        const cls = (() => {
          try { return fs.readFileSync(path.join(dir, sub, 'bInterfaceClass'), 'utf8').trim().toLowerCase(); }
          catch { return ''; }
        })();
        if (cls && !classes.includes(cls)) classes.push(cls);
      }
    } catch { /* no interfaces exposed */ }

    const dev = {
      vendorId,
      productId: read('idProduct').toLowerCase(),
      product: read('product'),
      manufacturer: read('manufacturer'),
      classes,                                  // '03' = HID, '02'/'0a' = CDC serial
      // Chrome only remembers a Web Serial grant for devices that report a
      // serial number; without one the operator is re-prompted after every
      // browser restart. Reported so the panel can say why.
      serialNumber: read('serial') || null,
    };
    dev.vendorName = SCANNER_VENDORS[vendorId] || null;
    dev.isScanner = !!dev.vendorName || SCANNER_NAME_RE.test(`${dev.manufacturer} ${dev.product}`);
    dev.label = [dev.manufacturer, dev.product].filter(Boolean).join(' ')
      || dev.vendorName
      || `USB ${dev.vendorId}:${dev.productId}`;
    out.push(dev);
  }
  return out;
}

/**
 * @returns {object} `status` is the machine-readable outcome:
 *   ready          a serial port exists and this user can open it
 *   no-permission  the port exists but its permissions forbid this user
 *   needs-relogin  the group was granted after the session started
 *   hid-mode       a scanner is on USB but exposes no serial port (keyboard mode)
 *   no-device      nothing plugged in
 *   unsupported    Windows: nothing useful to inspect
 */
function inspect() {
  const platform = process.platform;
  const result = { platform, devices: [], usb: [], scanners: [], status: 'no-device', hint: null, fix: null };
  if (platform === 'win32') {
    result.status = 'unsupported';
    result.hint = 'روی ویندوز پورت COM در اختیار کاربر وارد شده است. اگر مرورگر پورت را نمی‌بیند، درایور USB-COM دستگاه را نصب کنید.';
    return result;
  }

  let names = [];
  try { names = fs.readdirSync('/dev').filter((n) => DEVICE_RE.test(n)); } catch { /* no /dev listing */ }

  const me = os.userInfo().username;
  const myGroups = typeof process.getgroups === 'function' ? process.getgroups() : [];

  for (const name of names.sort()) {
    const devPath = '/dev/' + name;
    const dev = { path: devPath, label: byIdLabel(devPath) };
    try {
      const st = fs.statSync(devPath);
      const grp = groupInfo(st.gid);
      dev.mode = (st.mode & 0o777).toString(8).padStart(4, '0');
      dev.group = grp.name;
      // Membership recorded in /etc/group but missing from this process's groups
      // means the account was added after the desktop session started.
      dev.inGroupOnDisk = grp.members.includes(me);
      dev.inGroupNow = myGroups.includes(st.gid);
    } catch (err) { dev.statError = err.code; }

    try {
      fs.accessSync(devPath, fs.constants.R_OK | fs.constants.W_OK);
      dev.accessible = true;
    } catch (err) {
      dev.accessible = false;
      dev.errorCode = err.code;
    }
    result.devices.push(dev);
  }

  result.usb = usbDevices();
  result.scanners = result.usb.filter((d) => d.isScanner);

  // A tty is "the scanner" when udev's by-id name looks like one, or when a
  // scanner is the only such USB device present.
  for (const dev of result.devices) {
    dev.isScanner = SCANNER_NAME_RE.test(dev.label || '')
      || (result.scanners.length === 1 && result.devices.length === 1);
  }

  const scanner = result.devices.find((d) => d.isScanner) || result.devices.find((d) => /ttyACM|usb/i.test(d.path));
  result.port = scanner ? scanner.path : null;
  result.deviceLabel = scanner?.label || result.scanners[0]?.label || null;
  // Only meaningful for the browser path: no serial number, no remembered grant.
  result.persistableGrant = result.scanners.length ? !!result.scanners[0].serialNumber : null;

  if (!result.devices.length) {
    const hid = result.scanners.find((d) => d.classes.includes('03'));
    if (result.scanners.length) {
      result.status = 'hid-mode';
      result.hint = `«${result.scanners[0].label}» روی USB دیده می‌شود ولی پورت سریالی نساخته است`
        + `${hid ? ' — در حالت صفحه‌کلید (HID) است' : ''}.`
        + ' یا دستگاه را با بارکد راهنمای خودش به حالت RS-232/USB-COM ببرید، یا گزینه «بارکدخوان صفحه‌کلیدی» را روشن کنید.';
    } else {
      result.status = 'no-device';
      result.hint = 'هیچ پورت سریالی در /dev پیدا نشد و هیچ بارکدخوانی روی USB دیده نمی‌شود. دستگاه را به USB وصل کنید.';
    }
  } else if (scanner && scanner.accessible) {
    result.status = 'ready';
    result.hint = `پورت ${scanner.path} برای این کاربر قابل باز کردن است. اگر مرورگر باز نمی‌کند، احتمالاً برنامه دیگری آن را در اختیار گرفته است (مثلاً یک ترمینال سریال یا ModemManager).`;
    result.fix = 'sudo systemctl stop ModemManager';
  } else if (scanner) {
    const stale = scanner.inGroupOnDisk && !scanner.inGroupNow;
    result.status = stale ? 'needs-relogin' : 'no-permission';
    result.hint = stale
      ? `کاربر «${me}» به گروه ${scanner.group} اضافه شده، ولی این نشست هنوز آن را ندارد. یک بار خارج و دوباره وارد شوید (یا سیستم را ری‌استارت کنید).`
      : `پورت ${scanner.path} با مالکیت ${scanner.group} و دسترسی ${scanner.mode} است و کاربر «${me}» اجازه باز کردن آن را ندارد.`;
    result.fix = stale ? null : 'sudo ./scripts/linux-serial-access.sh';
    result.needsRelogin = stale;
  }
  return result;
}

module.exports = { inspect };
