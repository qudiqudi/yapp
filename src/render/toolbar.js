// ─────────── REGION TOOLBAR RENDER ───────────
import { REGIONS } from '../data/regions.js';
import { PRODUCTS } from '../data/products.js';
import { priceState, currentRegion, cacheKey, savePriceState } from '../pricing/state.js';
import { availableSources, SOURCE_BY_ID } from '../pricing/sources.js';
import { refreshPrices } from '../pricing/refresh.js';

function fmtAge(ms) {
  if (ms == null) return '';
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m/60)} h ago`;
  return `${Math.round(m/1440)} d ago`;
}

// Count how many catalog sizes got their cheapest live price stamped from each source.
function matchedPerSource() {
  const counts = {};
  for (const p of PRODUCTS) {
    if (p.dcOnly) continue;
    for (const sz of p.sizes) {
      const src = sz.livePrice?.source;
      if (src) counts[src] = (counts[src] || 0) + 1;
    }
  }
  return counts;
}

export function renderRegionToolbar() {
  const host = document.getElementById('priceToolbar');
  if (!host) return;
  const r = currentRegion();
  const cached = priceState.region ? priceState.cache[cacheKey()] : null;
  const ageStr = cached ? fmtAge(Date.now() - cached.fetchedAt) : '';

  const allSources = priceState.region ? availableSources(priceState.region) : [];
  const sourceStatus = priceState.sourceStatus || {};
  const matched = matchedPerSource();

  let statusTxt = '';
  if (priceState.fetchStatus === 'loading') statusTxt = `Fetching ${allSources.length} sources for ${r?.label || ''}…`;
  else if (priceState.fetchStatus === 'error') statusTxt = `Fetch failed — see source pills below.`;
  else if (r && cached) statusTxt = `${r.label} · ${ageStr}`;
  else statusTxt = 'Pick a region — every retailer for that country is fetched in parallel and the cheapest match wins per drive.';

  const renderSourcePill = (s) => {
    const st = sourceStatus[s.id];
    const m = matched[s.id] || 0;
    let cls, dot, detail;
    if (priceState.fetchStatus === 'loading' && !st) {
      cls = 'src-pill src-loading'; dot = '⟳'; detail = 'fetching…';
    } else if (!st) {
      cls = 'src-pill src-idle'; dot = '○'; detail = 'pending';
    } else if (st.ok && m > 0) {
      cls = 'src-pill src-ok'; dot = '●';
      detail = `${m} match${m === 1 ? '' : 'es'}`;
    } else if (st.ok) {
      cls = 'src-pill src-empty'; dot = '○';
      detail = `${st.rows} rows · 0 catalog matches`;
    } else {
      cls = 'src-pill src-fail'; dot = '⚠';
      detail = (st.error || 'failed').replace(/^[A-Za-z]+:\s*/, '').slice(0, 60);
    }
    return `<span class="${cls}" data-src="${s.id}">
      <span class="src-dot">${dot}</span>
      <span class="src-label">${s.label}</span>
      <span class="src-detail">${detail}</span>
    </span>`;
  };

  host.innerHTML = `
    <div class="pt-row">
      <label class="pt-label">Live prices</label>
      <select class="field-select" id="ptRegion">
        <option value="">— USD estimate —</option>
        ${REGIONS.map(rg => `<option value="${rg.id}" ${priceState.region === rg.id ? 'selected' : ''}>${rg.label}</option>`).join('')}
      </select>
      <select class="field-select" id="ptCondition" ${!priceState.region ? 'disabled' : ''}>
        <option value="new"  ${priceState.condition === 'new'  ? 'selected' : ''}>New</option>
        <option value="used" ${priceState.condition === 'used' ? 'selected' : ''}>Used / Refurb</option>
      </select>
      <button class="btn btn-outline btn-sm" id="ptRefresh" ${!priceState.region || priceState.fetchStatus === 'loading' ? 'disabled' : ''}>
        ${priceState.fetchStatus === 'loading' ? '⟳ Loading…' : '↻ Refresh'}
      </button>
      <span class="pt-status text-muted">${statusTxt}</span>
    </div>
    ${priceState.region ? `
      <div class="src-row">
        ${allSources.map(renderSourcePill).join('')}
      </div>
    ` : ''}
    <div class="pt-note">
      ${priceState.region
        ? `Cheapest match per drive wins. Failed sources fall back to interpolation from neighboring sizes.`
        : 'Fetched via CORS proxies (corsproxy.io · allorigins · jina, in fallback order). Datacenter SKUs keep baked-in enterprise-channel estimates. Prices shown in local currency, no conversion.'}
    </div>
  `;
  // Picking from the toolbar (incl. "USD baseline") locks in the user's choice — boot
  // auto-detect should never override it on a future load.
  const markExplicit = () => { priceState.regionExplicit = true; savePriceState(); };
  host.querySelector('#ptRegion').onchange = (e) => { markExplicit(); refreshPrices(e.target.value || null, priceState.condition); };
  host.querySelector('#ptCondition').onchange = (e) => { markExplicit(); refreshPrices(priceState.region, e.target.value); };
  host.querySelector('#ptRefresh').onclick = () => { markExplicit(); refreshPrices(priceState.region, priceState.condition, { force:true }); };
}
