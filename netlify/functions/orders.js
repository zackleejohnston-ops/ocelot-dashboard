const https = require('https');
exports.handler = async function(event, context) {
  const API_KEY = '44820105A0C483295BC3DD05E404E55E72EA3A6FAA470C02A476DDCB3C2A2AE5';
  return new Promise((resolve) => {
    const options = {
      hostname: 'ocelotlogistics.infopluswms.com',
      port: 443,
      path: '/infoplus-wms/api/beta/order/search?filter=orderNo%20gt%200&limit=50&sort=orderNo',
      method: 'GET',
      headers: {
        'API-KEY': API_KEY,
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
      resolve({
        statusCode: 500,
        body: JSON.stringify({ error: err.message })
      });
    });
    req.end();
  });
};
