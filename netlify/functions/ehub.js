const https = require('https');
exports.handler = async function(event, context) {
  const EH_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpYXQiOjE3ODExMDM3MjksImRhdGEiOnsidXNlciI6eyJpZCI6MjExMzEsImN1c3RvbWVyX2lkIjoxMDgxMSwiZW1haWwiOiJ6YWNrbGVlam9obnN0b25AZ21haWwuY29tIn0sInNjb3BlcyI6WyJhcGlfcHVibGljIl19fQ.t_axIrFMt0vSjiZ3sQuignuOkadEV2Ux5r2717C6gAKsbIR-e1Ak7RCnaTVbX1SLfSf3AKniSj7aSX7Gj24h9A';

  function fetchPage(path) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'app.ehub.com',
        port: 443,
        path: path,
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + EH_KEY, 'Accept': 'application/json' }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({}); } });
      });
      req.on('error', reject);
      req.end();
    });
  }

  try {
    // First get page 1 to find total count
    const first = await fetchPage('/api/v2/shipments?per_page=1');
    const total = first.meta && first.meta.total_count ? first.meta.total_count : 0;
    const lastPage = total > 0 ? Math.ceil(total / 100) : 1;

    // Now get the last page
    const result = await fetchPage('/api/v2/shipments?per_page=100&page=' + lastPage);
    const shipments = result.shipments || result || [];

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ shipments })
    };
  } catch(err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
