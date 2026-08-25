'use strict';

/**
 * Explains why Web Serial cannot open the scanner.
 *
 * Chrome reports only "Failed to open serial port" — it cannot say whether the
 * device is missing, held by another program, or simply unreadable by this user.
 * This server runs as the same user as the browser, so it can look at the device
 * node and give the operator the actual reason and the actual fix.
 *
 * Linux and macOS only; on Windows the OS hands COM ports to the logged-in user
 * and there is nothing useful to inspect.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEVICE_RE = /^(ttyACM|ttyUSB|cu\.usb|tty\.usb)/;

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

function inspect() {
  const platform = process.platform;
  const result = { platform, devices: [], hint: null, fix: null };
  if (platform === 'win32') {
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

  const scanner = result.devices.find((d) => /ttyACM|usb/i.test(d.path));
  if (!result.devices.length) {
    result.hint = 'هیچ پورت سریالی در /dev پیدا نشد. بارکدخوان وصل نیست، یا در حالت صفحه‌کلید (HID) است — در آن حالت از گزینه «بارکدخوان صفحه‌کلیدی» استفاده کنید.';
  } else if (scanner && scanner.accessible) {
    result.hint = `پورت ${scanner.path} برای این کاربر قابل باز کردن است. اگر مرورگر باز نمی‌کند، احتمالاً برنامه دیگری آن را در اختیار گرفته است (مثلاً یک ترمینال سریال یا ModemManager).`;
    result.fix = 'sudo systemctl stop ModemManager';
  } else if (scanner) {
    const stale = scanner.inGroupOnDisk && !scanner.inGroupNow;
    result.hint = stale
      ? `کاربر «${me}» به گروه ${scanner.group} اضافه شده، ولی این نشست هنوز آن را ندارد. یک بار خارج و دوباره وارد شوید (یا سیستم را ری‌استارت کنید).`
      : `پورت ${scanner.path} با مالکیت ${scanner.group} و دسترسی ${scanner.mode} است و کاربر «${me}» اجازه باز کردن آن را ندارد.`;
    result.fix = stale ? null : 'sudo ./scripts/linux-serial-access.sh';
    result.needsRelogin = stale;
  }
  return result;
}

module.exports = { inspect };
