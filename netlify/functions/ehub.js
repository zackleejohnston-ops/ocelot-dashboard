const https = require('https');
exports.handler = async function(event, context) {
  const EH_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9.eyJpYXQiOjE3ODExMDM3MjksImRhdGEiOnsidXNlciI6eyJpZCI6MjExMzEsImN1c3RvbWVyX2lkIjoxMDgxMSwiZW1haWwiOiJ6YWNrbGVlam9obnN0b25AZ21haWwuY29tIn0sInNjb3BlcyI6WyJhcGlfcHVibGljIl19fQ.t_axIrFMt0vSjiZ3sQuignuOkadEV2Ux5r2717C6gAKsbIR-e1Ak7RCnaTVbX1SLfSf3AKniSj7aSX7Gj24h9A';

  return new Promise((resolve) => {
    const options = {
      hostname: 'app.ehub.com',
      port: 443,
      path: '/api/v2/shipments?per_page=100&page=2800',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + EH_KEY, 'Accept': 'application/json' }
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
