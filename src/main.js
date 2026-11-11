// ─────────── MAIN ENTRY ───────────
// Loads state, prices, wires up theme + global buttons, registers the rerender
// + region-toolbar trigger functions on the bus, and kicks off the first paint.

import { setRerender, setRegionToolbarRenderer } from './bus.js';
import { state, loadState, saveState, applyTheme, defaultSpec, THEME_KEY } from './state.js';
import { computePoolStats } from './math/pool.js';
import { applyCachedPrices, refreshPrices } from './pricing/refresh.js';
import { loadPriceState, priceState, detectRegion } from './pricing/state.js';
import { installPopoverDismissHandler } from './popover.js';
import { renderSentence, renderPresets } from './render/sentence.js';
import { renderBlueprint } from './render/blueprint.js';
import { renderSaved } from './render/saved.js';
import { renderCompare } from './render/compare.js';
import { renderCatalog } from './render/catalog.js';
import { renderLoadSim } from './render/loadsim.js';
import { renderRecommend } from './render/recommend.js';
import { renderRegionToolbar } from './render/toolbar.js';

// ── theme ──
applyTheme(localStorage.getItem(THEME_KEY) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
document.getElementById('themeToggle').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
};

// ── auto-name helper (used by Save button) ──
function autoName(sp, idx) {
  const describeGroup = (g) => {
    const totalDisks = g.count * g.disks;
    const sizeStr = `${g.size}TB`;
    const typeStr = g.type.toUpperCase();

    if (g.layout === 'mirror') {
      if (g.count === 1 && g.disks === 2) return `Mirror · 2× ${sizeStr} ${typeStr}`;
      if (g.count === 1) return `${g.disks}-way Mirror · ${sizeStr} ${typeStr}`;
      if (g.disks === 2) return `Striped Mirrors · ${totalDisks}× ${sizeStr} ${typeStr}`;
      return `${g.count}× ${g.disks}-way Mirror · ${sizeStr} ${typeStr}`;
    }
    if (g.layout === 'stripe') return `Stripe · ${totalDisks}× ${sizeStr} ${typeStr}`;

    const z = g.layout.toUpperCase().replace('RAIDZ', 'RAID-Z');
    if (g.count === 1) return `${z} · ${g.disks}× ${sizeStr} ${typeStr}`;
    return `Striped ${z} · ${g.count}× ${g.disks}× ${sizeStr} ${typeStr}`;
  };

  const dataPart = sp.groups.length === 1
    ? describeGroup(sp.groups[0])
    : sp.groups.map(describeGroup).join(' + ');

  // Aux vdev annotations — short suffix, only for non-empty roles.
  const auxParts = [];
  const totalDisks = arr => (arr || []).reduce((n, g) => n + (g.count * g.disks), 0);
  if (totalDisks(sp.special)) auxParts.push(`special ${totalDisks(sp.special)}-drv`);
  if (totalDisks(sp.dedup))   auxParts.push(`dedup ${totalDisks(sp.dedup)}-drv`);
  if (totalDisks(sp.log))     auxParts.push(`SLOG ${totalDisks(sp.log)}-drv`);
  if (totalDisks(sp.cache))   auxParts.push(`L2ARC ${totalDisks(sp.cache)}-drv`);
  if (totalDisks(sp.spares))  auxParts.push(`${totalDisks(sp.spares)} spare${totalDisks(sp.spares)===1?'':'s'}`);
  return auxParts.length ? `${dataPart} + ${auxParts.join(' + ')}` : dataPart;
}

// ── global actions (Save / Reset) ──
document.getElementById('saveBtn').onclick = () => {
  const stats = computePoolStats(state.spec);
  if (stats.invalid.length > 0) {
    alert('Fix invalid vdev configurations before saving:\n\n' + stats.invalid.join('\n'));
    return;
  }
  const id = 'pool-' + Date.now();
  const name = autoName(state.spec, state.savedPools.length + 1);
  state.savedPools.push({ id, name, spec: JSON.parse(JSON.stringify(state.spec)) });
  state.activeSavedId = id;
  rerender();
};

document.getElementById('resetBtn').onclick = () => {
  if (!confirm('Reset everything? Saved pools will be deleted.')) return;
  state.spec = defaultSpec();
  state.savedPools = [];
  state.activeSavedId = null;
  rerender();
};

// ── render orchestration ──
function rerender() {
  renderSentence();
  renderBlueprint();
  renderPresets();
  renderRecommend();
  renderLoadSim();
  renderSaved();
  renderCompare();
  renderCatalog();
  saveState();
}

setRerender(rerender);
setRegionToolbarRenderer(renderRegionToolbar);

// ── boot ──
// Order matters: loadPriceState must run before applyCachedPrices (which reads priceState).
loadState();
loadPriceState();
installPopoverDismissHandler();
applyCachedPrices();
renderRegionToolbar();
rerender();

// Auto-detect the user's region until they explicitly pick something from the toolbar.
// The toolbar handler flips `regionExplicit` when the user touches it (incl. picking
// USD baseline), so this only fires for genuinely-fresh visits — including returning
// users who have a stale `region:null` from before this feature shipped.
if (!priceState.regionExplicit) {
  const detected = detectRegion();
  if (detected && detected !== priceState.region) {
    refreshPrices(detected, priceState.condition || 'new');
  }
}
