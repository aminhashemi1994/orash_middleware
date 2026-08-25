'use strict';

/**
 * Generates the sample QR codes used to test the scanner without Orash.
 *
 *   node scripts/make-sample-qr.js
 *
 * Writes:
 *   public/samples.html   a printable sheet, served at /samples.html
 *   samples/*.png         one file per sample, for printing or sending to a phone
 *
 * The reference codes below (unit 2, packing 1, groups 1/2) are the ones the
 * built-in simulator accepts, so these same codes also register successfully
 * under `npm run start:mock`.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const qrcode = require('../public/vendor/qrcode-gen.js');
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];   // Persian must not be latin1

const ROOT = path.join(__dirname, '..');
const PNG_DIR = path.join(ROOT, 'samples');

// Required-field set shared by the "complete" samples.
const REQUIRED = { type: 1, serial: '1', unitIdRef: 2, unitPackingCodeRef: 1, mainGroupCodeRef: 1, secondGroupCodeRef: 2 };

const SAMPLES = [
  {
    file: '1-good-complete',
    title: 'کالای کامل',
    note: 'همه فیلدهای الزامی داخل خود QR است. در صف باید «آماده ثبت» شود.',
    text: JSON.stringify({ code: '71501', name: 'کابل افشان ۲.۵ نمونه', ...REQUIRED, fiPrice1: 185000 }),
  },
  {
    file: '2-service',
    title: 'خدمات (type = 2)',
    note: 'همان ساختار، ولی خدمات به‌جای کالا.',
    text: JSON.stringify({ code: '71502', name: 'خدمات نصب نمونه', ...REQUIRED, type: 2, serial: '2' }),
  },
  {
    file: '3-persian-keys',
    title: 'کلیدهای فارسی و ارقام فارسی',
    note: 'نام فیلدها فارسی است و عددها با ارقام فارسی نوشته شده‌اند؛ پنل هر دو را تشخیص می‌دهد.',
    text: JSON.stringify({
      'کد': '۷۱۵۰۳',
      'نام کالا': 'کلید مینیاتوری نمونه',
      'نوع': 'کالا',
      'سریال': '۳',
      'کد واحد': '۲',
      'کد بسته بندی': '۱',
      'کد گروه اصلی': '۱',
      'کد گروه فرعی': '۲',
      'قیمت': '۴۲۰٬۰۰۰',
    }),
  },
  {
    file: '4-envelope',
    title: 'پوشش کامل سرویس',
    note: 'شکل {uniqueID, data} — همان چیزی که به وب‌سرویس ارسال می‌شود.',
    text: JSON.stringify({
      uniqueID: '61c7f1d6-0297-49e4-a02c-546b1c12f22c',
      data: { code: '71504', name: 'ترمینال نمونه', ...REQUIRED, serial: '4' },
    }),
  },
  {
    // Persian text costs two bytes per character, so a batch gets dense fast.
    // The short aliases (unit/pack/g1/g2) keep this readable by a phone camera.
    file: '5-batch-of-3',
    title: 'دسته‌ای — سه کالا در یک QR',
    note: 'یک بار اسکن، سه ردیف در صف. برای کوچک ماندن QR از نام‌های کوتاه فیلد استفاده شده است.',
    text: JSON.stringify([
      { code: '71505', name: 'پیچ نمونه ۱', type: 1, serial: '5', unit: 2, pack: 1, g1: 1, g2: 2 },
      { code: '71506', name: 'پیچ نمونه ۲', type: 1, serial: '6', unit: 2, pack: 1, g1: 1, g2: 2 },
      { code: '71507', name: 'پیچ نمونه ۳', type: 1, serial: '7', unit: 2, pack: 1, g1: 1, g2: 2 },
    ]),
  },
  {
    file: '6-key-value',
    title: 'شکل فشرده key=value',
    note: 'برای وقتی که JSON طولانی می‌شود و QR بزرگ.',
    text: 'code=71508;name=فیوز نمونه;type=1;serial=8;unit=2;pack=1;g1=1;g2=2',
  },
  {
    file: '7-bare-barcode',
    title: 'بارکد ساده (فقط کد)',
    note: 'کد کالا خوانده می‌شود و بقیه فیلدها از فرم بالای پنل برداشته می‌شوند — پس فرم را قبلش پر کنید.',
    text: '6291041500213',
  },
];

const QUIET = 4;                 // quiet zone the QR spec requires, in modules
const MIN_MODULE_PX = 5;         // below this a phone camera starts to struggle
const DENSE_MODULES = 57;        // past this, drop to ECC L to keep the grid coarse

function build(text) {
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
  return { qr, ecc, cells: qr.getModuleCount() };
}

/** Renders at a size that keeps every module at least MIN_MODULE_PX wide. */
function svgFor(text) {
  const { qr, ecc, cells } = build(text);
  const total = cells + QUIET * 2;
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

fs.mkdirSync(PNG_DIR, { recursive: true });

let cards = '';
let converted = 0;
for (const s of SAMPLES) {
  const { svg, cells, total, px, ecc } = svgFor(s.text);
  const svgPath = path.join(PNG_DIR, s.file + '.svg');
  fs.writeFileSync(svgPath, svg);

  // PNG is what phones and printers deal with most easily. 10 device pixels per
  // module keeps it crisp when printed small.
  const pngSize = total * 10;
  for (const bin of ['magick', 'convert']) {          // ImageMagick 7 renamed the binary
    try {
      execFileSync(bin, ['-background', 'white', svgPath,
        '-resize', `${pngSize}x${pngSize}`, path.join(PNG_DIR, s.file + '.png')], { stdio: 'ignore' });
      converted++;
      break;
    } catch { /* try the other name; absent ImageMagick just means SVG only */ }
  }

  const pretty = (() => {
    try { return JSON.stringify(JSON.parse(s.text), null, 2); } catch { return s.text; }
  })();

  cards += `
  <section class="card">
    <div class="qr" style="width:${px}px">${svg}</div>
    <div class="meta">
      <h2>${s.title}</h2>
      <p class="note">${s.note}</p>
      <pre dir="ltr">${pretty.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>
      <p class="dim">${cells}×${cells} ماژول · تصحیح خطا ${ecc} · ${s.text.length} کاراکتر · samples/${s.file}.png</p>
    </div>
  </section>`;
}

const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>QR های نمونه اوراش</title>
<style>
  body { font-family: Vazirmatn, Tahoma, "Segoe UI", sans-serif; background: #f6f7f9; color: #111827; margin: 0; padding: 24px; line-height: 1.7; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .lead { background: #fff7ed; border: 1px solid #fdba74; border-radius: 10px; padding: 14px 16px; max-width: 900px; margin-bottom: 22px; }
  .lead ol { margin: 8px 0 0; padding-inline-start: 20px; }
  .card { display: flex; gap: 20px; align-items: flex-start; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 16px; max-width: 900px; page-break-inside: avoid; }
  .qr { flex: none; }
  .qr svg { display: block; width: 100%; height: auto; }
  .meta { flex: 1; min-width: 0; }
  .meta h2 { font-size: 16px; margin: 0 0 4px; }
  .note { margin: 0 0 10px; color: #4b5563; font-size: 13px; }
  pre { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 11px; overflow-x: auto; text-align: left; margin: 0; }
  .dim { color: #9ca3af; font-size: 12px; margin: 8px 0 0; }
  @media print { body { background: #fff; padding: 0; } .lead { border-color: #999; } .card { border-color: #999; } }
</style>
</head>
<body>
  <h1>QR های نمونه برای آزمایش اسکنر</h1>
  <div class="lead">
    <b>وقتی وب‌سرویس اوراش در دسترس نیست:</b>
    <ol>
      <li>در پنل، دکمه <b>«ثبت خودکار»</b> را <b>خاموش</b> کنید تا اسکن‌ها فقط در صف بنشینند و ارسالی انجام نشود.</li>
      <li>فیلدهای فرم «ثبت کالا / خدمات» را پر کنید (برای نمونه‌های ۱ تا ۶ لازم نیست، ولی برای نمونه ۷ لازم است).</li>
      <li>این صفحه را روی نمایشگر باز بگذارید یا چاپ کنید و با بارکدخوان یا گوشی اسکن کنید.</li>
    </ol>
    برای آزمایش مسیر کامل تا «ثبت شد»، سرویس را با <code dir="ltr">npm run start:mock</code> اجرا کنید؛ کدهای مرجع این نمونه‌ها با شبیه‌ساز سازگارند.
  </div>
  ${cards}
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'public', 'samples.html'), html);
console.log(`wrote public/samples.html and ${SAMPLES.length} SVG${converted ? ` + ${converted} PNG` : ''} files in samples/`);
