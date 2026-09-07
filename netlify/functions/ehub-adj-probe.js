// TEMP DIAGNOSTIC: can eHub's API feed charge-backs automatically (no CSV)?
// Probes the shipment-adjustments endpoint on both hosts and reports status + shape +
// whether rows carry amount + account_reference + date, and how far back the window goes.
// Remove once we've decided the auto-capture design.
const https = require('https');
const EH_KEY = process.env.EH_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpYXQiOjE3ODExMDM3MjksImRhdGEiOnsidXNlciI6eyJpZCI6MjExMzEsImN1c3RvbWVyX2lkIjoxMDgxMSwiZW1haWwiOiJ6YWNrbGVlam9obnN0b25AZ21haWwuY29tIn0sInNjb3BlcyI6WyJhcGlfcHVibGljIl19fQ.t_axIrFMt0vSjiZ3sQuignuOkadEV2Ux5r2717C6gAKsbIR-e1Ak7RCnaTVbX1SLfSf3AKniSj7aSX7Gj24h9A';

function get(host, path) {
  return new Promise((res) => {
    const req = https.request({ hostname: host, port: 443, path: path, method: 'GET', headers: { 'Authorization': 'Bearer ' + EH_KEY, 'Accept': 'application/json' } }, (r) => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d }));
    });
    req.on('error', e => res({ status: 0, error: e.message }));
    req.setTimeout(9000, () => { req.destroy(); res({ status: 0, error: 'timeout' }); });
    req.end();
  });
}

exports.handler = async function () {
  const targets = [
    ['app.ehub.com', '/api/v2/reports/shipment_adjustments?per_page=5'],
    ['api.ehub.com', '/api/v2/reports/shipment_adjustments?per_page=5'],
    ['app.ehub.com', '/api/v2/shipment_adjustments?per_page=5']
  ];
  const out = [];
  for (const [h, p] of targets) {
    const r = await get(h, p);
    const rec = { host: h, path: p, status: r.status, error: r.error || null };
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch (e) {}
    if (parsed) {
      const arr = Array.isArray(parsed) ? parsed : (parsed.shipment_adjustments || parsed.adjustments || parsed.data || parsed.results || null);
      if (Array.isArray(arr)) {
        rec.count = arr.length;
        if (arr[0]) {
          rec.keys = Object.keys(arr[0]);
          rec.hasAccountRef = ('account_reference' in arr[0]);
          rec.hasAmount = ('amount' in arr[0]) || ('adjustment' in arr[0]) || ('cost' in arr[0]);
          rec.sample = arr[0];
        }
        const dates = arr.map(x => x.created_at || x.date || x.transaction_date || x.adjustment_date || '').filter(Boolean).sort();
        if (dates.length) rec.dateRange = [dates[0], dates[dates.length - 1]];
      } else {
        rec.topKeys = Object.keys(parsed);
      }
    } else {
      rec.bodyStart = (r.body || '').slice(0, 160);
    }
    out.push(rec);
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(out, null, 1) };
};
