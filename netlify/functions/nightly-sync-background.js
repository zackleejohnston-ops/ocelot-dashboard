const https = require('https');
const { getStore } = require('@netlify/blobs');

// NIGHTLY AUTO-SYNC (background fn, 15-min limit) — keeps the margin table current with zero
// manual work. Pulls recent eHub charge-backs (the /reports/shipment_adjustments report, which
// only exposes a ~1-week rolling window) + recent carrier cost (/shipments), and MERGES them into
// the cost store for dates >= CUTOVER. Dates before CUTOVER stay as the validated CSV seed, so
// this never disturbs the Jul–Sep history. Idempotent: re-running overwrites the same recent days.
// Writes a `sync/status` blob for verification.

// TODO: rotate this key in Ehub and move it to a Netlify env var (EH_KEY), then delete the fallback.
const EH_KEY = process.env.EH_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpYXQiOjE3ODExMDM3MjksImRhdGEiOnsidXNlciI6eyJpZCI6MjExMzEsImN1c3RvbWVyX2lkIjoxMDgxMSwiZW1haWwiOiJ6YWNrbGVlam9obnN0b25AZ21haWwuY29tIn0sInNjb3BlcyI6WyJhcGlfcHVibGljIl19fQ.t_axIrFMt0vSjiZ3sQuignuOkadEV2Ux5r2717C6gAKsbIR-e1Ak7RCnaTVbX1SLfSf3AKniSj7aSX7Gj24h9A';
const CUTOVER = process.env.SYNC_CUTOVER || '2026-09-02';   // auto owns >= this; CSV seed owns earlier
const PURCHASE_WINDOW_DAYS = 14;

function makeStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID || 'd542819e-69b9-4956-ab81-84f3bb87465f';
  const token  = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name: 'ocelot-stats', siteID, token });
  return getStore('ocelot-stats');
}
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function ehubGet(host, path, timeoutMs) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: host, port: 443, path: path, method: 'GET', headers: { 'Authorization': 'Bearer ' + EH_KEY, 'Accept': 'application/json' } }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.end();
  });
}

// Charge-backs: rolling ~1-week window from the adjustments report. adjustment stored NEGATIVE
// (matches the CSV debit convention) so the reader's abs(sum) is the total charged back.
async function pullAdjustments(days) {
  const r = await ehubGet('api.ehub.com', '/api/v2/reports/shipment_adjustments?page=1&per_page=10000', 115000);
  let arr = [];
  try { const j = JSON.parse(r.body); arr = j.shipment_adjustments || j.adjustments || j.data || j.results || (Array.isArray(j) ? j : []); } catch (e) {}
  let kept = 0;
  arr.forEach(x => {
    const date = (x.adjustment_created_at || '').slice(0, 10);
    if (!date || date < CUTOVER) return;
    const acct = x.account_reference || '(blank)';
    days[date] = days[date] || {}; days[date][acct] = days[date][acct] || {};
    days[date][acct].adjustment = (days[date][acct].adjustment || 0) - (parseFloat(x.meter_adj) || 0);
    kept++;
  });
  return { status: r.status, records: arr.length, kept: kept, error: r.error };
}

// Carrier cost: last PURCHASE_WINDOW_DAYS of shipments (by shipDate). purchase stored NEGATIVE.
async function pullPurchases(days) {
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - PURCHASE_WINDOW_DAYS);
  const fromTime = ymd(from) + ' 12:00:00 AM';
  const toTime = ymd(now) + ' 11:59:59 PM';
  const seen = {}; let count = 0, pages = 0; const start = Date.now();
  for (let page = 1; page <= 60; page++) {
    if (Date.now() - start > 300000) break; // 5-min safety
    const qs = 'per_page=200&page=' + page + '&status=shipped&ship_from_time=' + encodeURIComponent(fromTime) + '&ship_to_time=' + encodeURIComponent(toTime);
    const r = await ehubGet('app.ehub.com', '/api/v2/shipments?' + qs, 15000);
    let rows = [];
    try { const j = JSON.parse(r.body); rows = Array.isArray(j) ? j : (j.shipments || j.data || []); } catch (e) {}
    pages = page;
    let added = 0;
    rows.forEach(s => {
      const key = s.id != null ? s.id : (s.parcels && s.parcels[0] && s.parcels[0].tracking_number);
      if (key != null) { if (seen[key]) return; seen[key] = 1; }
      const date = (s.shipped_at || '').slice(0, 10);
      if (!date || date < CUTOVER) return;
      const acct = s.account_reference || '(blank)';
      const rate = s.shipping_service && s.shipping_service.rate ? parseFloat(s.shipping_service.rate) : 0;
      days[date] = days[date] || {}; days[date][acct] = days[date][acct] || {};
      days[date][acct].purchase = (days[date][acct].purchase || 0) - rate;
      days[date][acct].shipments = (days[date][acct].shipments || 0) + 1;
      count++; added++;
    });
    if (rows.length < 200) break;
    if (added === 0) break;
  }
  return { shipments: count, pages: pages };
}

exports.handler = async function () {
  const store = makeStore();
  const incoming = {};           // days[date][account] = partial fields
  const status = { ranAt: new Date().toISOString(), cutover: CUTOVER };

  try { status.adjustments = await pullAdjustments(incoming); } catch (e) { status.adjustments = { error: String(e && e.message) }; }
  try { status.purchases = await pullPurchases(incoming); } catch (e) { status.purchases = { error: String(e && e.message) }; }

  // round + merge into cost/aggregates for dates >= CUTOVER
  let rec = null;
  try { rec = await store.get('cost/aggregates', { type: 'json' }); } catch (e) {}
  if (!rec || !rec.days) rec = { days: {} };
  let daysWritten = 0;
  Object.keys(incoming).forEach(date => {
    rec.days[date] = rec.days[date] || {};
    Object.keys(incoming[date]).forEach(acct => {
      const cur = rec.days[date][acct] || { purchase: 0, adjustment: 0, refund: 0, shipments: 0 };
      const add = incoming[date][acct];
      if ('purchase' in add) cur.purchase = r2(add.purchase);
      if ('adjustment' in add) cur.adjustment = r2(add.adjustment);
      if ('shipments' in add) cur.shipments = add.shipments;
      rec.days[date][acct] = cur;
    });
    daysWritten++;
  });
  const dates = Object.keys(rec.days).sort();
  rec.dataFromDate = dates[0] || null;
  rec.dataThroughDate = dates[dates.length - 1] || null;
  rec.updatedAt = new Date().toISOString();
  try { await store.setJSON('cost/aggregates', rec); status.merged = { daysWritten: daysWritten, dataThroughDate: rec.dataThroughDate }; }
  catch (e) { status.merged = { error: String(e && e.message) }; }

  try { await store.setJSON('sync/status', status); } catch (e) {}
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(status) };
};
