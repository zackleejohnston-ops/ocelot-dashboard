// Kicks off the Xero OAuth2 authorization-code flow: redirects you to Xero's consent
// screen. Scopes include offline_access (required to get a refresh token) + read-only
// accounting scopes. Redirect URI must match the one registered on the Xero app.
const REDIRECT = 'https://super-dodol-d17ae4.netlify.app/.netlify/functions/xero-callback';
// Xero switched to GRANULAR scopes for apps created on/after 2026-03-02; the old broad
// scopes (accounting.transactions.read, accounting.reports.read) return invalid_scope.
// Granular equivalents (verified accepted by this app): invoices + contacts + P&L report.
const DEFAULT_SCOPE = 'offline_access accounting.invoices.read accounting.contacts.read accounting.reports.profitandloss.read';

exports.handler = async function (event) {
  const clientId = process.env.XERO_CLIENT_ID;
  if (!clientId) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: '<h2>XERO_CLIENT_ID is not set in Netlify env vars.</h2>' };
  }
  const qp = (event && event.queryStringParameters) || {};
  const scope = qp.scope || DEFAULT_SCOPE; // ?scope= lets us probe which scope string Xero accepts
  const url = 'https://login.xero.com/identity/connect/authorize'
    + '?response_type=code'
    + '&client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(REDIRECT)
    + '&scope=' + encodeURIComponent(scope)
    + '&state=ocelot';
  return { statusCode: 302, headers: { Location: url }, body: '' };
};
