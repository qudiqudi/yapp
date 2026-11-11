// ─────────── ZFS MATH (preserved) ───────────
import { LAYOUTS, AUX_ROLE_IDS } from '../data/layouts.js';
import { productFor, effectiveCost } from '../data/products.js';
import {
  vdevTolerance,
  vdevDataLossProbDuringResilver,
  vdevUREProb,
  computeRebuildHours,
  computeSafetyScore,
  effectiveMTBF,
  effectiveBackblazeAFR,
} from './safety.js';

export function getDiskPerformance(type) {
  const p = {
    hdd:  { readIOPS: 150,   writeIOPS: 150,   readThroughput: 150,  writeThroughput: 150 },
    ssd:  { readIOPS: 3000,  writeIOPS: 2500,  readThroughput: 500,  writeThroughput: 450 },
    nvme: { readIOPS: 10000, writeIOPS: 8000,  readThroughput: 3000, writeThroughput: 2500 },
  };
  return p[type] || p.hdd;
}

// Per-disk perf for a group: prefer product spec, fall back to type defaults.
// Note: real datacenter NVMe specs are 100×+ higher than the conservative type defaults.
// For the per-vdev model we cap at type defaults × 4 to avoid non-sensical pool numbers
// when a controller/CPU bottleneck is the real limit. (Caveat surfaced in sources panel.)
export function getGroupDiskPerf(g) {
  const fallback = getDiskPerformance(g.type);
  const p = productFor(g);
  if (!p) return fallback;
  const cap = (v, base) => Math.min(v, base * 4);
  return {
    readIOPS:        cap(p.readIOPS,  fallback.readIOPS),
    writeIOPS:       cap(p.writeIOPS, fallback.writeIOPS),
    readThroughput:  cap(p.readMBs,   fallback.readThroughput),
    writeThroughput: cap(p.writeMBs,  fallback.writeThroughput),
  };
}

// Effective storage efficiency for a RAID-Z vdev given a record size and 4 KiB sectors
// (ashift=12, the modern default). Each record allocates D = ceil(record/sector) data
// sectors plus P*ceil(D/(N-P)) parity sectors, then rounds the whole allocation up to a
// multiple of (P+1) sectors so the next block stays (P+1)-aligned. For records that span
// many full stripe rows, efficiency converges to the ideal (N-P)/N. For records smaller
// than one stripe row, padding can waste 30–60% of theoretical capacity (raidz2 with 8K
// records on a 6-disk vdev = 33% efficient vs the nominal 67%).
function raidzAllocEfficiency(N, P, recordKB) {
  if (P <= 0 || N <= P + 1) return 0;
  const SECTOR_KB = 4;  // ashift=12
  const D = Math.max(1, Math.ceil(Math.max(SECTOR_KB, recordKB) / SECTOR_KB));
  const rows = Math.ceil(D / (N - P));
  const paritySectors = P * rows;
  const raw = D + paritySectors;
  const alloc = Math.ceil(raw / (P + 1)) * (P + 1);
  return D / alloc;
}

export function calcUsable(layout, disksPerVdev, size, recordKB = 128) {
  const total = disksPerVdev * size;
  let u = 0;
  switch (layout) {
    case 'stripe': u = total; break;
    // N-way mirror: usable = one disk's capacity, regardless of N (2-way, 3-way, 4-way all give 1× size)
    case 'mirror': u = disksPerVdev >= 2 ? size : 0; break;
    case 'raidz1': u = disksPerVdev >= 3 ? total * raidzAllocEfficiency(disksPerVdev, 1, recordKB) : 0; break;
    case 'raidz2': u = disksPerVdev >= 4 ? total * raidzAllocEfficiency(disksPerVdev, 2, recordKB) : 0; break;
    case 'raidz3': u = disksPerVdev >= 5 ? total * raidzAllocEfficiency(disksPerVdev, 3, recordKB) : 0; break;
  }
  return u * 0.95;
}

export function calcVdevPerf(layout, disksPerVdev, type, group) {
  const p = group ? getGroupDiskPerf(group) : getDiskPerformance(type);
  // RAID-Z random small reads collapse to ~1× single disk per vdev because each
  // random read still touches the full stripe (parity verify across all data disks).
  // Sequential reads scale with the number of data disks, so throughput stays N×.
  // Mirrors and stripes serve random reads from any disk → IOPS scales with N.
  const perDiskR = p.readIOPS;
  const perDiskW = p.writeIOPS;
  const rIOPS = perDiskR * disksPerVdev;
  const wIOPS = perDiskW * disksPerVdev;
  const rT = p.readThroughput * disksPerVdev;
  const wT = p.writeThroughput * disksPerVdev;
  switch (layout) {
    case 'stripe': return { readIOPS:rIOPS, writeIOPS:wIOPS, readThroughput:rT, writeThroughput:wT, rebuildTime:0 };
    case 'mirror': return { readIOPS:rIOPS, writeIOPS:wIOPS/2, readThroughput:rT, writeThroughput:wT/2, rebuildTime: 0 };
    // RAID-Z random IOPS pegged at 1× single-disk IOPS per vdev. Sequential throughput
    // (read AND write) scales with (N-P)/N data disks — parity overhead, not stripe-width.
    // Write IOPS pays the full-stripe parity-recompute penalty.
    case 'raidz1': return { readIOPS:perDiskR, writeIOPS:wIOPS/4, readThroughput:rT*((disksPerVdev-1)/disksPerVdev), writeThroughput:wT*((disksPerVdev-1)/disksPerVdev), rebuildTime: 0 };
    case 'raidz2': return { readIOPS:perDiskR, writeIOPS:wIOPS/6, readThroughput:rT*((disksPerVdev-2)/disksPerVdev), writeThroughput:wT*((disksPerVdev-2)/disksPerVdev), rebuildTime: 0 };
    case 'raidz3': return { readIOPS:perDiskR, writeIOPS:wIOPS/8, readThroughput:rT*((disksPerVdev-3)/disksPerVdev), writeThroughput:wT*((disksPerVdev-3)/disksPerVdev), rebuildTime: 0 };
  }
  return { readIOPS:rIOPS, writeIOPS:wIOPS, readThroughput:rT, writeThroughput:wT, rebuildTime:0 };
}

export function computePoolStats(spec) {
  // Normalize aux arrays — older saved specs may be missing them.
  const auxOf = (role) => Array.isArray(spec[role]) ? spec[role] : [];
  const recordKB = (spec.recordsizeKB && spec.recordsizeKB > 0) ? spec.recordsizeKB : 128;

  // ── DATA VDEVS ──
  // Each group contributes (count) vdevs, each vdev has (disks) of (size, type).
  let perfs = [];
  let totalRaw = 0, totalUsable = 0, totalCost = 0, totalDisks = 0;
  let maxRebuild = 0;
  let invalid = [];
  let groupBreakdown = [];

  // Safety accumulators
  let minTolerance = Infinity;
  let totalAFR = 0;          // expected failures per year using vendor MTBF (datasheet)
  let totalAFRReal = 0;      // expected failures per year using Backblaze fleet AFR (real-world)
  let worstUREProb = 0;       // worst URE prob across redundancy-bearing vdevs
  let dataPoolLossProb = 0;   // 1 - prod(1 - per-vdev loss prob) across data vdevs
  let vdevSafetyDetails = [];

  spec.groups.forEach((g, gi) => {
    const layoutDef = LAYOUTS.find(l => l.value === g.layout);
    if (!layoutDef) return;
    if (g.disks < layoutDef.min) {
      invalid.push(`${g.layout} needs at least ${layoutDef.min} disks (data group ${gi+1} has ${g.disks})`);
    }
    const tol = vdevTolerance(g.layout, g.disks);
    minTolerance = Math.min(minTolerance, tol);

    for (let i = 0; i < g.count; i++) {
      const cap = g.disks * g.size;
      const usable = calcUsable(g.layout, g.disks, g.size, recordKB);
      const cost = g.disks * g.size * effectiveCost(g);
      totalRaw += cap;
      totalUsable += usable;
      totalCost += cost;
      totalDisks += g.disks;
      const perf = calcVdevPerf(g.layout, g.disks, g.type, g);
      const rt = (g.layout === 'stripe') ? 0 : computeRebuildHours(g.layout, g.size, g.type);
      perf.rebuildTime = rt;
      maxRebuild = Math.max(maxRebuild, rt);
      perfs.push(perf);

      // safety
      totalAFR += g.disks * (8760 / effectiveMTBF(g));
      totalAFRReal += g.disks * effectiveBackblazeAFR(g);
      const ureP = vdevUREProb(g.layout, g.disks, g.size, g);
      worstUREProb = Math.max(worstUREProb, ureP);
      const pVdevLoss = vdevDataLossProbDuringResilver(g.layout, g.disks, g, rt) + ureP * (tol === 1 ? 1 : 0.1);
      // any single vdev loss = pool data loss (stripe across vdevs)
      dataPoolLossProb = 1 - (1 - dataPoolLossProb) * (1 - Math.min(1, pVdevLoss));
      vdevSafetyDetails.push({ role:'data', layout:g.layout, tol, ureP, pVdevLoss, rebuildHours: rt });
    }
    groupBreakdown.push({ ...g, role:'data', layoutLabel: layoutDef.label });
  });

  // ── AUX VDEVS (special / dedup / log / cache / spares) ──
  // Each role gets its own accumulator; pool-critical roles (special, dedup) feed the
  // overall pool loss probability because losing them kills the pool just like a data vdev.
  function processAuxRole(roleId) {
    const out = {
      raw:0, usable:0, cost:0, disks:0, vdevCount:0,
      lossProb:0,
      readIOPS:0, writeIOPS:0, readT:0, writeT:0,
    };
    const groups = auxOf(roleId);
    groups.forEach((g, gi) => {
      const layoutDef = LAYOUTS.find(l => l.value === g.layout);
      if (!layoutDef) return;
      if (g.disks < layoutDef.min) {
        invalid.push(`${g.layout} needs at least ${layoutDef.min} disks (${roleId} group ${gi+1} has ${g.disks})`);
      }
      const tol = vdevTolerance(g.layout, g.disks);
      const poolCritical = (roleId === 'special' || roleId === 'dedup');

      for (let i = 0; i < g.count; i++) {
        const cap = g.disks * g.size;
        // Aux roles use the same recordsize as data vdevs (special vdev stores records
        // up to special_small_blocks; dedup is fixed-size DDT entries).
        const usable = calcUsable(g.layout, g.disks, g.size, recordKB);
        const cost = g.disks * g.size * effectiveCost(g);
        out.raw += cap;
        out.usable += usable;
        out.cost += cost;
        out.disks += g.disks;
        out.vdevCount += 1;

        // Aux disks count toward total drive bay / cost budget.
        totalDisks += g.disks;
        totalCost += cost;

        // Every aux disk fails at the same rate as a data disk, so it contributes to the
        // fleet AFR (annualDiskFailures stat). Whether the failure causes pool loss is a
        // separate concern handled by the poolCritical branch below.
        totalAFR += g.disks * (8760 / effectiveMTBF(g));
        totalAFRReal += g.disks * effectiveBackblazeAFR(g);

        if (poolCritical) {
          // Loss of this vdev = loss of the pool. Treat just like a data vdev safety-wise.
          const rt = computeRebuildHours(g.layout, g.size, g.type);
          const ureP = vdevUREProb(g.layout, g.disks, g.size, g);
          const pVdevLoss = vdevDataLossProbDuringResilver(g.layout, g.disks, g, rt)
                          + ureP * (tol === 1 ? 1 : 0.1);
          out.lossProb = 1 - (1 - out.lossProb) * (1 - Math.min(1, pVdevLoss));
          worstUREProb = Math.max(worstUREProb, ureP);
          minTolerance = Math.min(minTolerance, tol);
          maxRebuild = Math.max(maxRebuild, rt);
          vdevSafetyDetails.push({ role:roleId, layout:g.layout, tol, ureP, pVdevLoss, rebuildHours: rt });
        }

        // Per-role performance contribution.
        const dperf = getGroupDiskPerf(g);
        if (roleId === 'cache') {
          // L2ARC: serves cached reads. Assume ~50% cache-hit rate on what it can hold,
          // so the effective added read IOPS is half the raw cache-disk IOPS.
          out.readIOPS += dperf.readIOPS * g.disks * 0.5;
          out.readT    += dperf.readThroughput * g.disks * 0.5;
        } else if (roleId === 'log') {
          // SLOG: absorbs sync writes. Mirror layouts halve effective IOPS (write to both halves).
          const sIOPS = (g.layout === 'mirror') ? dperf.writeIOPS : dperf.writeIOPS * g.disks;
          const sT    = (g.layout === 'mirror') ? dperf.writeThroughput : dperf.writeThroughput * g.disks;
          out.writeIOPS += sIOPS;
          out.writeT    += sT;
        }
      }
      groupBreakdown.push({ ...g, role:roleId, layoutLabel: layoutDef.label });
    });
    return out;
  }

  const specialStats = processAuxRole('special');
  const dedupStats   = processAuxRole('dedup');
  const logStats     = processAuxRole('log');
  const cacheStats   = processAuxRole('cache');
  const sparesStats  = processAuxRole('spares');

  if (!isFinite(minTolerance)) minTolerance = 0;

  // ── pool perf ──
  let rIOPS=0, wIOPS=0, rT=0, wT=0;
  perfs.forEach(p => { rIOPS += p.readIOPS; wIOPS += p.writeIOPS; rT += p.readThroughput; wT += p.writeThroughput; });

  // Special vdev offloads metadata + small writes; data vdevs see modest IOPS relief.
  // Dedup vdev offloads dedup table lookups; same kind of relief on metadata-heavy paths.
  const specialMul = (specialStats.vdevCount > 0 ? 1.20 : 1.0);
  const dedupMul   = (dedupStats.vdevCount   > 0 ? 1.05 : 1.0);
  const offloadMul = specialMul * dedupMul;
  rIOPS *= offloadMul;
  wIOPS *= offloadMul;

  // ── pool rebuild ──
  let mttr = 0;
  if (maxRebuild > 0) {
    const baseline = 200;
    const actual = Math.max(rT, baseline);
    const ratio = actual / baseline;
    const speed = Math.min(Math.sqrt(ratio), 2.5);
    const vMul = Math.min(1 + (perfs.length - 1) * 0.15, 2.0);
    mttr = Math.round(Math.max(maxRebuild / (speed * vMul), 1));
  }
  // ARC sizing follows the standard ZFS rule of thumb: 1 GB RAM per 1 TB usable storage.
  // (8 GB floor — no real ZFS install runs less even on tiny pools.)
  const arc = Math.round(Math.max(8, totalUsable));

  // ── pool data-loss probability ──
  // Pool-critical aux vdevs (special, dedup) are striped against the data vdevs
  // from a pool-loss POV: any one of them being lost = pool gone.
  let poolFailureProbDuringResilver =
    1 - (1 - dataPoolLossProb)
      * (1 - specialStats.lossProb)
      * (1 - dedupStats.lossProb);

  // Hot spares cut the *exposure window* for cascading failure. Without a spare, the
  // window is OPERATOR_RESPONSE_DELAY (typical 24h to manually swap a drive) + resilver
  // time. With one, the window shrinks to just the resilver time. Loss probability scales
  // ~linearly with exposure (fixed per-hour per-disk failure rate), so:
  //   reductionFactor = resilverHours / (responseDelay + resilverHours)
  // NVMe pools (1h resilver, 24h response) get ~96% reduction; HDD pools (48h resilver)
  // only ~33%. Far more accurate than the previous flat 30% knob.
  const OPERATOR_RESPONSE_DELAY_H = 24;
  if (sparesStats.disks > 0 && maxRebuild > 0) {
    const reductionFactor = maxRebuild / (OPERATOR_RESPONSE_DELAY_H + maxRebuild);
    poolFailureProbDuringResilver *= reductionFactor;
  }

  return {
    totalDisks,
    totalRaw,
    totalUsable,
    totalCost,
    efficiency: totalRaw > 0 ? totalUsable / totalRaw * 100 : 0,
    costPerTB: totalUsable > 0 ? totalCost / totalUsable : 0,
    readIOPS: Math.round(rIOPS),
    writeIOPS: Math.round(wIOPS),
    readThroughput: Math.round(rT),
    writeThroughput: Math.round(wT),
    mttr,
    arc,
    invalid,
    groups: groupBreakdown,
    vdevCount: perfs.length,
    // safety
    minTolerance,
    totalAFR,
    totalAFRReal,
    annualDiskFailures: totalAFR,
    annualDiskFailuresReal: totalAFRReal,
    expectedFailuresIn3yr: totalAFR * 3,
    worstUREProb,
    poolLossProbDuringResilver: poolFailureProbDuringResilver,
    // MTTDL = approximate years between data-loss events
    // expected failures/yr = totalAFR; expected loss events/yr = totalAFR * P_loss_per_failure
    mttdlYears: (totalAFR > 0 && poolFailureProbDuringResilver > 0)
      ? 1 / (totalAFR * poolFailureProbDuringResilver)
      : Infinity,
    // dangling window: max resilver hours (during this time the worst-case vdev is degraded)
    danglingHours: maxRebuild,
    safetyScore: computeSafetyScore(minTolerance, poolFailureProbDuringResilver, worstUREProb),
    vdevSafetyDetails,

    // ── aux vdev breakdown ──
    specialUsable: specialStats.usable,
    specialDisks: specialStats.disks,
    specialVdevCount: specialStats.vdevCount,
    dedupUsable: dedupStats.usable,
    dedupDisks: dedupStats.disks,
    dedupVdevCount: dedupStats.vdevCount,
    logRaw: logStats.raw,
    logDisks: logStats.disks,
    logVdevCount: logStats.vdevCount,
    cacheRaw: cacheStats.raw,
    cacheDisks: cacheStats.disks,
    cacheVdevCount: cacheStats.vdevCount,
    spareCount: sparesStats.disks,
    // additive perf from cache/log (kept separate so the headline IOPS stays honest about data-vdev capability)
    cacheReadIOPSAdd: Math.round(cacheStats.readIOPS),
    cacheReadThroughputAdd: Math.round(cacheStats.readT),
    slogSyncIOPS: Math.round(logStats.writeIOPS),
    slogSyncThroughput: Math.round(logStats.writeT),
  };
}
