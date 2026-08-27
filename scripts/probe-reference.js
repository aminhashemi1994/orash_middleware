'use strict';

/**
 * What does GetGoods actually return?
 *
 * The reference dropdowns in the panel (unit, packing, main/second group) can
 * only be built from goods that already exist — the service has no endpoint
 * that lists those codes (docs/orash-web-service-api.md §5.1). The PDF never
 * documents this response's schema either, so the field names the panel reads
 * are an educated guess until a live call proves them.
 *
 * This script makes that one call and prints the keys it got back. It only
 * reads: Auth + GetGoods, nothing else.
 *
 *   node scripts/probe-reference.js <username> <password> [prod|test]
 */

const BASE = process.env.ORASH_BASE_URL || 'http://192.168.3.210:5000';
const DBS = {
  prod: '44e66728-fea3-4fc9-b2bd-5ecb9bb893e2',
  test: '61c7f1d6-0297-49e4-a02c-546b1c12f22c',
};

const [username, password, which = 'prod'] = process.argv.slice(2);
if (!username || !password) {
  console.error('usage: node scripts/probe-reference.js <username> <password> [prod|test]');
  process.exit(2);
}
const uniqueID = DBS[which] || which;

const post = async (path, body) => {
  const res = await fetch(new URL(path, BASE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(global.TOKEN ? { Authorization: 'bearer ' + global.TOKEN } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text }; }
};

/** The same unwrapping the panel does, kept in step with public/app.js. */
function rowsOf(data) {
  const c = data && data.content;
  if (Array.isArray(c)) return c;
  if (c && typeof c === 'object') {
    let best = null;
    for (const v of Object.values(c)) {
      if (Array.isArray(v) && v.length && typeof v[0] === 'object' && (!best || v.length > best.length)) best = v;
    }
    return best || [c];
  }
  return [];
}

const FIELDS = [
  ['واحد شمارش (unitIdRef)', ['unitsName', 'unitName'], ['unitIdRef', 'unitId', 'unitCode']],
  ['نوع بسته‌بندی (unitPackingCodeRef)', ['unitPackingName'], ['unitPackingCodeRef', 'unitPackingCode']],
  ['گروه اصلی (mainGroupCodeRef)', ['mainGroupName'], ['mainGroupCodeRef', 'mainGroupCode']],
  ['گروه فرعی (secondGroupCodeRef)', ['secondGroupName'], ['secondGroupCodeRef', 'secondGroupCode']],
];

(async () => {
  console.log(`base=${BASE}  db=${which} (${uniqueID})`);

  const auth = await post('/api/Auth', { uniqueID, username, password });
  const token = auth.body && auth.body.content && auth.body.content.token;
  if (!token) {
    console.error('login failed:', JSON.stringify(auth.body).slice(0, 400));
    process.exit(1);
  }
  global.TOKEN = token;
  console.log('login OK as', auth.body.content.name);

  const goods = await post('/api/v3/Good/GetGoods', {
    uniqueID,
    data: {
      showStockFlg: 0, flagDepartment: true, fromDepartment: 0, toDepartment: 0,
      currentUserId: 0, withFi: false,
    },
  });
  console.log('GetGoods HTTP', goods.status, '| hasError:', goods.body && goods.body.hasError,
    '| message:', goods.body && goods.body.message);

  const rows = rowsOf(goods.body);
  console.log('rows:', rows.length);
  if (!rows.length) {
    console.log('raw (first 1500 chars):\n' + JSON.stringify(goods.body).slice(0, 1500));
    return;
  }

  console.log('\nkeys on the first row:\n ', Object.keys(rows[0]).join(', '));
  console.log('\nfirst row:\n' + JSON.stringify(rows[0], null, 1));

  console.log('\n--- what the panel would put in each dropdown ---');
  for (const [title, nameKeys, codeKeys] of FIELDS) {
    const seen = new Map();
    for (const row of rows) {
      const nk = nameKeys.find((k) => row[k] !== undefined && row[k] !== null && row[k] !== '');
      const ck = codeKeys.find((k) => row[k] !== undefined && row[k] !== null && row[k] !== '');
      if (!nk && !ck) continue;
      const name = nk ? String(row[nk]).trim() : String(row[ck]);
      if (!seen.has(name)) seen.set(name, new Set());
      if (ck) seen.get(name).add(row[ck]);
    }
    const items = [...seen.entries()].map(([n, c]) => `${n}=${c.size ? [...c].join('/') : '؟'}`);
    console.log(`${title}: ${items.length ? items.join('، ') : '(خالی — نام فیلد نمی‌خواند)'}`);
  }
})().catch((e) => { console.error('ERROR', e.message || e); process.exit(1); });
