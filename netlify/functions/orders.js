const https = require('https');

const API_KEY = '44820105A0C483295BC3DD05E404E55E72EA3A6FAA470C02A476DDCB3C2A2AE5';
const HOST = 'ocelotlogistics.infopluswms.com';

function infoplusGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
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
    const statuses = ['Pending', 'Error', 'On Order', 'Processed', 'Shipped', 'Back Order', 'Cancelled'];
    
    const [recentOrders, ...statusCounts] = await Promise.all([
      infoplusGet('/infoplus-wms/api/beta/order/search?filter=orderNo%20gt%200&limit=50&sort=!orderDate'),
      ...statuses.map(s => infoplusGet('/infoplus-wms/api/beta/order/search?filter=status%20eq%20%27' + encodeURIComponent(s) + '%27&limit=1'))
    ]);

    const counts = {};
    statuses.forEach((s, i) => {
      counts[s] = statusCounts[i].totalCount || 0;
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        orders: recentOrders.response || recentOrders || [],
        counts: counts
      })
    };
  } catch(err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
