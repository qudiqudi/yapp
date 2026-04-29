// ─────────── CATALOG TABLE RENDER ───────────
import { TIERS } from '../data/tiers.js';
import { PRODUCTS } from '../data/products.js';
import { priceState, currentRegion } from '../pricing/state.js';
import { SOURCE_BY_ID } from '../pricing/sources.js';

export function renderCatalog() {
  const tbody = document.querySelector('#productCatalogTable tbody');
  if (!tbody) return;
  const r = currentRegion();
  const sym = r?.symbol || '$';
  let html = '';
  TIERS.forEach(tier => {
    const items = PRODUCTS.filter(p => p.tier === tier.id);
    if (!items.length) return;
    html += `<tr class="cat-tier-row"><td colspan="8" class="cat-tier-label">${tier.label} <span class="cat-tier-sub">${tier.sub}</span></td></tr>`;
    items.forEach(p => {
      const afr = (8760 / p.mtbf * 100).toFixed(2);
      const ureExp = Math.round(-Math.log10(p.ure));
      // Render one sub-row per size (compact: combine into one "$/TB" cell that lists all sizes)
      const priceCell = p.sizes.map(sz => {
        const live = sz.livePrice;
        if (live) {
          if (live.derived) {
            return `<span class="cat-sz cat-sz-derived" title="${(live.derivedBasis || '').replace(/"/g,'&quot;')}">${sz.tb}TB <strong>${sym}${live.cost.toFixed(0)}</strong><sup>i</sup></span>`;
          }
          const srcLabel = SOURCE_BY_ID[live.source]?.label || 'live';
          return `<span class="cat-sz cat-sz-live" title="${live.condition} via ${srcLabel}">${sz.tb}TB <strong>${sym}${live.cost.toFixed(0)}</strong></span>`;
        }
        if (p.dcOnly) {
          return `<span class="cat-sz cat-sz-dc" title="Enterprise channel — retail proxies don't track this SKU">${sz.tb}TB <strong>${sym}${sz.cost}</strong><sup>e</sup></span>`;
        }
        if (priceState.region) {
          return `<span class="cat-sz cat-sz-nomatch" title="No matching listing in ${currentRegion()?.label} for this condition — using baked-in estimate">${sz.tb}TB <strong>${sym}${sz.cost}</strong><sup>?</sup></span>`;
        }
        return `<span class="cat-sz">${sz.tb}TB <strong>${sym}${sz.cost}</strong></span>`;
      }).join(' ');
      const sizeRange = p.sizes.length === 1
        ? `${p.sizes[0].tb} TB`
        : `${p.sizes[0].tb}–${p.sizes[p.sizes.length-1].tb} TB`;
      html += `<tr>
        <td><span class="cat-brand">${p.brand}</span> ${p.model}</td>
        <td><span class="cat-type-${p.type}">${p.type.toUpperCase()}</span></td>
        <td class="num">${sizeRange}</td>
        <td class="num cat-price-cell">${priceCell}</td>
        <td class="num">${(p.mtbf/1e6).toFixed(1)}</td>
        <td class="num">${afr}%</td>
        <td class="num">10<sup>-${ureExp}</sup></td>
        <td><span class="bp-cite">[${p.ref}]</span></td>
      </tr>`;
    });
  });
  // Legend row
  if (priceState.region) {
    html += `<tr class="cat-legend-row"><td colspan="8" class="cat-legend">
      <span class="cat-legend-item"><strong class="text-success">${sym}NN</strong> live ${priceState.condition} from ${currentRegion().label}</span>
      <span class="cat-legend-item"><strong style="color:color-mix(in srgb, var(--success) 65%, var(--text-2))">${sym}NN<sup>i</sup></strong> interpolated from neighbors</span>
      <span class="cat-legend-item"><strong>${sym}NN<sup>?</sup></strong> no live match in this region</span>
      <span class="cat-legend-item"><strong>${sym}NN<sup>e</sup></strong> enterprise channel — no retail listings</span>
    </td></tr>`;
  }
  tbody.innerHTML = html;

  const counts = document.getElementById('catalogCounts');
  if (counts) {
    const totalProducts = PRODUCTS.length;
    const totalSizes = PRODUCTS.reduce((s, p) => s + p.sizes.length, 0);
    if (priceState.region) {
      const liveSizes = PRODUCTS.reduce((s, p) => s + p.sizes.filter(sz => sz.livePrice).length, 0);
      counts.textContent = `${totalProducts} models · ${totalSizes} SKUs · ${liveSizes} matched live in ${currentRegion().label}`;
    } else {
      counts.textContent = `${totalProducts} models · ${totalSizes} SKUs`;
    }
  }
}
