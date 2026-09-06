// HTTP Basic Auth gate for the ENTIRE dashboard — pages, assets, and /.netlify/functions/* alike.
// Financial (client-margin) data must never be live without this on.
//
// Turn it on by setting env var DASH_PASS (and optionally DASH_USER, default "ocelot") in the
// Netlify site, then redeploy. Until DASH_PASS is set this passes everything through, so deploying
// it can't lock anyone out before you're ready. Once set, the whole site prompts for user+password.
// The browser caches the credentials, so the dashboard's own fetch() calls to the functions carry
// the auth header automatically after the first prompt.
export default async (request, context) => {
  const pass = Deno.env.get("DASH_PASS");
  if (!pass) return; // not configured yet -> stay open (same as today)

  const user = Deno.env.get("DASH_USER") || "ocelot";
  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      if (decoded.slice(0, idx) === user && decoded.slice(idx + 1) === pass) return; // authenticated -> continue
    } catch (_) { /* fall through to 401 */ }
  }
  return new Response("Ocelot Dashboard — authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Ocelot Dashboard", charset="UTF-8"' },
  });
};

export const config = { path: "/*" };
