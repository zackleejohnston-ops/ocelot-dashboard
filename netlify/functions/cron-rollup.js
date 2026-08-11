const https = require('https');

// Scheduled daily (see netlify.toml). Tiny by design: it just kicks off the heavy
// rollup-background job, which does the real Ehub pagination + caching with a 15-min
// budget. Kept separate because background functions can't be scheduled directly.

exports.handler = async function () {
  await new Promise((resolve) => {
    const req = https.request({
      hostname: 'super-dodol-d17ae4.netlify.app',
      port: 443,
      path: '/.netlify/functions/rollup-background',
      method: 'GET'
    }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', () => resolve());
    req.setTimeout(8000, () => { req.destroy(); resolve(); });
    req.end();
  });
  return { statusCode: 200, body: 'rollup triggered' };
};
