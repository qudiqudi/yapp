// ─────────── PRICING — REFRESH (fetch + apply) ───────────
import { REGION_BY_ID } from '../data/regions.js';
import { PRODUCTS } from '../data/products.js';
import {
  priceState,
  savePriceState,
  cacheKey,
  PRICE_CACHE_TTL_MIN,
} from './state.js';
import { SOURCE_BY_ID, availableSources } from './sources.js';
import { fetchOne } from './proxies.js';
import { rerender, renderRegionToolbar } from '../bus.js';

export async function fetchSource(sourceId, regionId, condition) {
  const source = SOURCE_BY_ID[sourceId];
  if (!source) throw new Error('Unknown source: ' + sourceId);
  const region = REGION_BY_ID[regionId];
  if (!region) throw new Error('Unknown region: ' + regionId);
  if (!source.regions.includes(regionId)) {
    throw new Error(`${source.label} doesn't cover ${region.label}`);
  }
  const urls = source.urls(region, condition);
  const results = await Promise.allSettled(urls.map(fetchOne));
  const errors = results.filter(r => r.status === 'rejected').map(r => String(r.reason?.message || r.reason));
  const texts  = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (!texts.length) throw new Error(`All URLs failed: ${errors.join('; ')}`);
  const allRows = texts.flatMap(md => source.parse(md, region));
  // Per-(name, capacityTB) cheapest wins
  const dedup = new Map();
  for (const r of allRows) {
    const k = `${r.name}::${r.capacityTB.toFixed(2)}`;
    if (!dedup.has(k) || dedup.get(k).pricePerTB > r.pricePerTB) dedup.set(k, r);
  }
  const rows = [...dedup.values()];
  if (rows.length < (source.minRows ?? 5)) {
    throw new Error(`${source.label}: only ${rows.length} rows parsed${errors.length ? ' (' + errors.length + ' URL errors)' : ''} — format may have changed`);
  }
  return rows;
}

// Fan out to every source available for this region+condition in parallel, merge rows,
// stamp each row with its source for provenance display.
export async function fetchAllSourcesForRegion(regionId, condition) {
  const region = REGION_BY_ID[regionId];
  if (!region) throw new Error('Unknown region: ' + regionId);
  const sources = availableSources(regionId).filter(s => s.conditions.includes(condition));
  if (!sources.length) throw new Error(`No sources support ${region.label} (${condition})`);

  const results = await Promise.allSettled(
    sources.map(async s => {
      const rows = await fetchSource(s.id, regionId, condition);
      return rows.map(r => ({ ...r, source: s.id }));
    })
  );

  const sourceStatus = {};
  const allRows = [];
  sources.forEach((s, i) => {
    const r = results[i];
    if (r.status === 'fulfilled') {
      sourceStatus[s.id] = { ok:true, label:s.label, rows:r.value.length };
      allRows.push(...r.value);
    } else {
      sourceStatus[s.id] = { ok:false, label:s.label, error:String(r.reason?.message || r.reason).slice(0, 240) };
    }
  });

  if (!allRows.length) {
    const errs = Object.values(sourceStatus).filter(v => !v.ok).map(v => `${v.label}: ${v.error}`);
    const err = new Error('No sources returned data');
    err.sourceStatus = sourceStatus;
    err.detail = errs.join(' | ');
    throw err;
  }
  return { rows: allRows, sourceStatus };
}

// Match merged rows against our PRODUCTS catalog and stamp size.livePrice with provenance.
export function applyRowsToCatalog(rows, regionId, condition) {
  const region = REGION_BY_ID[regionId];
  PRODUCTS.forEach(p => p.sizes.forEach(s => { s.livePrice = null; }));

  PRODUCTS.forEach(p => {
    if (p.dcOnly) return;
    const candidates = rows.filter(r =>
      p.match.some(m => r.name.includes(m.toLowerCase())) &&
      !(p.notMatch || []).some(nm => r.name.includes(nm.toLowerCase()))
    );
    if (!candidates.length) return;
    p.sizes.forEach(sz => {
      const matches = candidates.filter(r => Math.abs(r.capacityTB - sz.tb) < 0.05);
      if (!matches.length) return;
      const cheapest = matches.reduce((a,b) => a.pricePerTB < b.pricePerTB ? a : b);
      const sourcesSeen = [...new Set(matches.map(r => r.source).filter(Boolean))];
      sz.livePrice = {
        cost: cheapest.pricePerTB,
        currency: region.currency,
        symbol: region.symbol,
        condition,
        source: cheapest.source,
        sourcesSeen,
        fetchedAt: Date.now(),
      };
    });
  });

  // Fill gaps: for any product with at least one live match, interpolate prices for unmatched sizes
  // from the closest live neighbors of the same drive. Avoids falling back to baked-in USD estimates
  // (which read as wrong currency in non-US regions).
  PRODUCTS.forEach(p => {
    if (p.dcOnly) return;
    const liveSizes = p.sizes.filter(s => s.livePrice && !s.livePrice.derived);
    if (!liveSizes.length) return;
    p.sizes.forEach(sz => {
      if (sz.livePrice) return;
      const below = liveSizes.filter(s => s.tb < sz.tb).sort((a,b) => b.tb - a.tb)[0];
      const above = liveSizes.filter(s => s.tb > sz.tb).sort((a,b) => a.tb - b.tb)[0];
      let cost, basis;
      if (below && above) {
        const t = (sz.tb - below.tb) / (above.tb - below.tb);
        cost = below.livePrice.cost * (1 - t) + above.livePrice.cost * t;
        basis = `interpolated between ${below.tb} TB (${region.symbol}${below.livePrice.cost.toFixed(0)}) and ${above.tb} TB (${region.symbol}${above.livePrice.cost.toFixed(0)})`;
      } else if (below) {
        cost = below.livePrice.cost;
        basis = `extrapolated from ${below.tb} TB (${region.symbol}${below.livePrice.cost.toFixed(0)})`;
      } else if (above) {
        cost = above.livePrice.cost;
        basis = `extrapolated from ${above.tb} TB (${region.symbol}${above.livePrice.cost.toFixed(0)})`;
      }
      if (cost != null && isFinite(cost)) {
        sz.livePrice = {
          cost,
          currency: region.currency,
          symbol: region.symbol,
          condition,
          derived: true,
          derivedBasis: basis,
          fetchedAt: Date.now(),
        };
      }
    });
  });

  // Note: do NOT mutate group.cost from livePrice. The render path reads through
  // effectiveCost(g) which prefers livePrice when present; group.cost stays the
  // baked-in USD baseline so saved pools don't bleed regional currency values
  // into localStorage.
}

export async function refreshPrices(regionId, condition, { force = false } = {}) {
  if (!regionId) {
    PRODUCTS.forEach(p => p.sizes.forEach(s => { s.livePrice = null; }));
    priceState.region = null;
    priceState.fetchStatus = 'idle';
    priceState.fetchError = null;
    priceState.sourceStatus = {};
    savePriceState();
    renderRegionToolbar();
    rerender();
    return;
  }
  const cond = condition || priceState.condition || 'new';
  priceState.region = regionId;
  priceState.condition = cond;

  const key = cacheKey();
  const cached = priceState.cache[key];
  const ageMs = cached ? (Date.now() - cached.fetchedAt) : Infinity;
  if (!force && cached && ageMs < PRICE_CACHE_TTL_MIN * 60_000) {
    applyRowsToCatalog(cached.rows, regionId, cond);
    priceState.sourceStatus = cached.sourceStatus || {};
    const okCount = Object.values(priceState.sourceStatus).filter(s => s.ok).length;
    const total = Object.keys(priceState.sourceStatus).length;
    priceState.fetchStatus = (total && okCount < total) ? 'partial' : 'ok';
    priceState.fetchError = null;
    savePriceState();
    renderRegionToolbar();
    rerender();
    return;
  }

  priceState.fetchStatus = 'loading';
  priceState.fetchError = null;
  priceState.sourceStatus = {};
  renderRegionToolbar();
  try {
    const { rows, sourceStatus } = await fetchAllSourcesForRegion(regionId, cond);
    priceState.cache[key] = { rows, sourceStatus, fetchedAt: Date.now() };
    applyRowsToCatalog(rows, regionId, cond);
    priceState.sourceStatus = sourceStatus;
    const failed = Object.values(sourceStatus).filter(s => !s.ok).length;
    priceState.fetchStatus = failed ? 'partial' : 'ok';
  } catch (e) {
    priceState.fetchStatus = 'error';
    priceState.fetchError = String(e.message || e);
    priceState.sourceStatus = e.sourceStatus || {};
    if (cached) applyRowsToCatalog(cached.rows, regionId, cond);
  }
  savePriceState();
  renderRegionToolbar();
  rerender();
}

export function applyCachedPrices() {
  if (!priceState.region) return;
  const key = cacheKey();
  const cached = priceState.cache[key];
  if (cached) {
    applyRowsToCatalog(cached.rows, priceState.region, priceState.condition);
    priceState.sourceStatus = cached.sourceStatus || {};
  }
}
