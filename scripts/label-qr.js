'use strict';

/**
 * Builds the goods QR for a printed label out of the Excel label workbook.
 *
 *   node scripts/label-qr.js                       # the workbook in the repo root
 *   node scripts/label-qr.js path/to/label.xlsm    # another copy of it
 *   node scripts/label-qr.js --json                # print the JSON, write nothing
 *
 * Writes:
 *   public/label-qr.html   a printable sheet, served at /label-qr.html
 *   labels/label.png       the QR alone, for printing or sending to a phone
 *   labels/label.svg
 *
 * Three fields come from the «صدور» sheet, which is where the workbook's own
 * macros leave the label's data; everything else the service demands is fixed
 * in lib/label-qr.js. This is the offline route — Excel itself calls
 * /label/qr.png (see excel/LabelQR.bas), and both encode the same text.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { buildLabel, qrSvg, qrPng } = require('../lib/label-qr');
const secondGroup = require('../public/second-group.js');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'labels');
const DEFAULT_BOOK = path.join(ROOT, 'نسخه جدید لیبل.xlsm');

const SHEET = 'صدور';                       // the sheet the label is issued from
const CELLS = {
  code: ['Z3'],                             // کد کالا — the «کدینگ» column
  serial: ['C4'],                           // سریال تولید
  name: ['C5', 'C6', 'D9'],                 // عنوان کالا — نوع محصول + سایز + رنگ
};
// Everything else the service demands is fixed in lib/label-qr.js, which the
// Excel endpoint uses too, so both routes encode the same thing.

// ---------------------------------------------------------------- zip reading

/** Reads one member of a zip file. No dependencies: xlsm is a zip of XML. */
function unzip(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged central directory');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compressedSize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`${name}: unsupported compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${wanted} is missing from the workbook`);
}

// ------------------------------------------------------------- xlsx unpacking

const unescapeXml = (s) => s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(lt|gt|amp|quot|apos));/g,
  (_, dec, hex, ent) => dec ? String.fromCodePoint(+dec)
    : hex ? String.fromCodePoint(parseInt(hex, 16))
      : ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[ent]);

/** The <t> runs of one <si>/<is> element, concatenated — a cell's whole text. */
function textOf(xml) {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += unescapeXml(m[1] || '');
  return out;
}

function readWorkbook(file) {
  const zip = fs.readFileSync(file);
  const workbook = unzip(zip, 'xl/workbook.xml').toString('utf8');

  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => ({
    name: unescapeXml(/name="([^"]*)"/.exec(m[0])[1]),
    rid: /r:id="([^"]*)"/.exec(m[0])[1],
  }));
  const sheet = sheets.find((s) => s.name === SHEET);
  if (!sheet) throw new Error(`the workbook has no «${SHEET}» sheet (found: ${sheets.map((s) => s.name).join(', ')})`);

  const rels = unzip(zip, 'xl/_rels/workbook.xml.rels').toString('utf8');
  const rel = new RegExp(`<Relationship[^>]*Id="${sheet.rid}"[^>]*>`).exec(rels);
  if (!rel) throw new Error(`no relationship ${sheet.rid} for «${SHEET}»`);
  let target = unescapeXml(/Target="([^"]*)"/.exec(rel[0])[1]).replace(/^\/?xl\//, '');

  const shared = [];
  try {
    const ss = unzip(zip, 'xl/sharedStrings.xml').toString('utf8');
    for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  } catch { /* a workbook with only inline strings has no shared table */ }

  return { xml: unzip(zip, 'xl/' + target).toString('utf8'), shared };
}

/** Values of the named cells, keyed by reference; absent cells are left out. */
function readCells({ xml, shared }, refs) {
  const want = new Set(refs);
  const found = {};
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = /r="([^"]*)"/.exec(m[1]);
    if (!ref || !want.has(ref[1])) continue;
    const body = m[2] || '';
    const type = /t="([^"]*)"/.exec(m[1]);
    let value = '';
    if (type && type[1] === 's') {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      value = v ? (shared[+v[1]] ?? '') : '';
    } else if (type && type[1] === 'inlineStr') {
      value = textOf(body);
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      value = v ? unescapeXml(v[1]) : '';
    }
    found[ref[1]] = value.trim();
  }
  return found;
}

function labelFrom(book) {
  const cells = readCells(book, Object.values(CELLS).flat());
  // Empty cells must not leave a stray separator inside the name.
  const join = (refs) => refs.map((r) => cells[r] || '').filter(Boolean).join(' ');

  try {
    return buildLabel({ code: join(CELLS.code), serial: join(CELLS.serial), name: join(CELLS.name) });
  } catch (err) {
    const where = (err.missing || []).map((k) => `${k} (${CELLS[k].join('+')})`).join('، ');
    throw new Error(`«${SHEET}» is empty where the label's data should be: ${where}`);
  }
}

// ------------------------------------------------------------------ rendering

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function sheet(label, text, render, source) {
  const rows = [
    ['کد کالا (code)', label.code, CELLS.code.join('+')],
    ['عنوان کالا (name)', label.name, CELLS.name.join('+')],
    ['سریال (serial)', label.serial, CELLS.serial.join('+')],
    // Not in the QR — added by the panel when the good is registered. Shown
    // here so the sheet still says what will reach Orash.
    ['گروه فرعی (secondGroupCodeRef)', String(secondGroup.resolve(label.code).code), 'از رقم دوم و سوم کد'],
  ].map(([k, v, from]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td><td class="dim" dir="ltr">${escapeHtml(from)}</td></tr>`).join('\n      ');

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QR لیبل محصول</title>
<style>
  body { font-family: Vazirmatn, Tahoma, "Segoe UI", sans-serif; background: #f6f7f9; color: #111827; margin: 0; padding: 24px; line-height: 1.7; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .lead { background: #fff7ed; border: 1px solid #fdba74; border-radius: 10px; padding: 14px 16px; max-width: 900px; margin-bottom: 22px; }
  .card { display: flex; gap: 20px; align-items: flex-start; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; max-width: 900px; page-break-inside: avoid; }
  .qr { flex: none; }
  .qr svg { display: block; width: 100%; height: auto; }
  .meta { flex: 1; min-width: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; margin-bottom: 12px; }
  th, td { border-bottom: 1px solid #eef0f3; padding: 5px 8px; text-align: right; vertical-align: top; }
  th { width: 150px; font-weight: 600; color: #374151; }
  pre { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 11px; overflow-x: auto; text-align: left; margin: 0; }
  .dim { color: #9ca3af; font-size: 12px; }
  @media print { body { background: #fff; padding: 0; } .lead { display: none; } .card { border-color: #999; } }
</style>
</head>
<body>
  <h1>QR لیبل محصول</h1>
  <div class="lead">
    ساخته شده از <b dir="ltr">${escapeHtml(source)}</b> — شیت «${SHEET}».
    برای به‌روزرسانی، فایل اکسل را ذخیره کنید و <code dir="ltr">node scripts/label-qr.js</code> را دوباره اجرا کنید.
  </div>
  <section class="card">
    <div class="qr" style="width:${render.px}px">${render.svg}</div>
    <div class="meta">
      <table>
      ${rows}
      </table>
      <pre dir="ltr">${escapeHtml(JSON.stringify(JSON.parse(text), null, 2))}</pre>
      <p class="dim">${render.cells}×${render.cells} ماژول · تصحیح خطا ${render.ecc} · ${text.length} کاراکتر · labels/label.png</p>
    </div>
  </section>
</body>
</html>
`;
}

// ----------------------------------------------------------------------- main

const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const file = args.find((a) => !a.startsWith('--')) || DEFAULT_BOOK;

let label;
try {
  label = labelFrom(readWorkbook(file));
} catch (err) {
  console.error(`${path.basename(file)}: ${err.message}`);
  process.exit(1);
}

const text = JSON.stringify(label);
if (jsonOnly) { console.log(text); process.exit(0); }

const render = qrSvg(text);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'label.svg'), render.svg);
fs.writeFileSync(path.join(OUT_DIR, 'label.png'), qrPng(text).png);
fs.writeFileSync(path.join(ROOT, 'public', 'label-qr.html'), sheet(label, text, render, path.basename(file)));

console.log(text);
console.log('wrote public/label-qr.html, labels/label.svg and labels/label.png');
