// Read-only connection check. Reports whether Xero is connected (refresh token stored)
// and which org — WITHOUT exposing any token. Used to verify the one-time authorize.
const { getStore } = require('@netlify/blobs');

function makeStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID || 'd542819e-69b9-4956-ab81-84f3bb87465f';
  const token  = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name: 'ocelot-stats', siteID, token });
  return getStore('ocelot-stats');
}

exports.handler = async function () {
  let rec = null;
  try { rec = await makeStore().get('xero/tokens', { type: 'json' }); } catch (e) {}
  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connected: !!(rec && rec.refresh_token),
      tenantName: (rec && rec.tenantName) || null,
      tenantId: (rec && rec.tenantId) || null,
      scope: (rec && rec.scope) || null,
      connectedAt: (rec && rec.updatedAt) || null,
      hasCreds: !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET)
    })
  };
};
