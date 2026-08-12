# Ocelot Logistics — Operations Dashboard

## What this is
A single-page internal ops dashboard for Ocelot Logistics, a boutique 3PL in Perrysburg, Ohio.
Deployed on Netlify. Audience is Richard, the owner.
**Live URL:** https://super-dodol-d17ae4.netlify.app/ (functions at `/.netlify/functions/{orders,ehub,billing,stats,rollup-background}`).
Fetch these directly to verify changes against real data before/after a deploy.
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

## Keep this file current
Update CLAUDE.md when layout, data sources, or decisions change, so it doesn't go stale.
