const https = require('https');
const { getStore } = require('@netlify/blobs');

// This (older) Netlify site doesn't auto-inject the Blobs context, so configure the
// store explicitly from env vars set once in the Netlify UI. Falls back to auto-config
// (which works on newer sites) if the env vars aren't present.
function makeStore() {
  // Site ID isn't secret — hardcode super-dodol-d17ae4's so only the TOKEN needs
  // to be an env var. An env var still overrides if set.
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID || 'd542819e-69b9-4956-ab81-84f3bb87465f';
  const token  = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name: 'ocelot-stats', siteID, token });
  return getStore('ocelot-stats');
}

// BACKGROUND function (15-min limit) — this is where the heavy Ehub pagination lives,
// off the request path. It fully tallies each recent SHIPPING DAY (weekday) from Ehub
// and caches an exact { count, avgFreight, byClient } per day in Netlify Blobs. The fast
// `stats.js` reader then serves those cached numbers to the dashboard instantly.
//
// Trigger: cron (via cron-rollup.js) once a day, and manually by HTTP for backfill/testing:
//   GET /.netlify/functions/rollup-background            -> refresh last 7 shipping days (skip complete ones)
//   GET /.netlify/functions/rollup-background?force=1    -> recompute them even if already cached
//   GET /.netlify/functions/rollup-background?days=10    -> how many shipping days back to cover

// TODO: rotate this key in Ehub and move it to a Netlify env var (EH_KEY), then delete the fallback.
const EH_KEY = process.env.EH_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpYXQiOjE3ODExMDM3MjksImRhdGEiOnsidXNlciI6eyJpZCI6MjExMzEsImN1c3RvbWVyX2lkIjoxMDgxMSwiZW1haWwiOiJ6YWNrbGVlam9obnN0b25AZ21haWwuY29tIn0sInNjb3BlcyI6WyJhcGlfcHVibGljIl19fQ.t_axIrFMt0vSjiZ3sQuignuOkadEV2Ux5r2717C6gAKsbIR-e1Ak7RCnaTVbX1SLfSf3AKniSj7aSX7Gj24h9A';

function ymd(d) {
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

// Last N shipping days (weekdays), most-recent first, starting from yesterday.
function lastShippingDays(n) {
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (out.length < n) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(ymd(d)); // skip Sun/Sat
    d.setDate(d.getDate() - 1);
  }
  return out;
}

function ehubGetPage(fromTime, toTime, page) {
  return new Promise((resolve) => {
    const qs = 'per_page=200'
      + '&page=' + page
      + '&status=shipped'
      + '&ship_from_time=' + encodeURIComponent(fromTime)
      + '&ship_to_time='   + encodeURIComponent(toTime);
    const options = {
      hostname: 'app.ehub.com',
      port: 443,
      path: '/api/v2/shipments?' + qs,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + EH_KEY, 'Accept': 'application/json' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.shipments)) return body.shipments;
  if (body && Array.isArray(body.data)) return body.data;
  return [];
}
function keyOf(s) {
  if (s.id != null) return 'id:' + s.id;
  if (s.shipment_id != null) return 'sid:' + s.shipment_id;
  if (s.parcels && s.parcels[0] && s.parcels[0].tracking_number) return 'tn:' + s.parcels[0].tracking_number;
  return JSON.stringify(s).slice(0, 160);
}
function lobOf(s) {
  if (s.account_reference && String(s.account_reference).indexOf('-') > -1) {
    return String(s.account_reference).split('-').pop();
  }
  if (s.label_text1) return String(s.label_text1).trim().split(/\s+/)[0];
  return 'unknown';
}

// Fully paginate one shipping day. Generous caps because we're in a background function.
async function computeDay(dateStr) {
  const fromTime = dateStr + ' 12:00:00 AM';
  const toTime   = dateStr + ' 11:59:59 PM';
  const PER_PAGE = 200, MAX_PAGES = 100, BUDGET_MS = 120000; // 2 min/day safety
  const start = Date.now();
  const seen = {};
  let count = 0, freightSum = 0, ratedCount = 0;
  const byClient = {};
  let complete = true;

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (Date.now() - start > BUDGET_MS) { complete = false; break; }
    const body = await ehubGetPage(fromTime, toTime, page);
    const pageRows = rowsOf(body);
    let added = 0;
    for (let i = 0; i < pageRows.length; i++) {
      const s = pageRows[i];
      const k = keyOf(s);
      if (seen[k]) continue;
      seen[k] = 1;
      added++;
      count++;
      const rate = s.shipping_service && s.shipping_service.rate ? parseFloat(s.shipping_service.rate) : 0;
      if (rate > 0) { freightSum += rate; ratedCount++; }
      const lob = lobOf(s);
      byClient[lob] = (byClient[lob] || 0) + 1;
    }
    if (pageRows.length < PER_PAGE) break; // last page
    if (added === 0) break;                // cursor-style / page ignored
    if (page === MAX_PAGES) complete = false;
  }

  return {
    date: dateStr,
    count: count,
    ratedCount: ratedCount,
    freightSum: Math.round(freightSum * 100) / 100,
    avgFreight: ratedCount ? Math.round((freightSum / ratedCount) * 100) / 100 : 0,
    byClient: byClient,
    complete: complete,
    computedAtEpoch: Date.now()
  };
}

exports.handler = async function (event, context) {
  const store = makeStore();
  const qp = (event && event.queryStringParameters) || {};
  const force = qp.force === '1';
  const n = Math.max(1, Math.min(20, parseInt(qp.days, 10) || 7));
  const targets = lastShippingDays(n);
  const processed = [];

  for (let i = 0; i < targets.length; i++) {
    const dateStr = targets[i];
    if (!force) {
      let existing = null;
      try { existing = await store.get('day:' + dateStr, { type: 'json' }); } catch (e) { existing = null; }
      if (existing && existing.complete) { processed.push({ date: dateStr, skipped: true }); continue; }
    }
    const res = await computeDay(dateStr);
    try { await store.setJSON('day:' + dateStr, res); } catch (e) { /* keep going */ }
    processed.push({ date: dateStr, count: res.count, avgFreight: res.avgFreight, complete: res.complete });
  }

  // Body is ignored for background invocations (client already got 202); useful when hit directly.
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, force: force, processed: processed })
  };
};
