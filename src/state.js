// ─────────── STATE ───────────
import { PRODUCT_BY_ID } from './data/products.js';
import { LAYOUTS, AUX_ROLE_IDS } from './data/layouts.js';
import { rerender } from './bus.js';

export const STORAGE_KEY = 'yapp-state-v1';
export const THEME_KEY = 'yapp-theme';

// Default starter pool — used on first boot AND by Reset all.
export const defaultSpec = () => ({
  groups: [{ count:2, layout:'mirror', disks:2, size:8, type:'hdd', cost:25, product:'wd-red-pro' }],
  special: [],
  dedup:   [],
  log:     [],
  cache:   [],
  spares:  [],
  // Dataset-level tunables that affect the load sim. Per-pool recordsize lets users
  // model OLTP datasets with smaller records (matches Postgres page size, MySQL etc).
  recordsizeKB: 128,
  fillPct: 50,
});

// Single mutable holder so consumers can do state.spec / state.savedPools / state.activeSavedId.
export const state = {
  spec: defaultSpec(),
  savedPools: [],
  activeSavedId: null,
  sortKey: 'usable',
  sortDir: 'desc',
  // Currently-selected workload preset for the load simulator (id from data/workloads.js).
  workloadId: 'plex',
};

// Older saved specs may be missing the aux arrays. Normalize so the rest of the app
// can assume every aux array exists (even if empty).
function migrateSpec(s) {
  if (!s || typeof s !== 'object') return defaultSpec();
  if (!Array.isArray(s.groups)) s.groups = defaultSpec().groups;
  AUX_ROLE_IDS.forEach(role => {
    if (!Array.isArray(s[role])) s[role] = [];
  });
  return s;
}

export function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (s) {
      if (s.spec) state.spec = migrateSpec(s.spec);
      if (Array.isArray(s.saved)) state.savedPools = s.saved.map(p => ({ ...p, spec: migrateSpec(p.spec) }));
      if (s.activeSavedId !== undefined) state.activeSavedId = s.activeSavedId;
      if (typeof s.workloadId === 'string') state.workloadId = s.workloadId;
    }
  } catch {}
}

export function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    spec: state.spec,
    saved: state.savedPools,
    activeSavedId: state.activeSavedId,
    workloadId: state.workloadId,
  }));
}

export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.getElementById('iconSun').style.display = t === 'dark' ? 'block' : 'none';
  document.getElementById('iconMoon').style.display = t === 'dark' ? 'none' : 'block';
}

// Apply an in-place mutation to a single group inside an array. Same logic that
// updateGroup used to inline — generalized so aux vdev arrays can reuse it.
function applyGroupUpdate(arr, gi, key, value) {
  const g = arr[gi];
  if (!g) return;
  g[key] = value;
  // auto-bump disks if layout requires more
  if (key === 'layout') {
    const def = LAYOUTS.find(l => l.value === value);
    if (def && g.disks < def.min) g.disks = def.min;
  }
  // editing size, cost, or type may diverge from the product — drop the product link if so
  if ((key === 'size' || key === 'cost' || key === 'type') && g.product) {
    const p = PRODUCT_BY_ID[g.product];
    if (p) {
      if (key === 'type' && value !== p.type) g.product = null;
      else if (key === 'size' && !p.sizes.find(s => Math.abs(s.tb - value) < 0.01)) g.product = null;
      // editing $/TB on a product is not allowed via the sentence (livePriceTok is read-only),
      // but if it happens programmatically we leave the product link intact.
    }
  }
  rerender();
}

export function updateGroup(gi, key, value) {
  applyGroupUpdate(state.spec.groups, gi, key, value);
}

export function updateAuxGroup(role, gi, key, value) {
  const arr = state.spec[role];
  if (!Array.isArray(arr)) return;
  applyGroupUpdate(arr, gi, key, value);
}
