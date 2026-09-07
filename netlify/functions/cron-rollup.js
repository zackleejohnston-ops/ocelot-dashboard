const https = require('https');

// Scheduled daily (see netlify.toml). Tiny by design: it just kicks off the heavy
// rollup-background job, which does the real Ehub pagination + caching with a 15-min
// budget. Kept separate because background functions can't be scheduled directly.

exports.handler = async function () {
  // When the site is password-gated, this server-to-server call must carry the basic-auth
  // header itself (the edge gate blocks unauthenticated function calls).
  const headers = {};
  const pass = process.env.DASH_PASS;
  if (pass) {
    const user = process.env.DASH_USER || 'ocelot';
    headers['Authorization'] = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
  }
  await new Promise((resolve) => {
    const req = https.request({
      hostname: 'super-dodol-d17ae4.netlify.app',
      port: 443,
      path: '/.netlify/functions/rollup-background',
      method: 'GET',
      headers: headers
    }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', () => resolve());
    req.setTimeout(8000, () => { req.destroy(); resolve(); });
    req.end();
  });
  return { statusCode: 200, body: 'rollup triggered' };
};
