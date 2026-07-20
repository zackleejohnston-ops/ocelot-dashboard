const https = require('https');
 
// Infoplus 3PL billing lives in the Invoice Worksheet Line table, separate from orders.
// Steven confirmed (on-site) the endpoint is reachable with this account.
//   endpoint : invoiceWorksheetLine/search
//   $ field  : total
//   client   : lobId  (same LOB codes as the orders table)
//   date     : startDate / endDate  (billing period the line covers)
const API_KEY = process.env.IP_KEY || '44820105A0C483295BC3DD05E404E55E72EA3A6FAA470C02A476DDCB3C2A2AE5';
 
function infoplusGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'ocelotlogistics.infopluswms.com',
      port: 443,
      path: path,
      method: 'GET',
      headers: { 'API-KEY': API_KEY, 'Accept': 'application/json' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve([]); }
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}
 
// Pull the array out of whatever shape Infoplus returns.
function unwrap(result) {
  if (Array.isArray(result)) return result;
  const arr = result && (result.response || result.records || result.data
    || result.results || result.invoiceWorksheetLine || result.list);
  return Array.isArray(arr) ? arr : [];
}
 
// Page through Infoplus 250 at a time (its max) until a page returns < 250.
// Per Infoplus (Jen): use the `page` param with `limit`; sort on an id field
// so live changes don't reshuffle rows mid-pull. Cap pages as a safety valve.
async function paginate(basePath, sortField, budgetMs) {
  const LIMIT = 250;
  const MAX_PAGES = 40; // 10,000 rows ceiling — plenty, prevents runaway loops
  const start = Date.now();
  let all = [];
  let firstErr = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (Date.now() - start > (budgetMs || 7000)) break;
    const path = basePath + '&limit=' + LIMIT + '&page=' + page + '&sort=' + sortField;
    const res = await infoplusGet(path);
    if (res && res.errors && !firstErr) firstErr = res.errors;
    const rows = unwrap(res);
    all = all.concat(rows);
    if (rows.length < LIMIT) break; // last page reached
  }
  return { rows: all, error: firstErr };
}
 
// YYYY-MM-DD for a date N days back from now (local server time).
function dayStr(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}
 
// Map Infoplus numeric lobId -> display name. The billing worksheet returns
// the numeric lobId (e.g. 22352), not the text code, so we map by number.
const LOB_NAMES = {
  '22344': 'Joymode', '22349': 'Sol Science', '22352': 'Two Leaves and a Bud',
  '22351': 'Total Hydration', '22353': 'Vitamin iQ', '22354': 'Primitive Scientific',
  '22341': 'Barbershop Books', '22350': 'Vitamin iQ'
};
const TWO_LEAVES_CODE = '22352';
 
// Pull a value trying several possible JSON key spellings.
function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}
 
exports.handler = async function (event, context) {
  try {
    // Billing worksheets: one row per client per week (e.g. "Joymode Billing 7/19").
    // Pull recent worksheets, newest first. No filter first — the search endpoint
    // was returning zero WITH a date filter, so grab all and bucket in JS.
    const basePath = '/infoplus-wms/api/beta/invoiceWorksheet/search?filter='
      + encodeURIComponent('id gt 0');
    const paged = await paginate(basePath, '!id', 7000);
    const rows = paged.rows;
 
    // Identify the newest End Date present, then treat that as "latest week".
    // Field names vary in JSON; try common spellings for each.
    const norm = rows.map(r => ({
      lob: String(pick(r, ['lobId', 'lob', 'lobCode', 'lineOfBusiness']) || ''),
      total: Number(pick(r, ['total', 'totalAmount', 'amount', 'invoiceTotal']) || 0),
      end: String(pick(r, ['endDate', 'end_date', 'periodEnd', 'toDate']) || '').slice(0, 10),
      start: String(pick(r, ['startDate', 'start_date', 'periodStart', 'fromDate']) || '').slice(0, 10),
      name: String(pick(r, ['name', 'worksheetName', 'description']) || ''),
      status: String(pick(r, ['status', 'billingStatus']) || '')
    })).filter(r => r.lob && r.total);
 
    // Newest end date across all rows = the latest billing week.
    let latestEnd = '';
    norm.forEach(r => { if (r.end > latestEnd) latestEnd = r.end; });
 
    // Sum the latest week per client (skip TEST rows by name if present).
    const byClient = {};
    norm.forEach(r => {
      if (/test/i.test(r.name)) return; // ignore the TEST worksheets
      if (r.end !== latestEnd) return;
      const code = r.lob;
      if (!byClient[code]) byClient[code] = { lob: code, name: LOB_NAMES[code] || code, latestWeek: 0, latestEnd: r.end };
      byClient[code].latestWeek += r.total;
    });
 
    const clients = Object.values(byClient).sort((a, b) => b.latestWeek - a.latestWeek);
    const latestTotal = clients.reduce((s, c) => s + c.latestWeek, 0);
 
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        clients,          // per-client latest-week totals
        latestTotal,      // sum across clients for the latest week
        latestEnd,        // the week-ending date used
        lineCount: rows.length,
        infoplusError: paged.error || null,
        // Diagnostic: exact JSON keys + first raw row, so we can confirm field names.
        rawKeys: rows.length ? Object.keys(rows[0]) : [],
        rawSample: rows.length ? rows[0] : null
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
