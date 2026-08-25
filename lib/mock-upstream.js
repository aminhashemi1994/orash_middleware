'use strict';

/**
 * Offline simulator for the Orash web service.
 *
 * Enabled with MOCK=1. It answers the same envelopes the real service does
 * (including the "HTTP 200 + hasError:false but the real outcome is inside
 * content[]" quirk) so the scanner pipeline can be exercised end to end while
 * the real host is unreachable.
 */

const TEST_DB = '61c7f1d6-0297-49e4-a02c-546b1c12f22c';
const PROD_DB = '44e66728-fea3-4fc9-b2bd-5ecb9bb893e2';

// Reference codes the simulator accepts. Anything else is rejected the same way
// the real service rejects unknown codes.
const UNITS = [1, 2, 3, 4, 5];            // 1=عدد 2=متر 3=کیلوگرم ...
const PACKINGS = [1, 2, 3];
const MAIN_GROUPS = [1, 2, 10];
const SECOND_GROUPS = [1, 2, 3, 11];

const okEnvelope = (content) => ({ content, message: 'Done', hasError: false, responseCode: 100 });
const itemOk = (code, msg) => okEnvelope([{ content: String(code), errorCode: 0, errorMessage: msg }]);
const itemFail = (msg) => okEnvelope([{ content: '0', errorCode: -1, errorMessage: msg }]);

// In-memory "database" for the session.
let nextGoodCode = 71012;
const goods = [
  { code: '71001', name: 'کابل ۲.۵ افشان', type: 1, serial: '1', unitsName: 'متر', mainGroupName: 'برق', secondGroupName: 'کابل', fiPrice1: 185000 },
  { code: '71002', name: 'کلید مینیاتوری ۱۶ آمپر', type: 1, serial: '2', unitsName: 'عدد', mainGroupName: 'برق', secondGroupName: 'کلید', fiPrice1: 420000 },
  { code: '71003', name: 'خدمات نصب', type: 2, serial: '3', unitsName: 'عدد', mainGroupName: 'خدمات', secondGroupName: 'نصب', fiPrice1: 1500000 },
];
let nextInvoiceNo = 4101;

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function createGood(data) {
  if (!data || typeof data !== 'object') return itemFail('اطلاعات کالا ارسال نشده است .');
  const name = String(data.name ?? '').trim();
  if (!name) return itemFail('مقدار فيلد عنوان کالا و خدمات نمي تواند خالي باشد .');
  if (goods.some((g) => g.name === name)) return itemFail('مقدار فيلد عنوان کالا و خدمات تکراري است .');
  if (data.code && goods.some((g) => String(g.code) === String(data.code))) {
    return itemFail('کد کالا و خدمات تکراري است .');
  }
  if (!UNITS.includes(Number(data.unitIdRef))) return itemFail('کد واحد اندازه گيري وارد شده صحيح نيست .');
  if (data.unitPackingCodeRef != null && data.unitPackingCodeRef !== '' && !PACKINGS.includes(Number(data.unitPackingCodeRef))) {
    return itemFail('کد نوع بسته بندي وارد شده صحيح نيست .');
  }
  if (!MAIN_GROUPS.includes(Number(data.mainGroupCodeRef))) return itemFail('کد گروه اصلي صحيح نيست .');
  if (!SECOND_GROUPS.includes(Number(data.secondGroupCodeRef))) return itemFail('کد گروه فرعي صحيح نيست .');

  const code = data.code ? String(data.code) : String(nextGoodCode++);
  goods.push({
    code,
    name,
    type: Number(data.type) || 1,
    serial: String(data.serial ?? ''),
    unitsName: 'واحد ' + data.unitIdRef,
    mainGroupName: 'گروه ' + data.mainGroupCodeRef,
    secondGroupName: 'زیرگروه ' + data.secondGroupCodeRef,
    fiPrice1: Number(data.fiPrice1) || 0,
  });
  return itemOk(code, `کالاي مورد نظر با ${code} درج شد`);
}

function createInvoice(data) {
  const header = Array.isArray(data?.value) ? data.value[0] : null;
  if (!header) return itemFail('اطلاعات سربرگ ارسال نشده است .');
  if (!header.fd || !header.fd.length) return itemFail('فاکتور فاقد رديف کالا است .');
  for (const line of header.fd) {
    if (!goods.some((g) => String(g.code) === String(line.gs))) {
      return itemFail(`کد کالاي ${line.gs} صحيح نيست .`);
    }
  }
  const no = nextInvoiceNo++;
  return itemOk(no, `فاکتور با شماره ${no} ثبت شد`);
}

/**
 * @param {string} name  proxy route name
 * @param {object} payload  { baseUrl, token, uniqueID, query, body }
 * @returns {Promise<{status:number, body:any}>}
 */
async function mockForward(name, payload) {
  await delay(120 + Math.random() * 180); // make the UI's busy states visible
  const body = payload.body || {};
  const data = body.data || {};

  switch (name) {
    case 'databases':
      return { status: 200, body: okEnvelope({
        lockCode: '123456',
        orashMisDatabases: [
          { uniqueID: TEST_DB, name: 'Orash3', companyName: 'دیتای تست برای وب سرویس' },
          { uniqueID: PROD_DB, name: 'Orash', companyName: 'شرکت اصلی (تولید)' },
        ],
      }) };

    case 'users':
      return { status: 200, body: okEnvelope([
        { id: 5, userName: 'admin', fullName: 'مدیر سیستم' },
        { id: 9, userName: 'anbardar', fullName: 'انباردار' },
      ]) };

    case 'auth': {
      if (!body.username) return { status: 200, body: { content: 'نام کاربري يا کلمه عبور صحيح نيست', message: 'fail', hasError: false, responseCode: 100 } };
      const fakeJwt = 'MOCK.' + Buffer.from(JSON.stringify({ u: body.username, exp: Date.now() + 43200e3 })).toString('base64url') + '.sim';
      return { status: 200, body: okEnvelope({ token: fakeJwt, refreshToken: 'mock-refresh', name: body.username }) };
    }

    case 'departments':
      return { status: 200, body: okEnvelope([
        { departmentCode: 1, departmentName: 'دفتر مرکزی' },
        { departmentCode: 2, departmentName: 'شعبه تهران' },
      ]) };

    case 'storages':
      return { status: 200, body: okEnvelope([
        { storageCode: 1, storageName: 'انبار مرکزی', departmentCode: 1, departmentName: 'دفتر مرکزی' },
        { storageCode: 2, storageName: 'انبار فروشگاه', departmentCode: 1, departmentName: 'دفتر مرکزی' },
      ]) };

    case 'stock':
      return { status: 200, body: okEnvelope([]) };

    case 'tafsili':
      return { status: 200, body: okEnvelope([
        { tafsiliCode: 101, tafsiliName: 'پروژه الف' },
        { tafsiliCode: 102, tafsiliName: 'پروژه ب' },
      ]) };

    case 'customers':
      return { status: 200, body: okEnvelope([
        { code: 1001, name: 'مشتری نقدی' },
        { code: 1002, name: 'فروشگاه نمونه' },
      ]) };

    case 'goods':
      return { status: 200, body: okEnvelope(goods.slice()) };

    case 'createGood':
      return { status: 200, body: createGood(data) };

    case 'createInvoice':
      return { status: 200, body: createInvoice(data) };

    default:
      return { status: 404, body: { content: null, message: 'mock: unknown route ' + name, hasError: true, responseCode: 404 } };
  }
}

module.exports = { mockForward, TEST_DB, PROD_DB, UNITS, PACKINGS, MAIN_GROUPS, SECOND_GROUPS };
