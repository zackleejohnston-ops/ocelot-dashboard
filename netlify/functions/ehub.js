const https = require('https');

exports.handler = async function(event, context) {
  // TODO: rotate this key in Ehub and move it to a Netlify env var (EH_KEY), then delete the fallback.
  const EH_KEY = process.env.EH_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpYXQiOjE3ODExMDM3MjksImRhdGEiOnsidXNlciI6eyJpZCI6MjExMzEsImN1c3RvbWVyX2lkIjoxMDgxMSwiZW1haWwiOiJ6YWNrbGVlam9obnN0b25AZ21haWwuY29tIn0sInNjb3BlcyI6WyJhcGlfcHVibGljIl19fQ.t_axIrFMt0vSjiZ3sQuignuOkadEV2Ux5r2717C6gAKsbIR-e1Ak7RCnaTVbX1SLfSf3AKniSj7aSX7Gj24h9A';

  // Yesterday = last completed day (per Trevis: "today" is incomplete).
  var y = new Date();
  y.setDate(y.getDate() - 1);
  var yyyy = y.getFullYear();
  var mm = String(y.getMonth() + 1).padStart(2, '0');
  var dd = String(y.getDate()).padStart(2, '0');
  var dateStr = yyyy + '-' + mm + '-' + dd;

  // Ehub's documented date format: "YYYY-MM-DD hh:mm:ss p" (12-hour clock + AM/PM)
  var fromTime = dateStr + ' 12:00:00 AM';
  var toTime   = dateStr + ' 11:59:59 PM';

  var qs = 'per_page=200'
    + '&status=shipped'
    + '&ship_from_time=' + encodeURIComponent(fromTime)
    + '&ship_to_time=' + encodeURIComponent(toTime);

  return new Promise((resolve) => {
    const options = {
      hostname: 'app.ehub.com',
      port: 443,
      path: '/api/v2/shipments?' + qs,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + EH_KEY,
        'Accept': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: data
        });
      });
    });
    req.on('error', (err) => {
      resolve({ statusCode: 500, body: JSON.stringify({ error: err.message }) });
    });
    req.end();
  });
};
