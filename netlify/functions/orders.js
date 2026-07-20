const https = require('https');
 
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
    req.setTimeout(4000, () => { req.destroy(); resolve([]); }); // don't hang the function
    req.end();
  });
}
 
// Find the records array regardless of how Infoplus wraps the response.
function unwrap(result) {
  if (Array.isArray(result)) return result;
  const arr = result && (result.response || result.records || result.data
    || result.results || result.order || result.list);
  return Array.isArray(arr) ? arr : [];
}
 
// Page through Infoplus 250 at a time until a page returns < 250 (Jen's rule).
// Sort on an id field so live changes don't reshuffle rows between pages.
// Hard stops: page cap AND a wall-clock budget, so we never hit Netlify's
// 10s function limit — better to return partial data than a 502.
async function paginate(basePath, sortField, budgetMs, maxPages) {
  const LIMIT = 250;
  const MAX_PAGES = maxPages || 40;
  const start = Date.now();
  let all = [];
  let firstErr = null;
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (Date.now() - start > (budgetMs || 7000)) { truncated = true; break; }
    const path = basePath + '&limit=' + LIMIT + '&page=' + page + '&sort=' + sortField;
    const res = await infoplusGet(path);
    if (res && res.errors && !firstErr) firstErr = res.errors;
    const rows = unwrap(res);
    all = all.concat(rows);
    if (rows.length < LIMIT) break;
    if (page === MAX_PAGES) truncated = true;
  }
  return { rows: all, error: firstErr, truncated: truncated };
}
 
function dayStr(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}
 
// Infoplus status strings don't match tile labels 1:1 (e.g. live status is
// "Processing", not "Processed"). Normalize so nothing falls through uncounted.
const NORM = {
  pending: 'Pending', error: 'Error', onorder: 'On Order',
  processing: 'Processed', processed: 'Processed', shipped: 'Shipped',
  backorder: 'Back Order', back: 'Back Order',
  cancelled: 'Cancelled', canceled: 'Cancelled'
};
 
exports.handler = async function (event, context) {
  try {
    const yesterday = dayStr(1);
    const weekAgo = dayStr(7);
 
    // ---- 1) Status counts + recent-orders table (unchanged behavior) ----
    const ordersRes = await infoplusGet(
      '/infoplus-wms/api/beta/order/search?filter=orderNo%20gt%200&limit=100&sort=!orderDate'
    );
    const orders = unwrap(ordersRes);
    const counts = { Pending: 0, Error: 0, 'On Order': 0, Processed: 0, Shipped: 0, 'Back Order': 0, Cancelled: 0 };
    orders.forEach(o => {
      const k = NORM[(o.status || '').toLowerCase().replace(/[^a-z]/g, '')];
      if (k) counts[k]++;
    });
 
    // ---- 2) Shipped orders for the 7-day bar + freight, isolated ----
    // This pull is heavy and must NEVER take down the status counts above.
    // Wrapped in its own try/catch: if it fails or times out, the core
    // dashboard still returns 200 and only the 7-day bar goes empty.
    let clients = [], series = [], shipDiag = {};
    let yShipTotal = 0, yFreightAvg = 0, wShipTotal = 0, wFreightAvg = 0;
    try {
      const shipFilter = encodeURIComponent(
        'status eq "Shipped" and shipDate gt "' + weekAgo + '"'
      );
      const shipBase = '/infoplus-wms/api/beta/order/search?filter=' + shipFilter;
      // Hard cap: 6 pages / ~5s. Enough to sample the week; can't blow memory/time.
      // Sort NEWEST first (!orderNo) so the page cap captures recent shipments,
      // not the oldest order numbers. Ascending was fetching stale orders and
      // stopping before it reached the last few days.
      const shipPaged = await paginate(shipBase, '!orderNo', 5000, 6);
      const shipped = shipPaged.rows;
 
      const byClient = {};
      let yFreightTotal = 0, wFreightTotal = 0;
      const daily = {};
      shipped.forEach(o => {
        const lob = o.lobId != null ? String(o.lobId) : 'unknown';
        const freight = Number(o.freightAmount) || 0;
        const day = (o.shipDate || '').slice(0, 10);
        if (!byClient[lob]) byClient[lob] = { lobId: lob, yShip: 0, yFreight: 0, wShip: 0, wFreight: 0 };
        const c = byClient[lob];
        if (day >= weekAgo) {
          c.wShip++; c.wFreight += freight; wShipTotal++; wFreightTotal += freight;
          daily[day] = (daily[day] || 0) + 1;
        }
        if (day === yesterday) {
          c.yShip++; c.yFreight += freight; yShipTotal++; yFreightTotal += freight;
        }
      });
      for (let i = 7; i >= 1; i--) { const d = dayStr(i); series.push({ day: d, count: daily[d] || 0 }); }
      clients = Object.values(byClient).sort((a, b) => b.wShip - a.wShip);
      yFreightAvg = yShipTotal ? yFreightTotal / yShipTotal : 0;
      wFreightAvg = wShipTotal ? wFreightTotal / wShipTotal : 0;
      shipDiag = { shippedCount: shipped.length, shipError: shipPaged.error || null, shipTruncated: shipPaged.truncated || false };
      // Surface the field names of one order + any field whose name hints at
      // freight/cost/postage, so we can identify the real freight field.
      if (shipped.length) {
        const o0 = shipped[0];
        const keys = Object.keys(o0);
        const freightish = {};
        keys.forEach(k => {
          if (/freight|cost|postage|ship.*charge|charge|rate|amount/i.test(k)) freightish[k] = o0[k];
        });
        shipDiag.sampleFields = { allKeys: keys, freightCandidates: freightish };
      }
    } catch (shipErr) {
      // 7-day bar unavailable, but core dashboard is fine.
      shipDiag = { shippedCount: 0, shipError: String(shipErr && shipErr.message || shipErr), shipTruncated: true };
      for (let i = 7; i >= 1; i--) { const d = dayStr(i); series.push({ day: d, count: 0 }); }
    }
 
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        orders,          // recent-orders table
        counts,          // status row
        clients,         // per-client shipments + freight (empty if pull failed)
        yShipTotal, yFreightAvg,
        wShipTotal, wFreightAvg,
        series,          // 7-day daily counts (zeros if pull failed)
        yesterday, weekAgo,
        shippedCount: shipDiag.shippedCount,
        shipError: shipDiag.shipError,
        shipTruncated: shipDiag.shipTruncated,
        sampleFields: shipDiag.sampleFields || null
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
