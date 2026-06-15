const https = require('https');
const API_KEY = '44820105A0C483295BC3DD05E404E55E72EA3A6FAA470C02A476DDCB3C2A2AE5';

function infoplusGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'ocelotlogistics.infopluswms.com',
      port: 443,
      path: path,
      method: 'GET',
      headers: { 'API-KEY': API_KEY, 'Accept': 'application/json' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({}); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async function(event, context) {
  try {
    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = yyyy + '-' + mm + '-' + dd;

    // Filter by today's date, no limit cap
    const filter = encodeURIComponent("orderDate eq '" + dateStr + "'");
    const result = await infoplusGet('/infoplus-wms/api/beta/order/search?filter=' + filter + '&limit=500&sort=!orderDate');
    const orders = result.response || result || [];

    const counts = { Pending:0, Error:0, 'On Order':0, Processed:0, Shipped:0, 'Back Order':0, Cancelled:0 };
    orders.forEach(o => {
      if(counts[o.status] !== undefined) counts[o.status]++;
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ orders, counts })
    };
  } catch(err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
