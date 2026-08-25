'use strict';

/**
 * ScanCore - turns the raw text of a scanned QR code into a CreateGood payload.
 *
 * Shared by the desktop panel and the phone page, so it stays dependency free
 * and side-effect free.
 *
 * Accepted QR content, in order of preference:
 *   1. A CreateGood object:            {"code":"71010","name":"کابل","type":1,...}
 *   2. The full service envelope:      {"uniqueID":"...","data":{...}}
 *   3. A batch:                        [{...},{...}]  or  {"items":[{...}]}
 *   4. key=value pairs:                code=71010;name=کابل;unit=2
 *   5. base64 of any of the above
 *   6. Anything else -> treated as a bare goods code (a plain product barcode)
 *
 * Field names are matched loosely: case, spaces, underscores and dashes are
 * ignored, and common Persian/English aliases map onto the documented Orash
 * field names.
 */
(function (global) {

  // Documented CreateGood fields (docs/orash-web-service-api.md section 5.1).
  const NUMERIC = new Set([
    'type', 'unitIdRef', 'mainGroupCodeRef', 'secondGroupCodeRef', 'unitPackingCodeRef',
    'fiPrice1', 'fiPrice2', 'fiPrice3', 'offPercent1', 'offPercent2', 'offPercent3',
    'taxPercent', 'lengthValue', 'widthValue', 'heightValue', 'diameterValue',
    'goodCategoryIdRef', 'patternIdRef', 'weightPack', 'weightGoods', 'criterionWeight',
    'dimensionsLengthPack', 'dimensionsWidthPack', 'dimensionsHeightPack',
    'dimensionsLengthGoods', 'dimensionsWidthGoods', 'dimensionsHeightGoods',
    'criterionDimensions',
  ]);
  const BOOLEAN = new Set(['isActive', 'isAdded', 'isBuyAdded', 'serialsControl']);
  const STRING = new Set(['code', 'name', 'serial', 'saleName', 'nationalCode']);

  const KNOWN = new Set([...NUMERIC, ...BOOLEAN, ...STRING]);

  // Aliases are looked up *after* normalizeKey(), so they carry no spaces,
  // ZWNJ, underscores or capitals.
  const ALIASES = {
    // code
    code: 'code', goodcode: 'code', kalacode: 'code', itemcode: 'code', productcode: 'code',
    barcode: 'code', sku: 'code', id: 'code',
    'کد': 'code',                                     // کد
    'کدکالا': 'code',             // کد کالا
    // name
    name: 'name', goodname: 'name', title: 'name', desc: 'name', description: 'name',
    productname: 'name',
    'نام': 'name',                               // نام
    'نامکالا': 'name',       // نام کالا
    'عنوان': 'name',                   // عنوان
    'عنوانکالا': 'name', // عنوان کالا
    'شرح': 'name',                               // شرح
    // type
    type: 'type', goodtype: 'type', kind: 'type',
    'نوع': 'type',                               // نوع
    // serial
    serial: 'serial', serialno: 'serial',
    'سریال': 'serial',                 // سریال
    // unit of measure
    unitidref: 'unitIdRef', unit: 'unitIdRef', unitid: 'unitIdRef', unitcode: 'unitIdRef',
    measureunit: 'unitIdRef',
    'واحد': 'unitIdRef',                    // واحد
    'کدواحد': 'unitIdRef',        // کد واحد
    'واحدشمارش': 'unitIdRef', // واحد شمارش
    // packing unit
    unitpackingcoderef: 'unitPackingCodeRef', packing: 'unitPackingCodeRef', pack: 'unitPackingCodeRef',
    packunit: 'unitPackingCodeRef', packingcode: 'unitPackingCodeRef',
    'بستهبندی': 'unitPackingCodeRef',           // بسته بندی
    'کدبستهبندی': 'unitPackingCodeRef', // کد بسته بندی
    'نوعبستهبندی': 'unitPackingCodeRef', // نوع بسته بندی
    // groups
    maingroupcoderef: 'mainGroupCodeRef', maingroup: 'mainGroupCodeRef', maingroupcode: 'mainGroupCodeRef',
    group: 'mainGroupCodeRef', group1: 'mainGroupCodeRef', g1: 'mainGroupCodeRef',
    'گروه': 'mainGroupCodeRef',                                  // گروه
    'گروهاصلی': 'mainGroupCodeRef',          // گروه اصلی
    'کدگروهاصلی': 'mainGroupCodeRef', // کد گروه اصلی
    secondgroupcoderef: 'secondGroupCodeRef', secondgroup: 'secondGroupCodeRef', subgroup: 'secondGroupCodeRef',
    secondgroupcode: 'secondGroupCodeRef', group2: 'secondGroupCodeRef', g2: 'secondGroupCodeRef',
    'گروهفرعی': 'secondGroupCodeRef',          // گروه فرعی
    'کدگروهفرعی': 'secondGroupCodeRef', // کد گروه فرعی
    'زیرگروه': 'secondGroupCodeRef',                // زیرگروه
    // prices
    fiprice1: 'fiPrice1', price: 'fiPrice1', price1: 'fiPrice1', saleprice: 'fiPrice1',
    'قیمت': 'fiPrice1',                     // قیمت
    'نرخ': 'fiPrice1',                           // نرخ
    fiprice2: 'fiPrice2', price2: 'fiPrice2', fiprice3: 'fiPrice3', price3: 'fiPrice3',
    offpercent1: 'offPercent1', discount: 'offPercent1',
    'تخفیف': 'offPercent1',            // تخفیف
    offpercent2: 'offPercent2', offpercent3: 'offPercent3',
    // misc
    salename: 'saleName',
    taxpercent: 'taxPercent', tax: 'taxPercent', vat: 'taxPercent',
    'مالیات': 'taxPercent',       // مالیات
    nationalcode: 'nationalCode', irc: 'nationalCode',
    'کدملی': 'nationalCode',           // کد ملی
    isactive: 'isActive', active: 'isActive',
    'فعال': 'isActive',                     // فعال
    isadded: 'isAdded', isbuyadded: 'isBuyAdded',
    serialscontrol: 'serialsControl',
    goodcategoryidref: 'goodCategoryIdRef', category: 'goodCategoryIdRef',
    patternidref: 'patternIdRef', pattern: 'patternIdRef',
    lengthvalue: 'lengthValue', length: 'lengthValue',
    'طول': 'lengthValue',                        // طول
    widthvalue: 'widthValue', width: 'widthValue',
    'عرض': 'widthValue',                         // عرض
    heightvalue: 'heightValue', height: 'heightValue',
    'ارتفاع': 'heightValue',      // ارتفاع
    diametervalue: 'diameterValue', diameter: 'diameterValue',
    'قطر': 'diameterValue',                      // قطر
    weightgoods: 'weightGoods', weight: 'weightGoods',
    'وزن': 'weightGoods',                        // وزن
    weightpack: 'weightPack', criterionweight: 'criterionWeight',
    dimensionslengthpack: 'dimensionsLengthPack', dimensionswidthpack: 'dimensionsWidthPack',
    dimensionsheightpack: 'dimensionsHeightPack', dimensionslengthgoods: 'dimensionsLengthGoods',
    dimensionswidthgoods: 'dimensionsWidthGoods', dimensionsheightgoods: 'dimensionsHeightGoods',
    criteriondimensions: 'criterionDimensions',
  };

  /** Persian/Arabic-Indic digits -> ASCII, so a QR from Persian tooling still parses. */
  function toAsciiDigits(s) {
    return String(s)
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  }

  /** Strip everything that only varies by formatting so aliases match. */
  function normalizeKey(k) {
    return toAsciiDigits(String(k))
      .replace(/[\u200B-\u200F\u061C\uFEFF]/g, '')  // ZWNJ / bidi marks
      .replace(/[\s_\-.]/g, '')
      .replace(/[يى]/g, 'ی')          // Arabic yeh -> Persian yeh
      .replace(/ك/g, 'ک')                  // Arabic kaf -> Persian kaf
      .toLowerCase();
  }

  function toNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    const s = toAsciiDigits(v).replace(/[,\s٬]/g, '').trim();
    if (s === '') return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }

  function toBool(v) {
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on', 'بله', 'فعال'].includes(s)) return true;
    if (['0', 'false', 'no', 'n', 'off', 'خیر', 'غیرفعال'].includes(s)) return false;
    return undefined;
  }

  /** `type` accepts 1/2 as well as the words for good/service in both languages. */
  function toType(v) {
    const n = toNumber(v);
    if (n === 1 || n === 2) return n;
    const s = String(v).trim().toLowerCase();
    if (['good', 'goods', 'product', 'item', 'کالا'].includes(s)) return 1;
    if (['service', 'services', 'خدمات', 'خدمت'].includes(s)) return 2;
    return undefined;
  }

  function tryJson(text) {
    try { return JSON.parse(text); } catch { return undefined; }
  }

  function tryBase64(text) {
    const t = text.trim();
    if (t.length < 16 || /[^A-Za-z0-9+/=_-]/.test(t)) return undefined;
    try {
      const bin = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return tryJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch { return undefined; }
  }

  /** `code=71010;name=x` / `code:71010\nname:x` / `a=1&b=2` */
  function tryKeyValue(text) {
    if (!/[=:]/.test(text)) return undefined;
    const parts = text.split(/[;\n\r&|]+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return undefined;
    const obj = {};
    for (const part of parts) {
      const m = part.match(/^([^=:]+)[=:]([\s\S]*)$/);
      if (!m) return undefined;   // a non-pair segment means this is not a kv payload
      obj[m[1].trim()] = m[2].trim();
    }
    return obj;
  }

  /** Unwrap the shapes that carry one or more goods objects. */
  function extractRecords(parsed) {
    if (Array.isArray(parsed)) return parsed.flatMap(extractRecords);
    if (!parsed || typeof parsed !== 'object') return [];
    for (const key of ['data', 'good', 'goods', 'items', 'item', 'value', 'records', 'rows']) {
      if (parsed[key] !== undefined) {
        const inner = extractRecords(parsed[key]);
        if (inner.length) return inner;
      }
    }
    return [parsed];
  }

  /**
   * Map one loose record onto canonical CreateGood fields.
   * @returns {{data:object, unknown:string[], notes:string[]}}
   */
  function canonicalize(record) {
    const data = {};
    const unknown = [];
    const notes = [];

    for (const [rawKey, rawVal] of Object.entries(record)) {
      if (rawVal === null || rawVal === undefined || rawVal === '') continue;
      const nk = normalizeKey(rawKey);
      const field = ALIASES[nk] || (KNOWN.has(rawKey) ? rawKey : undefined);
      if (!field) {
        // uniqueID/token/baseUrl belong to the envelope, not the record.
        if (!['uniqueid', 'token', 'baseurl'].includes(nk)) unknown.push(rawKey);
        continue;
      }
      if (field === 'type') {
        const t = toType(rawVal);
        if (t === undefined) notes.push('نوع «' + rawVal + '» شناخته نشد');
        else data.type = t;
      } else if (NUMERIC.has(field)) {
        const n = toNumber(rawVal);
        if (n === undefined) notes.push(field + ': «' + rawVal + '» عدد نیست');
        else data[field] = n;
      } else if (BOOLEAN.has(field)) {
        const b = toBool(rawVal);
        if (b === undefined) notes.push(field + ': «' + rawVal + '» مقدار درست/نادرست نیست');
        else data[field] = b;
      } else {
        data[field] = toAsciiDigits(String(rawVal)).trim();
      }
    }
    return { data, unknown, notes };
  }

  /**
   * Parse raw scanner text.
   * @returns {{ok:boolean, kind:string, records:Array, error?:string, raw:string}}
   */
  function parse(rawText) {
    const raw = String(rawText || '');
    // Scanners append CR/LF and sometimes a prefix character; drop control chars & BOM.
    const text = raw.replace(/[\u0000-\u001F\u007F-\u009F\uFEFF]/g, '').trim();
    if (!text) return { ok: false, kind: 'empty', records: [], error: 'محتوای اسکن خالی است', raw };

    let parsed = tryJson(text);
    let kind = 'json';
    if (parsed === undefined) { parsed = tryBase64(text); kind = 'base64-json'; }
    if (parsed === undefined) { parsed = tryKeyValue(text); kind = 'key-value'; }

    if (parsed === undefined || typeof parsed !== 'object') {
      // A plain barcode: the only useful reading is "this is the goods code".
      return {
        ok: true, kind: 'plain-code', raw,
        records: [{
          data: { code: toAsciiDigits(text) },
          unknown: [],
          notes: ['فقط کد کالا از بارکد خوانده شد؛ بقیه فیلدها از مقادیر پیش‌فرض فرم پر می‌شوند'],
        }],
      };
    }

    const records = extractRecords(parsed).map(canonicalize).filter((r) => Object.keys(r.data).length);
    if (!records.length) {
      return { ok: false, kind, records: [], error: 'هیچ فیلد شناخته‌شده‌ای در QR پیدا نشد', raw };
    }
    return { ok: true, kind, records, raw };
  }

  /** Merge scanned fields over the panel's defaults; the scan wins. */
  function withDefaults(scanned, defaults) {
    const out = { ...defaults };
    for (const [k, v] of Object.entries(scanned)) {
      if (v !== undefined && v !== '') out[k] = v;
    }
    if (out.isActive === undefined) out.isActive = true;
    return out;
  }

  /** Same rules the manual CreateGood form enforces. */
  const SERIAL_RE = /^\d+(-[A-Za-z]+)?$/;
  function validate(data) {
    const errs = [];
    if (!data.name) errs.push('عنوان کالا خالی است');
    if (data.code && !/^\d+$/.test(String(data.code))) errs.push('کد کالا باید فقط عدد باشد');
    if (data.type !== 1 && data.type !== 2) errs.push('نوع کالا/خدمات مشخص نیست');
    if (!data.serial) errs.push('سریال کالا خالی است');
    else if (!SERIAL_RE.test(String(data.serial))) errs.push('سریال باید عدد یا «عدد-حرف» باشد');
    if (data.unitIdRef === undefined) errs.push('کد واحد شمارش (unitIdRef) خالی است');
    if (data.unitPackingCodeRef === undefined) errs.push('کد نوع بسته‌بندی خالی است');
    if (data.mainGroupCodeRef === undefined) errs.push('کد گروه اصلی خالی است');
    if (data.secondGroupCodeRef === undefined) errs.push('کد گروه فرعی خالی است');
    return errs;
  }

  const api = {
    parse, canonicalize, withDefaults, validate,
    normalizeKey, toAsciiDigits,
    KNOWN, NUMERIC, BOOLEAN, STRING,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.ScanCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
