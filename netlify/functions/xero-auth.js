// Kicks off the Xero OAuth2 authorization-code flow: redirects you to Xero's consent
// screen. Scopes include offline_access (required to get a refresh token) + read-only
// accounting scopes. Redirect URI must match the one registered on the Xero app.
const REDIRECT = 'https://super-dodol-d17ae4.netlify.app/.netlify/functions/xero-callback';
const SCOPE = 'offline_access accounting.transactions.read accounting.contacts.read';

exports.handler = async function () {
  const clientId = process.env.XERO_CLIENT_ID;
  if (!clientId) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: '<h2>XERO_CLIENT_ID is not set in Netlify env vars.</h2>' };
  }
  const url = 'https://login.xero.com/identity/connect/authorize'
    + '?response_type=code'
    + '&client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(REDIRECT)
    + '&scope=' + encodeURIComponent(SCOPE)
    + '&state=ocelot';
  return { statusCode: 302, headers: { Location: url }, body: '' };
};
