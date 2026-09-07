// Xero OAuth2 redirect target. Exchanges the authorization code for tokens, looks up the
// connected tenant (org), and stores the refresh token + tenantId in Blobs. Xero rotates
// refresh tokens on every use, so the pull function must always save the newest one back.
const { getStore } = require('@netlify/blobs');

function makeStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID || 'd542819e-69b9-4956-ab81-84f3bb87465f';
  const token  = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name: 'ocelot-stats', siteID, token });
  return getStore('ocelot-stats');
}
const REDIRECT = 'https://super-dodol-d17ae4.netlify.app/.netlify/functions/xero-callback';

function page(msg) {
  return { statusCode: 200, headers: { 'Content-Type': 'text/html' },
    body: '<html><body style="font-family:system-ui;background:#0F2219;color:#F4EFE6;padding:48px;font-size:18px"><h2>' + msg + '</h2></body></html>' };
}

exports.handler = async function (event) {
  const qp = event.queryStringParameters || {};
  if (qp.error) return page('Xero returned an error: ' + qp.error + ' — ' + (qp.error_description || ''));
  if (!qp.code) return page('Missing authorization code from Xero.');

  const clientId = process.env.XERO_CLIENT_ID, clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return page('XERO_CLIENT_ID / XERO_CLIENT_SECRET not set in Netlify.');
  const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');

  let tok;
  try {
    const r = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: qp.code, redirect_uri: REDIRECT })
    });
    tok = await r.json();
  } catch (e) { return page('Token request failed: ' + (e && e.message)); }
  if (!tok || !tok.refresh_token) return page('Token exchange failed: ' + JSON.stringify(tok).slice(0, 300));

  let tenant = null;
  try {
    const c = await fetch('https://api.xero.com/connections', { headers: { 'Authorization': 'Bearer ' + tok.access_token, 'Accept': 'application/json' } });
    const arr = await c.json();
    if (Array.isArray(arr) && arr[0]) tenant = arr[0];
  } catch (e) { /* tenant lookup optional */ }

  try {
    await makeStore().setJSON('xero/tokens', {
      refresh_token: tok.refresh_token,
      tenantId: tenant && tenant.tenantId,
      tenantName: tenant && tenant.tenantName,
      scope: tok.scope,
      updatedAt: new Date().toISOString()
    });
  } catch (e) { return page('Connected to Xero, but storing the token failed: ' + (e && e.message)); }

  return page('&#10003; Xero connected' + (tenant ? (' &mdash; ' + tenant.tenantName) : '') + '. You can close this tab and tell Claude you\'re done.');
};
