# YAPP

Yet Another Pool Planner. Native ES-modules HTML/CSS/JS app for designing ZFS pools.
No build step, no bundler, no dependencies, no framework. Open index.html through any
static http server to run it.

The product name is YAPP. The directory is called ZFS_calc/ — leave that alone.

## Files

- index.html — entry point; thin shell with the markup, links styles.css, loads src/main.js as a module
- styles.css — every CSS rule
- src/ — the JS, split into one concern per file (see the file map below)

ES modules require a real http server (file:// won't load `import` statements). Use
`python3 -m http.server 8765` from the project root, then open
http://localhost:8765/index.html.

localStorage keys: yapp-state-v1, yapp-prices-v1, yapp-theme.

## File map

```
src/
  main.js           — entry: wires bus, theme, save/reset buttons, calls boot sequence
  bus.js            — rerender / renderRegionToolbar trampolines (breaks render↔state cycle)
  state.js          — `state` holder (spec, savedPools, activeSavedId, sortKey/sortDir),
                      loadState/saveState/applyTheme, updateGroup
  format.js         — fmtCap, fmtT, fmtDur, fmtMoney, currentSymbol, safetyGrade,
                      parseNumber, escapeRegex
  icons.js          — ICON object (lucide SVG strings)
  popover.js        — single-active-popover state + outside-click closer
  data/
    layouts.js      — LAYOUTS, TYPES, SIZE_OPTIONS, COUNT_OPTIONS, PRESETS
    tiers.js        — TIERS array (catalog grouping)
    regions.js      — REGIONS, REGION_BY_ID
    products.js     — PRODUCTS catalog + price snapshot, PRODUCT_BY_ID,
                      productFor, sizeRowFor, effectiveCost
  math/
    safety.js       — MTBF_HOURS, URE_RATE, PARITY_TOL, effective{MTBF,URE,Type},
                      vdevTolerance, vdevDataLossProbDuringResilver, vdevUREProb,
                      computeRebuildHours, computeSafetyScore
    pool.js         — computePoolStats, calcUsable, calcVdevPerf, getDiskPerformance,
                      getGroupDiskPerf
  pricing/
    state.js        — priceState, PRICE_STORAGE_KEY, PRICE_CACHE_TTL_MIN, currentRegion,
                      cacheKey, loadPriceState/savePriceState
    proxies.js      — PROXIES chain (corsproxy.io → allorigins → jina) + fetchOne
    parsers.js      — parseDiskpricesMarkdown / parseDiskpricesHTML / parseListingMarkdown /
                      parseHTMLAsListing / parseGeizhalsMarkdown / parseMindfactoryMarkdown /
                      parseAlternateMarkdown
    sources.js      — SOURCES registry, SOURCE_BY_ID, availableSources
    refresh.js      — fetchSource, fetchAllSourcesForRegion, applyRowsToCatalog,
                      refreshPrices, applyCachedPrices
  render/
    sentence.js     — renderSentence, renderPresets, chip factories (numTok / selectTok /
                      productTok / capacityTok / livePriceTok)
    blueprint.js    — renderBlueprint + roleFor
    saved.js        — renderSaved
    compare.js      — renderCompare + cols config
    catalog.js      — renderCatalog (drive table + counts pill + legend)
    toolbar.js      — renderRegionToolbar (live-pricing dropdowns + status)
```

## Architecture

main.js is the only module with side-effecty bootstrapping (theme, button wiring, the
`rerender()` orchestrator, then `loadState() → loadPriceState() →
installPopoverDismissHandler() → applyCachedPrices() → renderRegionToolbar() →
rerender()`). loadPriceState must precede applyCachedPrices (the latter reads priceState).
Every other module exports pure functions or values.

bus.js exists solely to break the cycle: render modules need to call rerender() after
mutating state, but rerender lives in main.js (which imports the renderers). main.js
calls `setRerender(rerender)` at boot, and any module imports the no-arg `rerender` /
`renderRegionToolbar` triggers from bus.js.

Layout, top to bottom: presets → composer → blueprint → saved pools → compare → drive catalog → methodology details. The drive catalog is a primary panel (always visible), not buried in details.

## Live pricing

priceState.region drives everything. When the user picks a region, refreshPrices fans out to every source in availableSources(region) in parallel via Promise.allSettled, merges rows, and stamps each catalog size with the cheapest match.

Sources are pluggable. SOURCES registry has diskprices, mindfactory, alternate, geizhals. Each declares regions[], conditions[], urls(region, condition), and a parser. Add a new source by appending to the registry.

Fetching goes through a CORS proxy chain: corsproxy.io → allorigins.win → r.jina.ai. The Jina path is last because it doesn't run JS so JS-rendered listing pages return empty. Diskprices uses a dedicated DOM parser; retailer pages use a generic listing parser that walks back from each price token to find the nearest capacity.

When some sizes of a drive have live matches but others don't, applyRowsToCatalog interpolates missing capacities from the nearest live neighbors (linear by capacity). These get livePrice.derived = true and render with the muted green treatment. This is critical — without it, baked-in USD costs render with the local currency symbol and look wildly wrong (€22/TB on a drive that costs €35/TB live).

Cache key is region:condition, 2h TTL.

## Data integrity for the catalog

Each drive's MTBF / URE / IOPS / throughput must come from the manufacturer's datasheet. Inline comments in PRODUCTS document where the value comes from. Two important rules:

- HDD random IOPS — most HDD datasheets do NOT publish random IOPS (only Seagate Exos and WD Ultrastar HC560+ do). For those that don't, the catalog uses physics-derived values (~120 IOPS for 7200 rpm, ~80–100 for 5400 rpm) and the inline comment says "derived". Do NOT make up vendor-sounding numbers.
- Capacity-dependent specs — sustained MB/s often varies by capacity in a model line. Use the most representative capacity (typically the largest currently shipping). Document the choice in a comment.

The "How these numbers are sourced — direct vs. derived" disclosure inside the catalog panel reflects this honestly. Keep it accurate when adding products.

References list at the bottom of the methodology details section links to actual datasheets. When you add a product, add or extend a reference entry with a working URL — verify it returns 200 (some manufacturers return 429/403 to curl but work in browsers; that's fine).

## Currency

Everything goes through currentSymbol() which returns the active region's symbol or $. fmtMoney uses it. When you add UI that shows money, never hardcode $ — call currentSymbol() or use fmtMoney.

When a region is active and a baked-in USD estimate falls back as the value, it gets shown with the local symbol. This is intentional approximation (the est. suffix flags it). For unmatched drives, the interpolation pass usually replaces these with realistic neighbor-derived prices anyway.

## Dev server

`python3 -m http.server 8765` from the project root. Open http://localhost:8765/index.html. Hard-refresh after edits — Python's http.server doesn't send cache-control headers, and modules are aggressively cached. ES modules will not load over file:// — a real http server is mandatory now, even before live pricing enters the picture.

The live-pricing fetches additionally need a real http origin (CORS preflight) — that hasn't changed.

## What lives where

If asked to:
- add a drive — extend `src/data/products.js` (PRODUCTS), add reference link in `index.html`, mark inline as direct/derived per spec
- add a retailer source — write the parser in `src/pricing/parsers.js`, append to `SOURCES` in `src/pricing/sources.js`, run minRows check
- add a region — extend `src/data/regions.js` (REGIONS) with locale + currency + decimal/thousand separators
- add a layout (RAID-Z, mirror variant) — `src/data/layouts.js` LAYOUTS array + `src/math/pool.js` computePoolStats branch
- change the visual hierarchy — sections in `index.html`, not the JS
- explain or trace a calculation — `src/math/pool.js` (computePoolStats) and the methodology details section in `index.html`

## Conventions

- No emojis in code, comments, or UI
- Minimal bold/italics in user-visible copy
- Inline SVG (lucide-style strokes) for icons, never image fonts
- Tabular numerics for all stat values — class tnum or font-variant-numeric: tabular-nums
- Light + dark mode, persisted; one accent color
- All numbers in the comparison table are sortable; best value per column highlighted
- Accent palette is pool-aqua (--accent: #0ea5e9). Don't introduce indigo or purple.

## Don't

- Don't introduce a build step or bundler — the browser must keep loading these files via plain `<script type="module">` and ES `import` paths
- Don't add CDN dependencies or `package.json`
- Don't drop the explicit `.js` extensions in import paths (browsers require them)
- Don't fabricate datasheet values — use derived + a comment
- Don't hardcode $ — use currentSymbol()
- Don't break the no-region fallback path; the calculator must work offline against baked-in USD
- Don't add module-level side effects to feature modules; bootstrapping (loadState/applyCachedPrices/render*) belongs in `src/main.js`
