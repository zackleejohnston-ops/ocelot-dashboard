const { getStore } = require('@netlify/blobs');
const clientsConfig = require('../../clients.json');

// Cost side of the client-margin table. Source of truth = eHub "Detailed" transactions
// export (has Account Reference per row -> per-client, no Infoplus join needed).
// The heavy CSV is parsed client-side; this function only stores/serves the small
// per-day/per-client aggregates in Blobs.
//
//   POST  body {days:{'YYYY-MM-DD':{'<acct>':{purchase,adjustment,refund,shipments}}}, sourceFile}
//         -> stores the aggregates (values are POSITIVE magnitudes in dollars)
//   GET   ?start=YYYY-MM-DD&end=YYYY-MM-DD  (inclusive, Mountain Time dates)
//         -> per-client carrierCost + chargedBack + refunds + shipments over the range,
//            client names from clients.json, unmapped accounts surfaced (never dropped).

function makeStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID || 'd542819e-69b9-4956-ab81-84f3bb87465f';
  const token  = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name: 'ocelot-stats', siteID, token });
  return getStore('ocelot-stats');
}
const KEY = 'cost/aggregates';

const ACCT = {};
(clientsConfig.clients || []).forEach(c => { ACCT[c.ehubAccountRef] = c; });

function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function resp(code, obj) {
  return { statusCode: code, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async function (event) {
  const store = makeStore();

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return resp(400, { error: 'invalid JSON body' }); }
    if (!body.days || typeof body.days !== 'object') return resp(400, { error: 'missing days{}' });
    const dates = Object.keys(body.days).sort();
    const record = {
      days: body.days,
      sourceFile: body.sourceFile || null,
      dataThroughDate: dates.length ? dates[dates.length - 1] : null,
      dataFromDate: dates.length ? dates[0] : null,
      updatedAt: new Date().toISOString()
    };
    try { await store.setJSON(KEY, record); }
    catch (e) { return resp(500, { error: 'blob write failed: ' + (e && e.message) }); }
    return resp(200, { ok: true, days: dates.length, dataFromDate: record.dataFromDate, dataThroughDate: record.dataThroughDate });
  }

  // GET (default): aggregate over [start, end] inclusive.
  const qp = event.queryStringParameters || {};
  const start = qp.start || null, end = qp.end || null;
  let rec = null;
  try { rec = await store.get(KEY, { type: 'json' }); } catch (e) {}
  if (!rec || !rec.days) return resp(200, { hasData: false, clients: [], totals: { carrierCost: 0, chargedBack: 0 }, dataThroughDate: null });

  const acc = {};              // acct -> sums
  const unmapped = new Set();
  Object.keys(rec.days).forEach(date => {
    if (start && date < start) return;
    if (end && date > end) return;
    const day = rec.days[date];
    Object.keys(day).forEach(a => {
      const d = day[a];
      if (!ACCT[a]) unmapped.add(a);
      if (!acc[a]) acc[a] = { carrierCost: 0, chargedBack: 0, refunds: 0, shipments: 0 };
      acc[a].carrierCost += d.purchase || 0;
      acc[a].chargedBack += d.adjustment || 0;
      acc[a].refunds += d.refund || 0;
      acc[a].shipments += d.shipments || 0;
    });
  });

  const clients = Object.keys(acc).map(a => {
    const c = acc[a], cfg = ACCT[a];
    return {
      account: a,
      name: cfg ? cfg.name : ('Unmapped ' + a),
      mapped: !!cfg,
      mappingConfirmed: cfg ? !!cfg.mappingConfirmed : false,
      carrierCost: round(Math.abs(c.carrierCost)),
      chargedBack: round(Math.abs(c.chargedBack)),
      refunds: round(Math.abs(c.refunds)),
      shipments: c.shipments
    };
  }).sort((x, y) => y.carrierCost - x.carrierCost);

  const totals = clients.reduce((t, c) => {
    t.carrierCost += c.carrierCost; t.chargedBack += c.chargedBack; return t;
  }, { carrierCost: 0, chargedBack: 0 });

  return resp(200, {
    hasData: true,
    start: start, end: end,
    dataFromDate: rec.dataFromDate, dataThroughDate: rec.dataThroughDate,
    clients: clients,
    totals: { carrierCost: round(totals.carrierCost), chargedBack: round(totals.chargedBack) },
    unmappedAccounts: Array.from(unmapped)
  });
};
