// ─────────── POOL RECOMMENDER ───────────
// Search a parametric design space of pool layouts for the cheapest configuration that:
//   1. Meets a minimum usable-capacity floor (in TB), and
//   2. Lands a `good` verdict on the chosen workload (sustains comfortably).
//
// Returns the top 3 picks ranked by absolute cost (the user can re-rank by $/TB after).
// The search is intentionally bounded — one drive per "tier" candidate, a curated set
// of layouts/vdev-counts, optional aux vdevs only on HDD pools where they actually help.
import { computePoolStats } from './pool.js';
import { simulateLoad } from './loadsim.js';
import { PRODUCTS } from '../data/products.js';

// Reliability tiers — used to filter which products the recommender will pick from.
// "Enterprise" excludes consumer- and surveillance-tier drives entirely. "Min MTBF" lets
// users threshold by datasheet MTBF (default reasonably ZFS-deployment grade is 1.5M h).
const ENTERPRISE_TIERS = new Set(['enterprise-hdd', 'datacenter-ssd', 'datacenter-nvme']);
const NAS_GRADE_TIERS  = new Set(['enterprise-hdd', 'nas-hdd', 'datacenter-ssd', 'datacenter-nvme', 'consumer-nvme']);

// Curated drive shortlist per type — one cost-effective and one performance-leader pick
// per tier so we don't generate thousands of redundant candidates. Filtered by the
// caller's reliability preference.
function pickDrives({ reliability = 'enterprise', minMTBF = 0 } = {}) {
  const tierAllow = reliability === 'enterprise' ? ENTERPRISE_TIERS
                  : reliability === 'nas-grade'  ? NAS_GRADE_TIERS
                  : null;  // 'any' → no tier filter
  const filtered = PRODUCTS.filter(p => {
    if (tierAllow && !tierAllow.has(p.tier)) return false;
    if (p.mtbf < minMTBF) return false;
    return true;
  });
  const byType = { hdd: [], ssd: [], nvme: [] };
  filtered.forEach(p => { if (byType[p.type]) byType[p.type].push(p); });
  const shortlist = [];
  ['hdd','ssd','nvme'].forEach(t => {
    const tiers = {};
    byType[t].forEach(p => { (tiers[p.tier] ||= []).push(p); });
    Object.values(tiers).forEach(arr => {
      arr.sort((a,b) => Math.min(...a.sizes.map(s=>s.cost)) - Math.min(...b.sizes.map(s=>s.cost)));
      shortlist.push(arr[0]);
      if (arr.length > 1) shortlist.push(arr[arr.length - 1]);
    });
  });
  return shortlist;
}

// Build a group object the rest of the app understands. Picks the largest available
// size for the product so we minimize disk count to hit a capacity target.
function makeGroup(product, layout, count, disksPerVdev, sizeOverride) {
  const size = sizeOverride ?? product.sizes[product.sizes.length - 1].tb;
  const sizeRow = product.sizes.find(s => Math.abs(s.tb - size) < 0.01);
  return {
    count, layout, disks: disksPerVdev,
    type: product.type, size,
    cost: sizeRow ? sizeRow.cost : product.sizes[product.sizes.length-1].cost,
    product: product.id,
  };
}

// Layout permutations to try per data drive. Aux vdevs are added in a separate pass.
const LAYOUT_OPTIONS = [
  { layout:'mirror', diskOpts:[2],          vdevCounts:[2,3,4,6,8] },
  { layout:'raidz1', diskOpts:[3,4,6],      vdevCounts:[1,2,3,4] },
  { layout:'raidz2', diskOpts:[6,8,10],     vdevCounts:[1,2,3,4] },
  { layout:'raidz3', diskOpts:[8,10,12],    vdevCounts:[1,2] },
];

// Aux vdev recipes — only meaningful on HDD pools. We keep them small so the cost
// uplift is modest. NVMe SLOG mirror, NVMe special mirror, NVMe L2ARC stripe.
const AUX_RECIPES = [
  { id:'none',                     log:false, special:false, cache:false },
  { id:'slog',                     log:true,  special:false, cache:false },
  { id:'special',                  log:false, special:true,  cache:false },
  { id:'l2arc',                    log:false, special:false, cache:true  },
  { id:'slog+special',             log:true,  special:true,  cache:false },
  { id:'all',                      log:true,  special:true,  cache:true  },
];

function auxOf(recipe, nvmeProduct) {
  // Choose a 1 TB NVMe for SLOG/special, 2 TB for L2ARC. Use the supplied nvmeProduct.
  const aux = { special:[], dedup:[], log:[], cache:[], spares:[] };
  if (recipe.log)     aux.log     = [ makeGroup(nvmeProduct, 'mirror', 1, 2, 1) ];
  if (recipe.special) aux.special = [ makeGroup(nvmeProduct, 'mirror', 1, 2, 1) ];
  if (recipe.cache)   aux.cache   = [ makeGroup(nvmeProduct, 'stripe', 1, 1, 2) ];
  return aux;
}

// Build all data-vdev candidates that meet the usable-TB floor.
function* dataCandidates(drives, minUsableTB) {
  for (const drv of drives) {
    for (const layoutOpt of LAYOUT_OPTIONS) {
      for (const dpv of layoutOpt.diskOpts) {
        for (const cnt of layoutOpt.vdevCounts) {
          // Quick capacity prefilter: usable per vdev × count ≥ floor (no ZFS losses yet).
          const sizeMax = drv.sizes[drv.sizes.length - 1].tb;
          const usablePerVdev = layoutOpt.layout === 'mirror' ? sizeMax
            : layoutOpt.layout === 'raidz1' ? sizeMax * (dpv-1)
            : layoutOpt.layout === 'raidz2' ? sizeMax * (dpv-2)
            : sizeMax * (dpv-3);
          if (usablePerVdev * cnt * 0.95 < minUsableTB) continue;
          yield { groups: [ makeGroup(drv, layoutOpt.layout, cnt, dpv) ] };
        }
      }
    }
  }
}

// Pick a default NVMe product for aux vdevs from the product catalog. Honors the
// caller's reliability preference so an enterprise-grade pool doesn't get a consumer
// SLOG bolted on. Falls back to whatever NVMe is available if the preferred tier is
// missing (e.g. user picked "any" or no enterprise NVMe in catalog).
function pickAuxNvme(reliability = 'enterprise') {
  const tierAllow = reliability === 'enterprise' ? ENTERPRISE_TIERS
                  : reliability === 'nas-grade'  ? NAS_GRADE_TIERS
                  : null;
  const candidates = PRODUCTS.filter(p =>
    p.type === 'nvme' &&
    p.sizes.some(s => s.tb >= 1) &&
    (!tierAllow || tierAllow.has(p.tier))
  );
  return candidates[0] || PRODUCTS.find(p => p.type === 'nvme' && p.sizes.some(s => s.tb >= 1)) || null;
}

export function recommendPools(workload, opts = {}) {
  const minUsableTB    = opts.minUsableTB ?? 1;
  const recordsizeKB   = opts.recordsizeKB ?? defaultRecordsizeFor(workload);
  const fillPct        = opts.fillPct ?? 50;
  const limit          = opts.limit ?? 3;
  const reliability    = opts.reliability ?? 'enterprise';   // 'enterprise' | 'nas-grade' | 'any'
  const minMTBF        = opts.minMTBF ?? 0;

  const drives    = pickDrives({ reliability, minMTBF });
  const auxNvme   = pickAuxNvme(reliability);
  const candidates = [];
  // Per-type pass/fail tally so the UI can explain *why* the picks look the way they do
  // (e.g. "all picks are flash because no HDD layout could sustain this workload").
  const tried  = { hdd: 0, ssd: 0, nvme: 0 };
  const passed = { hdd: 0, ssd: 0, nvme: 0 };
  const cheapestFailing = { hdd: null, ssd: null, nvme: null };

  for (const data of dataCandidates(drives, minUsableTB)) {
    const dataType = data.groups[0].type;
    const dataIsHDD = dataType === 'hdd';
    // Only try aux recipes on HDD pools (they don't help SSD/NVMe pools materially).
    const recipes = dataIsHDD && auxNvme ? AUX_RECIPES : [{ id:'none' }];
    for (const recipe of recipes) {
      const aux = auxOf(recipe, auxNvme);
      const spec = { ...data, ...aux, recordsizeKB, fillPct };
      const stats = computePoolStats(spec);
      if (stats.totalUsable < minUsableTB) continue;        // post-ZFS-loss recheck
      if (stats.invalid && stats.invalid.length) continue;  // bogus layouts
      const sim = simulateLoad(spec, workload);
      const worstSat = Math.max(0, ...sim.dims.filter(d=>d.key!=='arc').map(d=>d.saturation));
      tried[dataType] = (tried[dataType] || 0) + 1;
      if (sim.verdict.tone !== 'good') {
        // Track the cheapest near-miss per type so we can explain which dim was the bottleneck.
        const prior = cheapestFailing[dataType];
        if (!prior || stats.totalCost < prior.cost) {
          cheapestFailing[dataType] = {
            cost: stats.totalCost,
            tone: sim.verdict.tone,
            worstDim: sim.dims.filter(d=>d.key!=='arc').reduce((a,b)=>a.saturation>b.saturation?a:b),
          };
        }
        continue;
      }
      passed[dataType] = (passed[dataType] || 0) + 1;
      candidates.push({
        spec,
        stats,
        sim,
        recipe: recipe.id,
        cost: stats.totalCost,
        usableTB: stats.totalUsable,
        costPerTB: stats.totalCost / Math.max(0.001, stats.totalUsable),
        worstSat,
        type: dataType,
      });
    }
  }

  // Sort by absolute cost ascending; tiebreak by lower worst-dim saturation.
  candidates.sort((a, b) => a.cost - b.cost || a.worstSat - b.worstSat);

  // Dedupe by (data layout signature) — keep the first (cheapest) per layout shape.
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const key = c.spec.groups.map(g => `${g.count}x${g.layout}-${g.disks}-${g.size}-${g.product}`).join('|') + '|' + c.recipe;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
    if (unique.length >= limit) break;
  }

  // Attach search metadata to the first result so the renderer can show a footnote.
  // We hang it on the array as a non-enumerable property so existing callers that just
  // map over the picks see no change.
  Object.defineProperty(unique, 'search', {
    enumerable: false,
    value: { tried, passed, cheapestFailing, minUsableTB, reliability },
  });
  return unique;
}

// Reasonable starting recordsize per workload — small for OLTP/VM, default otherwise.
function defaultRecordsizeFor(workload) {
  const id = workload?.id;
  if (id === 'postgres') return 8;
  if (id === 'vm-images') return 16;
  return 128;
}
