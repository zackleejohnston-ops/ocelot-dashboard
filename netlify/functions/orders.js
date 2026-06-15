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
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const start = yyyy + '-' + mm + '-' + dd + 'T00:00:00.000Z';

    // Double quotes around value, gte operator
    const filterStr = 'createDate gte "' + start + '"';
    const encodedFilter = encodeURIComponent(filterStr);

    const result = await infoplusGet('/infoplus-wms/api/beta/order/search?filter=' + encodedFilter + '&limit=500&sort=!orderDate');
    const orders = Array.isArray(result) ? result : (result.response || result.orders || []);

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
