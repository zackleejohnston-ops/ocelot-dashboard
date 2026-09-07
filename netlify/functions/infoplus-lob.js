// TEMP DIAGNOSTIC: pull Infoplus Line-of-Business list (authoritative LOB id -> client name)
// to confirm the eHub account_reference (760-<lobId>) -> client mapping in clients.json.
const https = require('https');
const API_KEY = process.env.IP_KEY || '44820105A0C483295BC3DD05E404E55E72EA3A6FAA470C02A476DDCB3C2A2AE5';

function ipGet(path) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: 'ocelotlogistics.infopluswms.com', port: 443, path: path, method: 'GET', headers: { 'API-KEY': API_KEY, 'Accept': 'application/json' } }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.setTimeout(9000, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.end();
  });
}
function unwrap(j) { if (Array.isArray(j)) return j; return (j && (j.response || j.records || j.data || j.results || j.lineOfBusiness || j.list)) || []; }

exports.handler = async function () {
  const paths = [
    '/infoplus-wms/api/beta/lineOfBusiness/search?filter=' + encodeURIComponent('lobId gt 0') + '&limit=100',
    '/infoplus-wms/api/beta/lineOfBusiness/search?limit=100'
  ];
  for (const p of paths) {
    const r = await ipGet(p);
    let j = null; try { j = JSON.parse(r.body); } catch (e) {}
    const arr = j ? unwrap(j) : [];
    if (Array.isArray(arr) && arr.length) {
      const lobs = arr.map(x => ({ id: x.id != null ? x.id : x.lobId, name: x.name || x.lobName || x.description }));
      return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ path: p, count: lobs.length, sampleKeys: Object.keys(arr[0]), lobs: lobs }, null, 1) };
    }
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'no LOB records found', tried: paths }) };
};
