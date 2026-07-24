# Ocelot Logistics — Operations Dashboard

## What this is
A single-page internal ops dashboard for Ocelot Logistics, a boutique 3PL in Perrysburg, Ohio.
Deployed on Netlify (ocelot-logistics.com). Audience is Richard, the owner.

## Structure
- `index.html` — the entire front end, one file (~100KB, includes base64 logo)
- `netlify/functions/orders.js` — Infoplus WMS: order status counts, shipped orders
- `netlify/functions/billing.js` — Infoplus Invoice Worksheets: latest weekly billing per client
- `netlify/functions/ehub.js` — Ehub TMS: yesterday's shipments
- Deploy flow: commit/push via GitHub Desktop → Netlify auto-deploys → hard-refresh (Ctrl+Shift+R)

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

**Dark vs. light:** the brand sheet is cream-forward (light) because that's the public-facing direction.
The **dashboard stays dark** — it's an internal tool and the dark theme is intentional. Don't lighten the
dashboard to "match the sheet." (The eventual public site is where cream-forward lives.)

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
2. **Avg Freight · Yesterday** (shipped count in the subtitle line) → "Shipped Yesterday · by client" underneath

Below: the collapsible Recent Orders table. That's it.

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
