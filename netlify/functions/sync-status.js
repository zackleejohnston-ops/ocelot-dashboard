// Reports the last nightly-sync run (for verification / a future "stale" warning on the dashboard).
const { getStore } = require('@netlify/blobs');
function makeStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID || 'd542819e-69b9-4956-ab81-84f3bb87465f';
  const token  = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name: 'ocelot-stats', siteID, token });
  return getStore('ocelot-stats');
}
exports.handler = async function () {
  let s = null;
  try { s = await makeStore().get('sync/status', { type: 'json' }); } catch (e) {}
  return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(s || { neverRan: true }) };
};
