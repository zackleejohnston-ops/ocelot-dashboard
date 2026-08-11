const { getStore } = require('@netlify/blobs');

// Fast reader (<1s) — serves the pre-tallied numbers the background rollup cached in Blobs.
// The dashboard calls THIS, not Ehub directly, for the shipped hero + weekly total.
//   lastDay : the most recent cached shipping day  { date, count, avgFreight, byClient }
//   week    : exact aggregate over the last up-to-5 cached shipping days (a business week)
// `blobsOk` is a self-test so we can confirm the storage layer end-to-end after deploy.

function ymd(d) {
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}
function lastShippingDays(n) {
  const out = [];
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (out.length < n) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(ymd(d));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

exports.handler = async function (event, context) {
  const store = getStore('ocelot-stats');

  // Storage self-test (write + read a marker), so a deploy can be verified independently of data.
  let blobsOk = false, blobsError = null;
  try {
    await store.setJSON('selftest', { t: 'ok' });
    const back = await store.get('selftest', { type: 'json' });
    blobsOk = !!(back && back.t === 'ok');
  } catch (e) { blobsError = String(e && e.message || e); }

  // Pull the last 7 shipping-day slots; keep whichever are cached.
  const slots = lastShippingDays(7);
  const days = [];
  for (let i = 0; i < slots.length; i++) {
    let rec = null;
    try { rec = await store.get('day:' + slots[i], { type: 'json' }); } catch (e) { rec = null; }
    if (rec) days.push(rec);
  }

  const lastDay = days.length ? days[0] : null;

  // Weekly = exact sum over the last up-to-5 cached shipping days (a business week).
  const weekDays = days.slice(0, 5);
  let wCount = 0, wFreightSum = 0, wRated = 0;
  const wByClient = {};
  let wComplete = true;
  weekDays.forEach(r => {
    wCount += r.count || 0;
    wFreightSum += r.freightSum || 0;
    wRated += r.ratedCount || 0;
    if (r.complete === false) wComplete = false;
    const bc = r.byClient || {};
    Object.keys(bc).forEach(k => { wByClient[k] = (wByClient[k] || 0) + bc[k]; });
  });
  const week = {
    count: wCount,
    avgFreight: wRated ? Math.round((wFreightSum / wRated) * 100) / 100 : 0,
    byClient: wByClient,
    daysCovered: weekDays.length,
    dates: weekDays.map(r => r.date),
    complete: wComplete && weekDays.length >= 5
  };

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blobsOk: blobsOk,
      blobsError: blobsError,
      cachedDays: days.map(r => r.date),
      lastDay: lastDay,
      week: week
    })
  };
};
