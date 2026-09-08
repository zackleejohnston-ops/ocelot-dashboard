# Ocelot Logistics — Operations Dashboard

## What this is
A single-page internal ops dashboard for Ocelot Logistics, a boutique 3PL in Perrysburg, Ohio.
Deployed on Netlify. Audience is Richard, the owner.
**Live URL:** https://super-dodol-d17ae4.netlify.app/ — **password-gated** since 2026-09-07 (HTTP basic
auth via `netlify/edge-functions/auth.js`; user `ocelot` or env `DASH_USER`, password env `DASH_PASS`).
Functions: `/.netlify/functions/{orders,ehub,billing,stats,rollup-background,cron-rollup,cost-store,xero-auth,xero-callback,xero-status,xero-revenue}`.
Verifying live now needs creds (`curl -u ocelot:<pass> ...`), EXCEPT `xero-auth`/`xero-callback` which
the gate exempts (OAuth redirect can't carry a browser auth header).
**Site ID:** `d542819e-69b9-4956-ab81-84f3bb87465f`. Blobs needs env var `BLOBS_TOKEN` (a Netlify PAT,
set ~4yr expiry) on the site — this older site doesn't auto-provision Blobs. Site ID is hardcoded as a
fallback in the functions.
NOTE: the apex `ocelot-logistics.com` now serves a **Wix** marketing site, not this dashboard.
(Hitting `ocelot-logistics.com/.netlify/functions/*` returns a Wix 400 page.) Update if the dashboard
gets its own domain.

## Structure
- `index.html` — the entire front end, one file (~100KB, includes base64 logo)
- `index.html` front end
- `netlify/functions/orders.js` — Infoplus WMS: order status counts + 100-most-recent orders table
- `netlify/functions/billing.js` — Infoplus Invoice Worksheets: latest weekly billing per client
- `netlify/functions/stats.js` — **fast reader** the shipped hero calls: exact last-day + weekly
  totals from the Blobs cache (`<1s`). Falls back to live `ehub.js` if the cache is empty.
- `netlify/functions/rollup-background.js` — **background fn (15-min)**, the precompute: fully
  paginates Ehub for each recent shipping day and caches exact `{count, avgFreight, byClient}` in Blobs.
  Manual trigger: `GET /.netlify/functions/rollup-background` (`?force=1`, `?days=N`).
- `netlify/functions/cron-rollup.js` — scheduled daily (netlify.toml, 09:00 UTC); just triggers the
  background rollup.
- `netlify/functions/ehub.js` — Ehub TMS live pull (last shipping day); now only a **fallback** for stats.
- `package.json` — one dep, `@netlify/blobs`.
- Deploy flow: commit/push (I can push directly, or GitHub Desktop) → Netlify auto-deploys →
  hard-refresh (Ctrl+Shift+R).

## Brand
Canonical source: `Ocelot_Brand_Sheet_v2.pdf` (kept at `C:\Users\EC2\Desktop\ocelot\brand\`).
The full system is codified below so on-brand is the default without re-opening the PDF.

**Colors (the whole palette — no others):**
- Deep Forest Green `#0F2219` — the foundation. Grounded, steady, "we're solid." Backgrounds, hero panels.
- Ocelot Gold `#C8832A` — the signal, from the ocelot's coat / its watching eyes. Accents, labels,
  the second tagline line, key numbers. Use it to point, not to fill.
- Warm Cream `#F4EFE6` — the breathing room. Keeps the brand human, never cold. Light surfaces / text.

**Logo / mark:** an ocelot head (the watcher). Wordmark is `OCELOT` (bold, forest green on light /
cream on dark) with `LOGISTICS` beneath in letter-spaced gold, often flanked by short gold rules.

**Typography:** Inter throughout. Micro-labels are UPPERCASE, letter-spaced, small, gold
(e.g. `THE COLOR SYSTEM`, `WHO WE ARE`). Headings are heavy (700–900). This matches index.html already.

**Tagline (two-line lockup):**
> Big enough to ship it.  ← line 1, cream/white (or forest on light)
> Small enough to answer. ← line 2, ALWAYS gold

**Voice / message system** — capable but human, never a faceless machine; boutique, alert, on top of it:
- WHO WE ARE — "Big enough to ship it. Small enough to answer." (the lead line)
- WHAT WE DELIVER — "Fulfillment you don't have to check on." (the reliability promise)
- WHAT WE ARE — "Boutique fulfillment. Switched on." (the category tag)

**The brand idea:** the ocelot is *the watcher* — a small, switched-on predator that sees what others
miss, calm until it moves. Small enough to be responsive, sharp enough to never drop the ball. The big
guys can ship it too — but they can't answer the phone. Every design choice should feel like that:
alert, precise, trustworthy, unhurried.

**Recurring layout motifs from the sheet:** gold uppercase micro-label above each block; forest-green
hero panels carrying cream/white + gold text; cream cards with a gold top-accent. index.html already
uses these — stay inside them.

**Light/cream-forward (changed 2026-08-11):** the dashboard is now **cream-forward**, matching the brand
sheet — it was previously dark. Current treatment:
- **Page background:** cream (`--cream`), faint warm top glow. `body` background was the dark canvas.
- **Header:** cream bar. Logo is the **full-body lucky-cat** (`ocelot-cat.png`) + gold divider + an HTML
  wordmark — `OCELOT` in forest green, `LOGISTICS` in gold with two auto-balancing flanking dashes
  (`.wm-line{flex:1}` so the row locks to OCELOT's width). Header text recolored dark for cream contrast.
- **Cards/heroes:** kept **dark** (forest green) and made solid (`--panel` bumped to .94 opacity) so they
  **pop off the cream** as floating panels. Their internals (light/gold text) are unchanged.
- The old "keep the dashboard dark" rule is retired. If reverting/among themes, note both the page bg and
  `--panel` opacity. Logo assets: `ocelot-cat.png` (header), `ocelot-favicon.png` (browser tab),
  `ocelot-logo.png` (og:image — still the old combined lockup).

## Data sources — important
**Ehub is the accurate, complete source.** Infoplus order pulls are capped and undercount.
- Client-level shipment breakdowns come from Ehub, grouped by the LOB code in `account_reference`
  (format `"760-22344"` → take the part after the dash). `label_text1` (`"22344 161043.000"`) is a fallback.
- Do NOT build client breakdowns from the Infoplus orders batch — it produces numbers that don't
  reconcile with the true shipment totals.
- LOB codes: 22344 Joymode · 22349 Sol Science · 22352 Two Leaves and a Bud · 22351 Total Hydration
  · 22353 Vitamin iQ · 22354 Primitive Scientific · 22341 Barbershop Books · 22350 Teonan
  · 22649 Third Party UPS

## Billing logic
`billing.js` selects worksheets whose `name` contains "Billing" (excluding "Daily" and "Test"),
then takes the newest end date. Real runs are named like "Joymode Billing 7/19/2026".

**Known fragility:** a worksheet with an unusual date range hijacks the display. A year-to-date sheet
(1/1/2026–7/20/2026, $346,859, 798 lines) once showed as "latest week."
**Pending fix:** filter to worksheets spanning roughly 7 days, and sum all clients for that week.

## Current layout
Two heroes side by side:
1. **Billed · Latest Week** → "By Client" breakdown underneath
2. **Shipped · This Week** (big number = exact weekly shipment count; subtitle = avg freight + how many
   shipping days) → "Shipped This Week · by client" underneath. Served by `stats.js` from the Blobs
   cache — **exact and complete**, and non-zero on Monday. "Week" = the last up-to-5 shipping days
   (a business week). If the cache is empty, `loadStats()` falls back to `loadEhubLive()` which relabels
   to "Last Shipping Day" and shows that day's live (possibly partial, `+`) numbers.
   Why cached, not live: a single day is 400–900 shipments and Ehub is slow (~5s/200 rows), so exact
   daily/weekly totals can't be fetched inside Netlify's ~10s function limit — hence the background
   rollup. Measured Mon 8/10 = 683 shipped; that week = 1,699.

**Freight split (shipped hero subtitle):** shows `freight $X standard · $Y expedited` instead of one
blended average, because the blend read high. Ehub has **no LTL/freight** — it's all parcel carriers
(DHL/USPS/UPS/FedEx), so "LTL" isn't the cause; the skew is service mix. Definition (in
`rollup-background.js` `isStandardShip()`, mirrored in index.html `isStdJs()`): **standard** = domestic
ground/economy service (`/ground|advantage|expedited/`) under 70 lb; **expedited** = everything else
(priority/express/next-day, international, heavy/oversize). Tallied per-bucket in the precompute
(exactly aggregatable weekly) → `stats.js` returns `week.stdAvg/expAvg`. Validated 2026-08-11 across the
week: standard ~$5.98 (69% of ships), expedited ~$12.95, vs blended ~$8.12.

Below: the collapsible Recent Orders table — the **100 most recent** orders by `orderDate` (live view).
   Scrolls internally (max-height). `orders.js` reports `ordersWindow` ('recent'); the pill shows
   "recent". That's it.

## Data volume reality (measured 2026-08-11, learned the hard way)
Verified against the live `*.netlify.app` endpoints:
- **~250+ orders created per day** (Infoplus). A single day fills a 250-row page, so a "last 7 days"
  order pull is ~1500+ rows / multiple MB — **cannot be fetched in Netlify's ~10s budget.**
- **~200–350 shipments per day** (Ehub), and the Ehub API is **slow (~5s per 200-row page)** and
  returns **oldest-first**. In a 7s budget you get only ~400 rows = the *oldest ~2 days*, mislabeled.
- **Consequence:** exact daily/weekly shipped totals can't be computed live → **solved with a precompute**
  (rollup-background → Blobs → stats.js). Ehub exposes **no total-count field** (checked the response
  envelope — only the array), so the rollup must fully paginate; that's why it lives in a 15-min
  background function, not the request path.
- The **Recent Orders table** stays "100 most recent" (live). At ~250 orders/day it's never blank, and a
  true 7-day order pull (~1500+ rows) is still too heavy — the precompute is shipments-only for now.

Earlier versions had status tiles, a 7-day chart, a shipping-status donut, and several client panels —
all deliberately removed. Don't add them back without being asked.

## Design principles
- **This is the "Richard view."** He's a skim reader who wants glanceable health and money.
  Operational detail belongs elsewhere. When in doubt, cut.
- **Never display a number you can't stand behind.** 7-day totals were removed rather than shown as
  approximations, because one wrong number erodes trust in the whole board.
- One clear thing per block. Hero number + supporting breakdown is the repeating pattern.
- This dashboard doubles as the prototype for the eventual public website's visual language.
  (The site will likely go lighter/warmer — cream-forward — since dark reads heavy for marketing.)

## Code conventions
- **Hidden stub pattern:** when removing a visible element whose `id` the JS still writes to, replace it
  with `<span id="X" style="display:none"></span>` so setters don't throw.
- **Mobile:** the header right cluster (LIVE dot, timestamp, Refresh button) is hidden under 900px to
  prevent horizontal overflow. Heroes collapse to one column under 1100px.
- No localStorage/sessionStorage.

## Leave alone
The hardcoded API key fallbacks in the Netlify functions (`IP_KEY`, `EH_KEY`) are a **known, accepted
risk**. Removing them has broken the live site before. Do not remove or "fix" them, and don't flag them
each session. There's a TODO comment in `ehub.js` about it — it's acknowledged, not forgotten.

## Client profitability / margins (added 2026-09-07)
Per-client margin table at the bottom of the dashboard: Total billed · Freight billed · Other billed ·
Carrier cost · **Freight markup (eff / contract)** · Charged back · Margin · Margin %, sorted by margin
ascending, totals row, date-range picker, plus an alert panel (total charged back / rebilled=$0.00 /
clients over 3% back-charge flagged / freight-markup compliance summary). Above it sits the company
**P&L "Are we making money?" strip** (see DONE 2026-09-07 below).
Margin = Total billed − Carrier cost − Charged back (payroll/overhead deliberately excluded — later phase).

**Pieces:**
- `clients.json` — config: eHub `Account Reference` ("760-22344") → Xero contact + name (4 unconfirmed,
  flagged `*`); revenue/cost account codes; alert & reconcile thresholds; empty slots for contracted
  rates + payroll/overhead. Served statically; the browser reads it to join cost↔revenue.
- **Cost (eHub)** → `cost-store.js`: stores/serves per-day/per-client aggregates in Blobs
  (`cost/aggregates`). POST compact aggregates, GET `?start&end`. Source = eHub **Detailed** transactions
  export (Finance→Transactions, meter `0ZS511`; has `Account Reference` + `Order Number` + `Weight`; the
  plain export lacks account/order). Export is **emailed** (async), Mountain-Time dates.
- **Revenue (Xero)** → `xero-revenue.js`: live. Refreshes token, pulls ACCREC invoices w/ line items,
  aggregates by contact + account code.
- **Xero OAuth** → `xero-auth` (consent redirect) · `xero-callback` (stores refresh token+tenantId in
  Blobs `xero/tokens`) · `xero-status` (connection check, no secrets). Env: `XERO_CLIENT_ID`,
  `XERO_CLIENT_SECRET`. Tenant "Ocelot Logistics, Inc." (`5611ef5f-86d7-4dc1-94c2-68f502da115d`).
- **Access gate** → `netlify/edge-functions/auth.js` (basic auth over `/*`, dormant until `DASH_PASS`).

**Hard-won data rules (all 8 validation numbers tie out — don't regress these):**
- Date window is **inclusive of both endpoints, Mountain Time** ("Jul 1 to Sep 1" includes Sep 1).
- eHub adjustments **net** (credits offset debits) → charged-back = abs(signed sum), not sum of abs.
- Account **4210** (inbound freight rev) counts in Total/Other billed; **Freight billed = 4200 only**.
- **Xero granular scopes required** (apps created ≥2026-03-02 reject broad scopes with `invalid_scope`):
  `offline_access accounting.invoices.read accounting.contacts.read accounting.reports.profitandloss.read`.
- Xero **rotates the refresh token every use** — always store the new one back (xero-revenue does).

**Freshness (auto — no manual step):** a nightly background job `nightly-sync-background.js` (fired by
`cron-rollup` at 09:00 UTC) captures recent carrier cost (`/shipments`, day-by-day) + charge-backs
(`/reports/shipment_adjustments`) from eHub and MERGES them into `cost/aggregates` for dates
**>= `SYNC_CUTOVER` (2026-09-02)**. Dates before the cutover stay as the validated CSV seed, so the
Jul–Sep history is never disturbed. Revenue = live per load. So: everything self-updates; the CSV
upload is now only for backfilling older history or one-off reconciliation.
- Charge-back amount field = `meter_adj` (stored NEGATIVE to match the CSV debit convention; validated:
  report meter_adj == −CSV adjustments for the same window). Charge-backs post 6–34 days late, so a
  recent day legitimately shows $0 back until they land.
- Carrier cost via `/shipments` keys off shipDate (vs the CSV's txn date) — fine because auto-owned
  dates (>= cutover) and CSV-seeded dates (< cutover) don't overlap. `sync-status.js` reports last run.
- eHub adjustments API quirk: `/reports/shipment_adjustments` ignores date params, returns only a
  ~1-week rolling window, page 2+ empty (use page=1&per_page=10000), and takes up to ~2 min → must run
  in a background function. That's why nightly capture (append/overwrite recent days) is the design.

**DONE:** CSV-upload control (`index.html` `ingestCost()` → cost-store); nightly auto-sync (above);
**5200 reconciliation** (xero-revenue pulls P&L, margins panel shows eHub-vs-5200 with a >2% flag —
found ~4% / ~$5.8K of booked freight not in eHub, i.e. LTL/direct freight); **all client mappings
confirmed** via Infoplus LOB table (all 7 now `mappingConfirmed:true`, no `*`).

**DONE (2026-09-07) — company P&L "Are we making money?" strip** (top of the margins section):
`xero-revenue.js` returns `pnlSummary` (revenue / cost of sales / gross profit / net income from Xero's
own P&L subtotals — exact) and `pnlSections` (full section structure for the collapsible line-by-line
breakdown). `index.html` `renderPnL()` shows Revenue − Direct cost = Gross profit − Overhead & other =
Net income, green/red verdict, plus "▾ Show full breakdown". It has its OWN period selector
(`loadPnL()`/`pnlPeriodRange()`), default **Last full month** — profitability is a monthly question, so
it is NOT tied to the margins table's 7-day picker. Any window ending in the current, still-open month
is flagged amber "⏳ preliminary" (bookkeeping lag: Gigi at Accounting Frontier enters cards/bills after
the fact, so recent costs are understated / net overstated). Verified Aug 2026: rev $148,669 → net
$14,778 (10%); YTD Jan–Aug $1.24M → net $179,583 (14.5%). **Open question:** "Biller Genie Sales
Account" is a NEGATIVE line inside Revenue (−$10,575, all in Aug) — likely misclassified; if so Aug net
is really ~$25K. Flagged to Zack for his bookkeeper; don't "fix" Xero data.

**DONE (2026-09-07) — 5b contracted-rate freight compliance:** all 7 rate schedules now in
`clients.json` `contractedRates` (freight upcharge %, label fee, service fees). Freight upcharges:
Joymode 17, Sol Science 35, everyone else 40. Margins table has a **Freight markup** column (effective =
freightBilled/carrierCost−1, vs contract) and flags 🔻 only when effective is below contract minus
`compliance.freightMarkupUnderTolerancePts` (2). **Only UNDER-billing flags** — per-label/residential/
intl surcharges ride on top, so a compliant client sits ≥ contract (avoids the Joymode false-flag: it
bills ~28% and that's CORRECT). Compliance needs BOTH carrier cost and billed freight > 0; freight==0
with carrier>0 (the 7-day default window, invoices not posted yet) shows "—", not a false −100%. So
compliance only means something over a CLOSED window (last month / Jul–Sep). Over Jul 1–Sep 1 it
correctly caught Barbershop Books billing 28% vs its 40% contract.

**Margins date defaults:** the table opens on **last 7 days** (matches the orders table) via
`initMgnDates()`; the P&L strip opens on **last full month** independently.

**DONE (2026-09-07) — 5a per-client net profit ("Profit by client" panel, under the P&L strip):**
`index.html` `renderClientProfit()`, fed by `loadPnL()` (which now fetches clients.json + cost-store +
xero-revenue for the P&L period). Per client: **Contribution** = revenue(Xero, by contact) − carrier
cost − charge-backs (eHub) — exact. **Overhead (alloc.)** = a shipment-weighted share of ALL company
cost below contribution, i.e. `(Σ contribution − company net income)` split by each client's shipment
share. This is deliberate: client-level revenue/cost don't reconcile to the full Xero P&L (Biller Genie
contra, warehouse-materials COGS, LTL/direct freight booked outside eHub all live only company-level),
so allocating the whole gap makes **client nets sum EXACTLY to company net income** (verified Aug: sums
to $14,778). Basis = shipments (falls back to revenue if no shipment data); Zack chose shipments (fair
for a 3PL — handling scales with volume). Sorted worst-net first. **Read it as two lenses:**
Contribution = keep/drop signal (Joymode +$19K → keep); Net = pricing signal (Joymode −$25K at 52% of
all shipments → under-priced for its volume, renegotiate not cancel). Overhead is mostly FIXED, so a
negative net is NOT "drop them and gain that back". Open-month periods flagged preliminary.

**All planned margin phases (1–5b + P&L) are now built.** No input-gated work remaining. Possible future:
per-client warehousing-fee compliance (needs order/pallet/pick counts per client), Biller Genie
resolution (see memory), billing.js 7-day-window fix (see Billing logic above).
Note: gating `/*` breaks server-to-server calls — `cron-rollup` and the nightly sync send their own
basic-auth header (`DASH_USER`/`DASH_PASS`), and the Xero OAuth endpoints are exempt in `auth.js`.
Keep that in mind for any new internal function calls.

## Keep this file current
Update CLAUDE.md when layout, data sources, or decisions change, so it doesn't go stale.
