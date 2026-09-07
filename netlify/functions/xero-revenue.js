const { getStore } = require('@netlify/blobs');
const clientsConfig = require('../../clients.json');

// Revenue side of the client-margin table. Refreshes the Xero token (rotating the
// refresh token back into Blobs), pulls ACCREC (sales) invoices with line items over a
// date range, and aggregates per contact per account code.
//   GET ?start=YYYY-MM-DD&end=YYYY-MM-DD  (by invoice Date, inclusive)
// Returns per-client freight (4200) / other (4000,4020,4100,BG4001) / total, plus a
// compact invoice list (contact,date,reference,status,freight) so date-vs-billing-period
// interpretation can be reconciled, and every account code seen (to catch surprises).

function makeStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID || 'd542819e-69b9-4956-ab81-84f3bb87465f';
  const token  = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  if (siteID && token) return getStore({ name: 'ocelot-stats', siteID, token });
  return getStore('ocelot-stats');
}
const FREIGHT = new Set(clientsConfig.revenueAccountRoles.freight);   // ["4200"]
const OTHER   = new Set(clientsConfig.revenueAccountRoles.other);     // 4000,4020,4100,BG4001
const REVENUE = new Set([...FREIGHT, ...OTHER]);
function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function resp(code, obj) { return { statusCode: code, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(obj) }; }

async function accessToken(store) {
  const rec = await store.get('xero/tokens', { type: 'json' });
  if (!rec || !rec.refresh_token) throw new Error('Xero not connected');
  const basic = Buffer.from(process.env.XERO_CLIENT_ID + ':' + process.env.XERO_CLIENT_SECRET).toString('base64');
  const r = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rec.refresh_token })
  });
  const tok = await r.json();
  if (!tok.access_token) throw new Error('token refresh failed: ' + JSON.stringify(tok).slice(0, 200));
  // Xero rotates the refresh token on each use — persist the new one immediately.
  await store.setJSON('xero/tokens', Object.assign({}, rec, { refresh_token: tok.refresh_token || rec.refresh_token, updatedAt: new Date().toISOString() }));
  return { token: tok.access_token, tenantId: rec.tenantId };
}

async function pullInvoices(token, tenantId, start, end) {
  const [ys, ms, ds] = start.split('-'), [ye, me, de] = end.split('-');
  const where = 'Type=="ACCREC" AND Date>=DateTime(' + +ys + ',' + +ms + ',' + +ds + ') AND Date<=DateTime(' + +ye + ',' + +me + ',' + +de + ')';
  let all = [];
  for (let page = 1; page <= 60; page++) {
    const url = 'https://api.xero.com/api.xro/2.0/Invoices?where=' + encodeURIComponent(where) + '&order=Date&page=' + page;
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token, 'Xero-tenant-id': tenantId, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('Invoices HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const j = await r.json();
    const inv = (j && j.Invoices) || [];
    all = all.concat(inv);
    if (inv.length < 100) break;
  }
  return all;
}

// Pull the P&L report. Returns both a flat account-name->amount map (for the
// eHub-vs-5200 reconciliation + summary) and the section structure (for the
// on-screen "what's inside overhead" breakdown).
async function pullPnL(token, tenantId, start, end) {
  const url = 'https://api.xero.com/api.xro/2.0/Reports/ProfitAndLoss?fromDate=' + start + '&toDate=' + end;
  const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token, 'Xero-tenant-id': tenantId, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('PnL HTTP ' + r.status + ': ' + (await r.text()).slice(0, 160));
  const j = await r.json();
  const flat = {};
  const top = (j.Reports && j.Reports[0] && j.Reports[0].Rows) || [];
  // Flat map (recursive) — unchanged behaviour for costAccounts/pnlSummary.
  (function walk(rows) {
    rows.forEach(function (row) {
      if (row.Rows) walk(row.Rows);
      if (row.Cells && row.Cells.length >= 2) {
        const name = String(row.Cells[0].Value || '').trim();
        const amt = parseFloat(row.Cells[1].Value);
        if (name && !isNaN(amt)) flat[name] = amt;
      }
    });
  })(top);
  // Section structure: one entry per top-level P&L section (Income, Cost of Sales,
  // Operating Expenses, …), each with its line items and its summary/subtotal rows.
  const sections = [];
  top.forEach(function (sec) {
    if (!sec.Rows) return;              // skip the header row
    const rows = [];
    (function collect(rs) {
      rs.forEach(function (row) {
        if (row.Rows) collect(row.Rows);
        if (row.Cells && row.Cells.length >= 2) {
          const name = String(row.Cells[0].Value || '').trim();
          const amt = parseFloat(row.Cells[1].Value);
          if (name && !isNaN(amt)) rows.push({ name: name, amount: round(amt), summary: row.RowType === 'SummaryRow' });
        }
      });
    })(sec.Rows);
    if (rows.length) sections.push({ title: String(sec.Title || '').trim(), rows: rows });
  });
  return { flat: flat, sections: sections };
}

exports.handler = async function (event) {
  const qp = event.queryStringParameters || {};
  const start = qp.start || '2026-07-01', end = qp.end || '2026-09-01';
  const store = makeStore();
  let token, tenantId;
  try { ({ token, tenantId } = await accessToken(store)); }
  catch (e) { return resp(200, { connected: false, error: String(e && e.message) }); }

  let invoices;
  try { invoices = await pullInvoices(token, tenantId, start, end); }
  catch (e) { return resp(200, { connected: true, error: String(e && e.message) }); }

  const KEEP = new Set(['AUTHORISED', 'PAID']);   // exclude DRAFT/SUBMITTED/VOIDED/DELETED
  const byContact = {};
  const acctSeen = {};
  const refs = new Set();
  const compact = [];

  invoices.forEach(inv => {
    if (!KEEP.has(inv.Status)) return;
    const name = (inv.Contact && inv.Contact.Name) || '(no contact)';
    if (!byContact[name]) byContact[name] = { freight: 0, other: 0, total: 0, count: 0 };
    const c = byContact[name];
    c.count++;
    if (inv.Reference) refs.add(inv.Reference);
    let invFreight = 0;
    (inv.LineItems || []).forEach(li => {
      const code = String(li.AccountCode || '');
      const amt = Number(li.LineAmount) || 0;
      acctSeen[code] = round((acctSeen[code] || 0) + amt);
      if (FREIGHT.has(code)) { c.freight += amt; c.total += amt; invFreight += amt; }
      else if (OTHER.has(code)) { c.other += amt; c.total += amt; }
    });
    compact.push({ contact: name, date: (inv.Date || '').slice(0, 10) || inv.Date, ref: inv.Reference || '', status: inv.Status, freight: round(invFreight), invTotal: Number(inv.Total) || 0 });
  });

  // map contact -> our client config
  const xeroToClient = {};
  (clientsConfig.clients || []).forEach(c => { xeroToClient[c.xeroContact] = c; });

  const clients = Object.keys(byContact).map(name => {
    const b = byContact[name], cfg = xeroToClient[name];
    return { contact: name, mapped: !!cfg, freightBilled: round(b.freight), otherBilled: round(b.other), totalBilled: round(b.total), invoiceCount: b.count };
  }).sort((a, b) => b.totalBilled - a.totalBilled);

  const totals = clients.reduce((t, c) => { t.freightBilled += c.freightBilled; t.otherBilled += c.otherBilled; t.totalBilled += c.totalBilled; return t; }, { freightBilled: 0, otherBilled: 0, totalBilled: 0 });

  // P&L cost accounts (for the eHub-vs-5200 reconciliation) — non-fatal.
  let costAccounts = null, pnlNames = null, pnlError = null, pnlSummary = null, pnlSections = null;
  try {
    const pnl = await pullPnL(token, tenantId, start, end);
    const flat = pnl.flat;
    pnlSections = pnl.sections;
    pnlNames = Object.keys(flat);
    costAccounts = {};
    Object.keys(clientsConfig.costAccounts || {}).forEach(code => {
      const nm = clientsConfig.costAccounts[code];
      costAccounts[code] = { name: nm, amount: (nm in flat) ? round(flat[nm]) : null };
    });
    // Company-level P&L summary straight from Xero's own subtotals (exact, from the books).
    // Names vary slightly by Xero layout, so try a few known variants for each line.
    const pick = names => { for (const n of names) { if (n in flat) return round(flat[n]); } return null; };
    pnlSummary = {
      revenue:     pick(['Total Revenue', 'Total Income', 'Total Trading Income']),
      costOfSales: pick(['Total Cost of Sales', 'Total Cost of Goods Sold']),
      grossProfit: pick(['Gross Profit']),
      netIncome:   pick(['Net Income', 'Net Income  / (Loss) before Tax', 'Net Income / (Loss) before Tax', 'Net Profit', 'Net Profit / (Loss)'])
    };
  } catch (e) { pnlError = String(e && e.message); }

  return resp(200, {
    connected: true, start, end,
    invoiceCount: invoices.length,
    clients,
    totals: { freightBilled: round(totals.freightBilled), otherBilled: round(totals.otherBilled), totalBilled: round(totals.totalBilled) },
    accountCodesSeen: acctSeen,
    costAccounts: costAccounts,
    pnlSummary: pnlSummary,
    pnlSections: pnlSections,
    pnlNames: pnlNames,
    pnlError: pnlError,
    referencesSample: Array.from(refs).slice(0, 25),
    invoices: compact.slice(0, 800)
  });
};
