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
 
exports.handler = async function (event, context) {
  try {
    // Pull the most recent billing worksheet lines. Filter on endDate so we get
    // whatever was billed recently; page through all results; bucket in JS.
    const since = dayStr(35); // wide window so we always catch the latest weekly run
    const filter = encodeURIComponent('endDate gt "' + since + '"');
    const basePath = '/infoplus-wms/api/beta/invoiceWorksheetLine/search?filter=' + filter;
 
    // Sort on the record id so live edits don't reshuffle rows between pages.
    // Sort on a known-valid field (endDate) so Infoplus doesn't reject the query.
    // Not a true id sort, but stable enough for a 35-day billing window.
    const paged = await paginate(basePath, '!endDate', 7000);
    const safeLines = paged.rows;
 
    const yesterday = dayStr(1);
    const weekAgo = dayStr(7);
 
    // Aggregate by LOB (client) for two windows: yesterday and rolling 7 days.
    // Also track the single most-recent billed week per client for Richard's strip.
    const byClient = {};   // lobId -> { name, yesterday, week7, latestWeek, latestEnd }
    let totalYesterday = 0;
    let totalWeek7 = 0;
 
    safeLines.forEach(line => {
      const lob = line.lobId != null ? String(line.lobId) : 'unknown';
      const amt = Number(line.total) || 0;
      const end = (line.endDate || '').slice(0, 10);
 
      if (!byClient[lob]) {
        byClient[lob] = { lobId: lob, yesterday: 0, week7: 0, latestWeek: 0, latestEnd: '' };
      }
      const c = byClient[lob];
 
      if (end === yesterday) { c.yesterday += amt; totalYesterday += amt; }
      if (end >= weekAgo)    { c.week7 += amt;     totalWeek7 += amt; }
 
      // Latest billed week = lines sharing the newest endDate we've seen for this client.
      if (end > c.latestEnd) { c.latestEnd = end; c.latestWeek = amt; }
      else if (end === c.latestEnd) { c.latestWeek += amt; }
    });
 
    const clients = Object.values(byClient).sort((a, b) => b.latestWeek - a.latestWeek);
    const latestTotal = clients.reduce((s, c) => s + c.latestWeek, 0);
 
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        clients,          // per-client: yesterday, week7, latestWeek, latestEnd
        totalYesterday,   // sum billed with endDate == yesterday
        totalWeek7,       // sum billed in the rolling 7-day window
        latestTotal,      // sum of each client's most recent billed week
        lineCount: safeLines.length,
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
