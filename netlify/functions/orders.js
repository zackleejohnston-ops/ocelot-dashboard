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
async function paginate(basePath, sortField, budgetMs) {
  const LIMIT = 250;
  const MAX_PAGES = 40;
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
 
    // ---- 2) Shipped orders for freight + shipment counts, ALL pages ----
    // ~300 orders/day means a 7-day window far exceeds one 250-row page, so we
    // page through everything. Sort by id per Infoplus guidance.
    const shipFilter = encodeURIComponent(
      'status eq "Shipped" and shipDate gt "' + weekAgo + '"'
    );
    const shipBase = '/infoplus-wms/api/beta/order/search?filter=' + shipFilter;
    const shipPaged = await paginate(shipBase, 'id', 7000);
    const shipped = shipPaged.rows;
 
    // Aggregate freight + shipment counts by LOB for yesterday and rolling 7 days.
    const byClient = {}; // lobId -> { lobId, yShip, yFreight, wShip, wFreight }
    let yShipTotal = 0, yFreightTotal = 0, wShipTotal = 0, wFreightTotal = 0;
    const daily = {};    // 'YYYY-MM-DD' -> shipment count (for the 7-day bar)
 
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
 
    // Build an ordered 7-day series (oldest -> newest) so the bar chart is stable.
    const series = [];
    for (let i = 7; i >= 1; i--) {
      const d = dayStr(i);
      series.push({ day: d, count: daily[d] || 0 });
    }
 
    const clients = Object.values(byClient).sort((a, b) => b.wShip - a.wShip);
 
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        orders,          // recent-orders table (unchanged)
        counts,          // status row (unchanged, now case/space-insensitive)
        clients,         // per-client shipments + freight, yesterday & 7-day
        yShipTotal, yFreightAvg: yShipTotal ? yFreightTotal / yShipTotal : 0,
        wShipTotal, wFreightAvg: wShipTotal ? wFreightTotal / wShipTotal : 0,
        series,          // 7-day daily shipment counts, oldest -> newest
        yesterday, weekAgo,
        shippedCount: shipped.length,
        shipError: shipPaged.error || null,
        shipTruncated: shipPaged.truncated || false,
        sampleShipDate: shipped.length ? shipped[0].shipDate : null
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
