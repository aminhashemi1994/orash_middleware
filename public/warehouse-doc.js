'use strict';

/**
 * Warehouse receipt (رسید انبار) and issue (حواله انبار).
 *
 * Both are `CreateInvoice` with a different `ft`: 11 receives stock, 7 issues
 * it. Everything else about the two documents is identical, so they are built
 * here once.
 *
 * The interesting part is how scans become lines. A scan is one کلاف, and the
 * same product is scanned once per کلاف — so three scans of the same code *and*
 * the same متراژ are one line of three: `تعداد بسته` 3 and 300 metres. Scanning
 * the same product at a different متراژ is a different line, because the length
 * is a property of that particular کلاف, not of the product. Counting is done
 * here rather than in Orash: the service has no "add to an existing line" call,
 * and its search endpoint is broken, so the panel is the only place that can
 * see the whole batch at once.
 */
(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./packing.js') : root.Packing);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WarehouseDoc = api;
}(typeof self !== 'undefined' ? self : this, function (Packing) {

  /** `ft` values, from the invoice-type table in the service documentation. */
  const DOC_TYPES = {
    receipt: { ft: '11', title: 'رسید انبار' },
    issue:   { ft: '7',  title: 'حواله انبار' },
  };

  /**
   * Which Orash line fields carry the packing block.
   *
   * The service documents four: `upcr` (کد دسته بندی), `upc` (تعداد دسته بندی),
   * `upC1` (تعداد بسته) and `upC2` (مقدار بسته); the Orash form shows three —
   * عنوان, تعداد and تعداد جز. `upcr`/`upc` are the documented pair, so they
   * carry the title's code and its count, and تعداد جز goes to `upC2`. Change
   * these three names if a filed document proves the form maps them otherwise.
   */
  const PACKING_FIELDS = { code: 'upcr', count: 'upc', pieces: 'upC2' };

  /** تعداد جز — always zero for cable. */
  const PIECES = 0;

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  /**
   * One line per (goods code + متراژ + packing), counting the scans in each.
   *
   * @param {Array} items  scanned records: { code, name, serial, lengthValue, mode, color }
   * @returns {{lines: Array, errors: Array}}
   */
  function aggregate(items) {
    const byKey = new Map();
    const errors = [];

    (items || []).forEach((data, i) => {
      const where = `ردیف ${i + 1}`;
      const pack = Packing.resolve(data.mode, data.color);
      if (pack.status !== 'ok') { errors.push(`${where} («${data.code || '—'}»): ${pack.message}`); return; }
      const length = num(data.lengthValue);
      if (!(length > 0)) { errors.push(`${where} («${data.code || '—'}»): متراژ ندارد`); return; }
      if (!data.code) { errors.push(`${where}: کد کالا ندارد`); return; }

      // Length is part of the key: two کلاف of the same cable at different
      // lengths are different lines, not one line of two.
      const key = `${data.code}|${length}|${pack.id}`;
      const line = byKey.get(key);
      if (line) {
        line.count += 1;
        line.serials.push(data.serial);
      } else {
        byKey.set(key, {
          code: data.code,
          name: data.name || '',
          lengthValue: length,
          packingId: pack.id,
          packingTitle: pack.title,
          count: 1,
          serials: [data.serial],
        });
      }
    });

    // `quantity` is what Orash stores as تعداد کالا: metres, summed over the
    // کلاف on this line.
    const lines = [...byKey.values()].map((l) => ({ ...l, quantity: l.count * l.lengthValue }));
    return { lines, errors };
  }

  /**
   * @param {object} opts
   *   kind        'receipt' | 'issue'
   *   lines       from aggregate()
   *   createuser, departmentCode, storageCode, accountCode, createdate, createtime
   *   description optional header description
   * @returns {object} the CreateInvoice body
   */
  function build({ kind, lines, createuser, departmentCode, storageCode, accountCode,
                   createdate, createtime, description = '' }) {
    const type = DOC_TYPES[kind];
    if (!type) throw new Error(`نوع سند «${kind}» شناخته نشد`);
    const hid = '1';

    return {
      data: {
        createuser: num(createuser),
        createdate,
        createtime,
        departmentCode: num(departmentCode),
        value: [{
          hid,
          ft: type.ft,
          pc: String(accountCode ?? ''),
          hsc: String(storageCode ?? ''),
          hde: description,
          fd: lines.map((l, i) => ({
            hid,
            iid: String(i + 1),
            gs: String(l.code),
            gc: String(l.quantity),                       // تعداد کالا: متراژ
            fp: '0',                                      // نرخ: انبارگردانی نرخ ندارد
            ide: l.serials.filter(Boolean).join('، '),    // سریال‌های این ردیف
            [PACKING_FIELDS.code]: String(l.packingId),
            [PACKING_FIELDS.count]: String(l.count),      // تعداد بسته
            [PACKING_FIELDS.pieces]: String(PIECES),      // تعداد جز
          })),
        }],
      },
    };
  }

  return { DOC_TYPES, PACKING_FIELDS, PIECES, aggregate, build };
}));
