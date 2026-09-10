'use strict';

/**
 * Packing titles (دسته‌بندی) — from the QR's mode and colour to the Orash id.
 *
 * A warehouse receipt or issue names the packing by code, and that code depends
 * on two things the label already carries: the mode says what the goods are
 * packed in (`L` → کلاف), and the colour completes the title:
 *
 *     mode L + رنگ «زرد»  →  «کلاف-زرد»  →  upcr 6
 *     mode L + no colour   →  «کلاف»      →  upcr 2
 *
 * The titles are Orash's, not ours: they are matched exactly, and a combination
 * that is not in the table is refused rather than guessed — a receipt filed
 * under the wrong packing is silent and wrong.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Packing = api;
}(typeof self !== 'undefined' ? self : this, function () {

  /** id, exactly as Orash numbers it, and the title it carries there. */
  const PACKINGS = [
    { id: 2, title: 'کلاف' },
    { id: 3, title: 'قرقره-آبی' },
    { id: 5, title: 'کلاف-مشکی' },
    { id: 6, title: 'کلاف-زرد' },
    { id: 7, title: 'کلاف-زرد راه سبز' },
    { id: 8, title: 'کلاف-سبز' },
    { id: 9, title: 'کلاف-قرمز' },
    { id: 10, title: 'کلاف-آبی' },
    { id: 11, title: 'کلاف-قهوه ای' },
    { id: 12, title: 'کلاف-طوسی' },
    { id: 13, title: 'کلاف-قرمز آجری' },
    { id: 14, title: 'کلاف-رنگ متغیر' },
  ];

  /** What each QR mode is packed in. More modes will bring more bases. */
  const MODE_BASE = { L: 'کلاف' };

  let packings = PACKINGS.slice();
  const getPackings = () => packings.slice();

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  /**
   * Check an edited table before anything uses it. Same rules on the server and
   * in the browser, so the panel cannot save a table the receipt builder would
   * choke on.
   */
  function validate(rows) {
    const errors = [];
    const clean_rows = [];
    if (!Array.isArray(rows) || !rows.length) {
      return { packings: [], errors: ['جدول بسته‌بندی خالی است.'] };
    }
    const seenId = new Map();
    const seenTitle = new Map();
    rows.forEach((row, i) => {
      const where = `ردیف ${i + 1}`;
      const title = clean(row && row.title);
      if (!title) errors.push(`${where}: عنوان بسته‌بندی خالی است.`);
      const id = Number(String((row && row.id) ?? '').replace(/[۰-۹٠-٩]/g,
        (d) => String(d.charCodeAt(0) >= 0x06f0 ? d.charCodeAt(0) - 0x06f0 : d.charCodeAt(0) - 0x0660)));
      if (!Number.isInteger(id) || id <= 0) errors.push(`${where} («${title}»): کد باید یک عدد صحیح مثبت باشد.`);
      else if (seenId.has(id)) errors.push(`کد «${id}» تکراری است: «${seenId.get(id)}» و «${title}».`);
      else seenId.set(id, title);
      if (title) {
        if (seenTitle.has(title)) errors.push(`عنوان «${title}» تکراری است.`);
        else seenTitle.set(title, id);
      }
      clean_rows.push({ id, title });
    });
    return { packings: clean_rows, errors };
  }

  function setPackings(next) {
    const { packings: clean_rows, errors } = validate(next);
    if (errors.length) throw new Error(errors.join(' | '));
    packings = clean_rows;
    return getPackings();
  }

  /**
   * @param {string} mode   the QR's mode (`L` today)
   * @param {string} color  the QR's colour, or empty
   * @returns {{title:string, id:number|null, status:string, message:string}}
   *   status 'ok', 'unknown-mode', or 'unknown-title'.
   */
  function resolve(mode, color) {
    const base = MODE_BASE[String(mode || '').toUpperCase()];
    if (!base) {
      return { title: '', id: null, status: 'unknown-mode',
        message: `حالت «${mode || '—'}» بسته‌بندی تعریف‌شده‌ای ندارد` };
    }
    const c = clean(color);
    const title = c ? `${base}-${c}` : base;
    const hit = packings.find((p) => p.title === title);
    if (!hit) {
      return { title, id: null, status: 'unknown-title',
        message: `بسته‌بندی «${title}» در جدول نیست. یا رنگ اشتباه است، یا این بسته‌بندی باید توسط حسابداری تعریف و به جدول اضافه شود.` };
    }
    return { title, id: hit.id, status: 'ok', message: `${hit.id} — ${title}` };
  }

  return { PACKINGS, MODE_BASE, getPackings, setPackings, validate, resolve };
}));
