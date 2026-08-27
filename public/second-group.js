'use strict';

/**
 * Sub-group (گروه فرعی) — from the 21-digit goods code to the Orash id.
 *
 * The 2nd and 3rd digits of a product's 21-digit code are the cable family as
 * Excel numbers it. Orash numbers the same families differently, and
 * `CreateGood` wants Orash's id in `secondGroupCodeRef`. This table is the
 * bridge, and it is the only place either number appears.
 *
 *     102000000020006404070
 *      ^^                     "02" → کابل تخت → secondGroupCodeRef 13
 *
 * Four Excel codes once pointed at two families each (06, 10, 23, 36); they were
 * settled by the customer on 2026-08-27: 06 → کابل فیبر نوری, 10 → کابل گرد
 * شیلددار, 36 → کابل هالوژن فری, and کابل هالوژن فری فیلردار moved to its own
 * code 38, leaving 23 to کابل کنترل هالوژن فری. Every Excel code is now unique.
 *
 * Four families have no Excel code at all (`excel: null`), so no goods code can
 * reach them: کابل دارپ, کابل شیلد دار, کابل هالوژن فری استاندارد, سیم شناور.
 * They are kept in the table because they exist in Orash — if a good ever
 * belongs to one, it needs an Excel code before a label can be printed.
 *
 * `resolve` still reports ambiguity rather than guessing, so adding a duplicate
 * code later fails loudly instead of silently registering the wrong family.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SecondGroup = api;
}(typeof self !== 'undefined' ? self : this, function () {

  /** name, the code Excel puts in the 21-digit code, and the id Orash wants. */
  const GROUPS = [
    { name: 'کابل شیلد دار و آرموردار', excel: '11', orash: 11 },
    { name: 'کابل گرد', excel: '01', orash: 12 },
    { name: 'کابل تخت', excel: '02', orash: 13 },
    { name: 'سیم بند تخت', excel: '03', orash: 14 },
    { name: 'کابل مخابراتی', excel: '04', orash: 15 },
    { name: 'کابل جوش', excel: '20', orash: 16 },
    { name: 'کابل فیبر نوری', excel: '06', orash: 17 },
    { name: 'کابل دارپ', excel: null, orash: 18 },
    { name: 'کابل کواکسیال', excel: '07', orash: 19 },
    { name: 'سیم شناور', excel: null, orash: 20 },
    { name: 'کابل هالوژن فری', excel: '36', orash: 21 },
    { name: 'کابل خودنگهدار', excel: '17', orash: 22 },
    { name: 'کابل گرد فیلردار', excel: '19', orash: 23 },
    { name: 'مانیتورینگ', excel: '18', orash: 24 },
    { name: 'سیم acsr', excel: '16', orash: 25 },
    { name: 'سیم هالوژن فری', excel: '21', orash: 26 },
    { name: 'کابل شیلد دار', excel: null, orash: 27 },
    { name: 'کابل گرد شیلددار', excel: '10', orash: 28 },
    { name: 'کابل هالوژن فری low diameter', excel: '22', orash: 29 },
    { name: 'کابل کنترل هالوژن فری', excel: '23', orash: 30 },
    { name: 'کابل گرد سکتور', excel: '24', orash: 31 },
    { name: 'سیم رانژه', excel: '25', orash: 32 },
    { name: 'کابل دیتا', excel: '26', orash: 33 },
    { name: 'کابل گرد کنترل', excel: '27', orash: 34 },
    { name: 'کابل آسانسوری', excel: '28', orash: 35 },
    { name: 'کابل تخت کیسه ای', excel: '32', orash: 36 },
    { name: 'کابل زیرگچی', excel: '31', orash: 37 },
    { name: 'کابل ابزار دقیق', excel: '33', orash: 38 },
    { name: 'کابل آرمور فیلردار', excel: '35', orash: 39 },
    { name: 'کابل آرموردار', excel: '09', orash: 40 },
    { name: 'کابل جرقه زن', excel: '34', orash: 41 },
    { name: 'کابل گرد swr 142', excel: '15', orash: 42 },
    { name: 'کابل گرد swr 141', excel: '13', orash: 43 },
    { name: 'کابل تخت swr 142', excel: '14', orash: 44 },
    { name: 'کابل تخت swr 141', excel: '12', orash: 45 },
    { name: 'کابل کواکسیال ترکیبی', excel: '08', orash: 46 },
    { name: 'سیم المنت', excel: '30', orash: 47 },
    { name: 'کابل هالوژن فری استاندارد', excel: null, orash: 48 },
    { name: 'کابل هالوژن فری آرمور فیلردار', excel: '37', orash: 49 },
    { name: 'کابل هالوژن فری فیلردار', excel: '38', orash: 50 },
    { name: 'سیم', excel: '00', orash: 51 },
  ];

  const toLatinDigits = (s) => String(s == null ? '' : s).replace(/[۰-۹٠-٩]/g,
    (d) => String(d.charCodeAt(0) >= 0x06f0 ? d.charCodeAt(0) - 0x06f0 : d.charCodeAt(0) - 0x0660));

  // GROUPS above is the table as first supplied; `groups` is what is in force.
  // The panel can edit the table (stored server-side in data/second-groups.json),
  // and both the browser and the label builder replace it through setGroups, so
  // a printed label and a scanned one always agree on the mapping.
  let groups = GROUPS.slice();
  const getGroups = () => groups.slice();
  function setGroups(next) {
    const { groups: clean, errors } = validate(next);
    if (errors.length) throw new Error(errors.join(' | '));
    groups = clean;
    return getGroups();
  }

  /**
   * Check an edited table before anything is allowed to use it. Returns the
   * cleaned rows and every problem found — the same rules on the server and in
   * the browser, so the panel cannot save a table the label builder would choke
   * on.
   */
  function validate(rows) {
    const errors = [];
    const clean = [];
    if (!Array.isArray(rows) || !rows.length) {
      return { groups: [], errors: ['جدول گروه فرعی خالی است.'] };
    }
    const seenExcel = new Map();
    const seenOrash = new Map();
    rows.forEach((row, i) => {
      const where = `ردیف ${i + 1}`;
      const name = String((row && row.name) || '').replace(/\s+/g, ' ').trim();
      if (!name) errors.push(`${where}: نام محصول خالی است.`);

      // An empty Excel code is legitimate: that family exists in Orash but no
      // goods code reaches it.
      let excel = toLatinDigits(row && row.excel).replace(/\D/g, '');
      if (excel === '') excel = null;
      else if (excel.length > 2) errors.push(`${where} («${name}»): کد اکسل باید حداکثر دو رقم باشد.`);
      else excel = excel.padStart(2, '0');

      const orash = Number(toLatinDigits(row && row.orash));
      if (!Number.isInteger(orash) || orash <= 0) {
        errors.push(`${where} («${name}»): کد اوراش باید یک عدد صحیح مثبت باشد.`);
      }

      if (excel !== null) {
        if (seenExcel.has(excel)) errors.push(`کد اکسل «${excel}» تکراری است: «${seenExcel.get(excel)}» و «${name}».`);
        else seenExcel.set(excel, name);
      }
      if (Number.isInteger(orash) && orash > 0) {
        if (seenOrash.has(orash)) errors.push(`کد اوراش «${orash}» تکراری است: «${seenOrash.get(orash)}» و «${name}».`);
        else seenOrash.set(orash, name);
      }
      clean.push({ name, excel, orash });
    });
    return { groups: clean, errors };
  }

  /** The 2nd and 3rd digits of a goods code, or null when there are not that many. */
  function excelCodeOf(goodCode) {
    const digits = toLatinDigits(goodCode).replace(/\D/g, '');
    return digits.length >= 3 ? digits.slice(1, 3) : null;
  }

  /**
   * @param {string} goodCode  the 21-digit product code
   * @returns {{excel:string|null, matches:Array, code:number|null, status:string, message:string}}
   *   status is 'ok' (one match), 'ambiguous' (several — `code` is null until a
   *   human picks), 'unknown' (no such Excel code), or 'short' (code too short).
   */
  function resolve(goodCode) {
    const excel = excelCodeOf(goodCode);
    if (!excel) {
      return { excel: null, matches: [], code: null, status: 'short',
        message: 'کد کالا کوتاه‌تر از ۳ رقم است؛ رقم دوم و سوم خوانده نشد.' };
    }
    const matches = groups.filter((g) => g.excel === excel);
    if (matches.length === 1) {
      return { excel, matches, code: matches[0].orash, status: 'ok',
        message: `${excel} → ${matches[0].name} (کد اوراش ${matches[0].orash})` };
    }
    if (matches.length === 0) {
      return { excel, matches, code: null, status: 'unknown',
        message: `کد «${excel}» در جدول گروه فرعی نیست. یا کد کالا اشتباه است، یا این گروه باید توسط حسابداری تعریف و به جدول اضافه شود.` };
    }
    return { excel, matches, code: null, status: 'ambiguous',
      message: `کد «${excel}» به بیش از یک گروه اشاره دارد: ${matches.map((m) => `${m.name} (${m.orash})`).join(' یا ')}. باید یکی انتخاب شود.` };
  }

  return { GROUPS, getGroups, setGroups, validate, excelCodeOf, resolve };
}));
