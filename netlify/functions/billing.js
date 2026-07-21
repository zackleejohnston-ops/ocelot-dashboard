const https = require('https');
 
// Infoplus 3PL billing lives in the Invoice Worksheet table.
//   endpoint : invoiceWorksheet/search
//   $ field  : total
//   client   : lobId  (same LOB codes as the orders table)
//   date     : startDate / endDate
//   name     : e.g. "Two Leaves Billing 7/19/2026" (real run) vs "Daily 7/21/2026" (noise)
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
 
function unwrap(result) {
  if (Array.isArray(result)) return result;
  const arr = result && (result.response || result.records || result.data
    || result.results || result.invoiceWorksheetLine || result.list);
  return Array.isArray(arr) ? arr : [];
}
 
async function paginate(basePath, sortField, budgetMs) {
  const LIMIT = 250;
  const MAX_PAGES = 40;
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
    if (rows.length < LIMIT) break;
  }
  return { rows: all, error: firstErr };
}
 
const LOB_NAMES = {
  '22344': 'Joymode', '22349': 'Sol Science', '22352': 'Two Leaves and a Bud',
  '22351': 'Total Hydration', '22353': 'Vitamin iQ', '22354': 'Primitive Scientific',
  '22341': 'Barbershop Books', '22350': 'Teonan Biomedical', '22649': 'Third Party UPS'
};
 
function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}
 
exports.handler = async function (event, context) {
  try {
    const basePath = '/infoplus-wms/api/beta/invoiceWorksheet/search?filter='
      + encodeURIComponent('id gt 0');
    const paged = await paginate(basePath, '!id', 7000);
    const rows = paged.rows;
 
    const norm = rows.map(r => ({
      lob: String(pick(r, ['lobId', 'lob', 'lobCode', 'lineOfBusiness']) || ''),
      total: Number(pick(r, ['total', 'totalAmount', 'amount', 'invoiceTotal']) || 0),
      end: String(pick(r, ['endDate', 'end_date', 'periodEnd', 'toDate']) || '').slice(0, 10),
      start: String(pick(r, ['startDate', 'start_date', 'periodStart', 'fromDate']) || '').slice(0, 10),
      name: String(pick(r, ['name', 'worksheetName', 'description']) || ''),
      status: String(pick(r, ['status', 'billingStatus']) || '')
    })).filter(r => r.lob && r.total);
 
    // ===== THE FIX =====
    // Only real weekly billing runs count. Their names contain "Billing"
    // (e.g. "Two Leaves Billing 7/19/2026"). The daily noise is named "Daily ...".
    // So: keep names with "Billing", drop anything named "Daily" or "Test",
    // THEN find the newest end date among those. This locks onto Monday's run
    // and holds it all week until next Monday's run posts.
    const realRuns = norm.filter(r =>
      /billing/i.test(r.name) &&
      !/daily/i.test(r.name) &&
      !/test/i.test(r.name)
    );
 
    // Newest end date among REAL runs only (not the daily sheets).
    let latestEnd = '';
    realRuns.forEach(r => { if (r.end > latestEnd) latestEnd = r.end; });
 
    // Sum that latest real week per client.
    const byClient = {};
    realRuns.forEach(r => {
      if (r.end !== latestEnd) return;
      const code = r.lob;
      if (!byClient[code]) byClient[code] = { lob: code, name: LOB_NAMES[code] || code, latestWeek: 0, latestEnd: r.end };
      byClient[code].latestWeek += r.total;
    });
    // ===== END FIX =====
 
    const clients = Object.values(byClient).sort((a, b) => b.latestWeek - a.latestWeek);
    const latestTotal = clients.reduce((s, c) => s + c.latestWeek, 0);
 
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        clients,
        latestTotal,
        latestEnd,
        lineCount: rows.length,
        realRunCount: realRuns.length,
        infoplusError: paged.error || null
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
 
