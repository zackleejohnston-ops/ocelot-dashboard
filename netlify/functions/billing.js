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
    req.end();
  });
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
    // whatever was billed in the current cycle, newest first, then bucket in JS.
    const since = dayStr(35); // wide window so we always catch the latest weekly run
    const filter = encodeURIComponent('endDate gt "' + since + '"');
    const path = '/infoplus-wms/api/beta/invoiceWorksheetLine/search'
               + '?filter=' + filter
               + '&limit=500'
               + '&sort=!endDate';
 
    const result = await infoplusGet(path);
    // Infoplus may return a bare array, or wrap it under one of several keys.
    // Find the array no matter the shape so we never crash on .forEach.
    const lines = Array.isArray(result) ? result
      : (result.response || result.records || result.data || result.results
         || result.invoiceWorksheetLine || result.list || []);
    const safeLines = Array.isArray(lines) ? lines : [];
 
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
        rawShape: Array.isArray(result) ? 'array' : Object.keys(result || {}).join(',')
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
