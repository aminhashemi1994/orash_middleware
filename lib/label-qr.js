'use strict';

/**
 * The label QR: the JSON a printed product label carries, and its rendering.
 *
 * The label carries only what the sheet actually knows: code, name, serial.
 * The four reference codes `CreateGood` also demands — unit, packing, main and
 * second group — are this system's to supply, and it supplies them when the
 * good is registered, not when the label is printed. That is deliberate: a
 * label printed today keeps working after those codes change, because the
 * numbers are never frozen into the paper.
 *
 * The sub-group is still *checked* here, though not written into the QR: a code
 * whose 2nd and 3rd digits match no family would fail at registration, and it
 * is cheaper to refuse the label than to discover it after printing.
 *
 * PNG is written here rather than shelled out to ImageMagick: the server has
 * to answer this request on a machine we do not control, and zlib plus four
 * chunks is less to go wrong than a binary that may not be installed.
 */

const zlib = require('zlib');

const secondGroup = require('../public/second-group.js');
const qrcode = require('../public/vendor/qrcode-gen.js');
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];   // Persian must not be latin1

/** Persian and Arabic-Indic digits, so a code typed in either form scans alike. */
const toLatinDigits = (s) => String(s == null ? '' : s).replace(/[۰-۹٠-٩]/g,
  (d) => String(d.charCodeAt(0) >= 0x06f0 ? d.charCodeAt(0) - 0x06f0 : d.charCodeAt(0) - 0x0660));

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * Which kind of QR this is. The panel reads it to decide which fixed codes to
 * apply, so a code printed by the label sheet and one produced some other way
 * can be filled in differently. `L` is the label sheet; other modes will follow.
 *
 * It is ours, not Orash's — `mode` is stripped before anything is sent to the
 * service (see ScanCore.forService).
 */
const MODE_LABEL = 'L';

/**
 * @param {{code:string, serial:string, name:string, lengthValue?:string|number}} fields
 *   straight from the sheet
 * @returns {{code:string, name:string, serial:string, lengthValue?:number}} the QR content
 * @throws {Error} naming the missing fields, so Excel can show which cell is empty;
 *   or explaining why the goods code has no sub-group, so it is not printed at all
 */
function buildLabel(fields) {
  const label = {
    mode: MODE_LABEL,
    code: toLatinDigits(clean(fields.code)),
    name: clean(fields.name),
    serial: toLatinDigits(clean(fields.serial)),
  };
  // Cable length in metres. Optional, and left out entirely when the cell is
  // empty or not a number — Orash's lengthValue is a decimal, and 0 would be a
  // claim about the cable rather than the absence of one.
  const len = Number(toLatinDigits(clean(fields.lengthValue)));
  if (Number.isFinite(len) && len > 0) label.lengthValue = len;

  const missing = ['code', 'name', 'serial'].filter((k) => !label[k]);
  if (missing.length) {
    const err = new Error(`missing: ${missing.join(', ')}`);
    err.missing = missing;
    throw err;
  }

  // Checked, not carried: the number itself is looked up again at registration.
  const sub = secondGroup.resolve(label.code);
  if (sub.status !== 'ok') {
    const err = new Error(sub.message);
    err.secondGroup = sub;
    throw err;
  }
  return label;
}

// ------------------------------------------------------------------ QR symbol

const QUIET = 4;                 // quiet zone the QR spec requires, in modules
const MIN_MODULE_PX = 5;         // below this a phone camera starts to struggle
const DENSE_MODULES = 57;        // past this, drop to ECC L to keep the grid coarse

function symbol(text) {
  let qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  let ecc = 'M';
  if (qr.getModuleCount() > DENSE_MODULES) {
    const lower = qrcode(0, 'L');
    lower.addData(text, 'Byte');
    lower.make();
    if (lower.getModuleCount() < qr.getModuleCount()) { qr = lower; ecc = 'L'; }
  }
  const cells = qr.getModuleCount();
  return { qr, ecc, cells, total: cells + QUIET * 2 };
}

/** Renders at a size that keeps every module at least MIN_MODULE_PX wide. */
function qrSvg(text) {
  const { qr, ecc, cells, total } = symbol(text);
  const px = Math.max(240, total * MIN_MODULE_PX);
  const rects = [];
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (qr.isDark(r, c)) rects.push(`<rect x="${c + QUIET}" y="${r + QUIET}" width="1" height="1"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`
    + `<rect width="${total}" height="${total}" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`;
  return { svg, cells, total, px, ecc };
}

// -------------------------------------------------------------- PNG encoding

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A greyscale PNG of the symbol, `scale` device pixels per module.
 * @returns {{png:Buffer, cells:number, total:number, px:number, ecc:string}}
 */
function qrPng(text, scale = 10) {
  const { qr, ecc, cells, total } = symbol(text);
  const px = total * scale;

  // One byte per pixel, each scanline prefixed with filter type 0 (none):
  // the image is two-valued, so a filter would buy nothing over deflate.
  const stride = px + 1;
  const raw = Buffer.alloc(stride * px, 0xFF);
  for (let y = 0; y < px; y++) raw[y * stride] = 0;
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (!qr.isDark(r, c)) continue;
      const x0 = (c + QUIET) * scale;
      for (let dy = 0; dy < scale; dy++) {
        const row = ((r + QUIET) * scale + dy) * stride + 1;
        raw.fill(0x00, row + x0, row + x0 + scale);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 0;      // colour type: greyscale
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { png, cells, total, px, ecc };
}

module.exports = { buildLabel, qrSvg, qrPng, toLatinDigits, MODE_LABEL };
