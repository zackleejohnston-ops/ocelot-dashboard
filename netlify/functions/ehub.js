const https = require('https');

// Ehub is the accurate, complete shipment source.
// Window: the LAST SHIPPING DAY — i.e. yesterday, but stepping back over Sat/Sun so a
// Monday shows Friday instead of a blank/zero board (nothing ships on weekends).
// We pull a single day because at this volume (~200-350 shipments/day, and Ehub ~5s per
// 200-row page) a full week can't be fetched inside Netlify's time budget — a "7-day
// total" here would silently undercount, which we won't display. One day fits and is a
// number we can stand behind. Still paginate + dedupe in case a busy day exceeds one page.

exports.handler = async function (event, context) {
  // TODO: rotate this key in Ehub and move it to a Netlify env var (EH_KEY), then delete the fallback.
  const EH_KEY = process.env.EH_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpYXQiOjE3ODExMDM3MjksImRhdGEiOnsidXNlciI6eyJpZCI6MjExMzEsImN1c3RvbWVyX2lkIjoxMDgxMSwiZW1haWwiOiJ6YWNrbGVlam9obnN0b25AZ21haWwuY29tIn0sInNjb3BlcyI6WyJhcGlfcHVibGljIl19fQ.t_axIrFMt0vSjiZ3sQuignuOkadEV2Ux5r2717C6gAKsbIR-e1Ak7RCnaTVbX1SLfSf3AKniSj7aSX7Gj24h9A';

  function ymd(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  // Last shipping day = yesterday, stepping back over the weekend.
  var day = new Date();
  day.setDate(day.getDate() - 1);
  while (day.getDay() === 0 || day.getDay() === 6) { day.setDate(day.getDate() - 1); } // 0=Sun, 6=Sat

  // Ehub's documented date format: "YYYY-MM-DD hh:mm:ss p" (12-hour clock + AM/PM)
  var fromTime = ymd(day) + ' 12:00:00 AM';
  var toTime   = ymd(day) + ' 11:59:59 PM';

  function ehubGetPage(page) {
    return new Promise((resolve) => {
      var qs = 'per_page=200'
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
      req.setTimeout(6000, () => { req.destroy(); resolve(null); });
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

  const PER_PAGE = 200, MAX_PAGES = 20, BUDGET_MS = 7000;
  const start = Date.now();
  const seen = {};
  let all = [];
  let truncated = false;
  let error = null;
  let env = null; // DIAGNOSTIC: first page's non-array envelope (looking for a total-count field)

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (Date.now() - start > BUDGET_MS) { truncated = true; break; }
    const body = await ehubGetPage(page);
    if (body === null && page === 1) error = 'ehub request failed';
    if (page === 1 && body && !Array.isArray(body)) {
      env = {};
      Object.keys(body).forEach(k => { if (!Array.isArray(body[k])) env[k] = body[k]; });
    }
    const pageRows = rowsOf(body);
    let added = 0;
    for (let i = 0; i < pageRows.length; i++) {
      const k = keyOf(pageRows[i]);
      if (!seen[k]) { seen[k] = 1; all.push(pageRows[i]); added++; }
    }
    if (pageRows.length < PER_PAGE) break;
    if (added === 0) break;
    if (page === MAX_PAGES) truncated = true;
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      shipments: all,
      count: all.length,
      day: ymd(day),
      truncated: truncated,
      error: error,
      _env: env
    })
  };
};
