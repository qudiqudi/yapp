// ─────────── LOAD SIMULATION (first-order steady-state) ───────────
// Map a synthetic workload onto a pool's stats and produce per-dimension
// saturation %. Read amplification from cache hits, write decomposition into
// SLOG / special-vdev / data-vdev, and ZFS recordsize mismatch are all modeled
// in the most basic form — enough to compare layouts, not enough to replace fio.
import { computePoolStats, calcVdevPerf } from './pool.js';
import { LAYOUTS } from '../data/layouts.js';

// ZFS default recordsize and minimum block size (sector floor).
// Pool's recordsize is now configurable per spec; the floor is the sector size which
// caps how much a tiny workload block can be amplified.
const DEFAULT_RECORDSIZE_KB = 128;
const SECTOR_KB = 4;

// Queue-depth at which a per-disk type achieves its datasheet IOPS. NVMe datasheets
// quote IOPS at QD32+; SATA SSDs around QD16; HDDs hit max useful concurrency around
// QD4-8 (head-scheduling falls off after that). Per-disk IOPS scales linearly up to
// the threshold, then saturates.
const QD_FOR_PEAK_IOPS = { hdd: 8, ssd: 16, nvme: 32 };

// Compute write IOPS an aux role's vdevs can absorb. computePoolStats doesn't
// expose this directly (it only models cache reads + log writes), so derive it
// from the spec's groups for the role using the same per-vdev perf math.
function auxRoleWriteIOPS(spec, role) {
  const groups = Array.isArray(spec[role]) ? spec[role] : [];
  let iops = 0, mbps = 0;
  groups.forEach(g => {
    const layoutDef = LAYOUTS.find(l => l.value === g.layout);
    if (!layoutDef || g.disks < layoutDef.min) return;
    const perf = calcVdevPerf(g.layout, g.disks, g.type, g);
    iops += perf.writeIOPS * g.count;
    mbps += perf.writeThroughput * g.count;
  });
  return { iops, mbps };
}

// Weighted queue-depth scale across data groups. Each group's per-disk type has its own
// QD threshold (HDD/SSD/NVMe). When the workload runs at QD < threshold, that group's
// IOPS contribution is scaled linearly. The pool-level scale is the IOPS-weighted average
// — i.e. the fraction of nominal pool IOPS the workload can actually drive at this QD.
function weightedQdScale(spec, workloadQD) {
  const groups = Array.isArray(spec.groups) ? spec.groups : [];
  if (!groups.length) return { scale: 1, dominantType: 'hdd', neededByType: {} };
  let weightedSum = 0, weightTotal = 0;
  const neededByType = {};
  let dominantType = groups[0].type, dominantIOPS = 0;
  groups.forEach(g => {
    const layoutDef = LAYOUTS.find(l => l.value === g.layout);
    if (!layoutDef || g.disks < layoutDef.min) return;
    const perf = calcVdevPerf(g.layout, g.disks, g.type, g);
    const groupIOPS = perf.readIOPS * g.count;     // contribution to total pool read IOPS
    const qdNeeded = QD_FOR_PEAK_IOPS[g.type] || 8;
    neededByType[g.type] = qdNeeded;
    const groupQdScale = Math.min(workloadQD || qdNeeded, qdNeeded) / qdNeeded;
    weightedSum += groupIOPS * groupQdScale;
    weightTotal += groupIOPS;
    if (groupIOPS > dominantIOPS) { dominantIOPS = groupIOPS; dominantType = g.type; }
  });
  const scale = weightTotal > 0 ? weightedSum / weightTotal : 1;
  return { scale, dominantType, neededByType };
}

export function simulateLoad(spec, workload) {
  const stats = computePoolStats(spec);
  const special = auxRoleWriteIOPS(spec, 'special');
  const dedupAux = auxRoleWriteIOPS(spec, 'dedup');

  // Recordsize mismatch — small writes against the pool recordsize force read-modify-write
  // of a full record on the data vdev. Capped by the 4 K sector floor (a 1 K workload
  // against a 128 K record amps ×32 in theory but in practice the IO unit is the sector).
  const poolRecordKB = (spec.recordsizeKB && spec.recordsizeKB > 0) ? spec.recordsizeKB : DEFAULT_RECORDSIZE_KB;
  const blockKB = Math.max(SECTOR_KB, workload.recordSize || SECTOR_KB);
  const writeAmp = blockKB < poolRecordKB ? poolRecordKB / blockKB : 1;

  // LZ4 compression (default in modern ZFS). The on-disk record stores ratio× more host
  // bytes per disk byte, so data-vdev BANDWIDTH demand drops by `ratio` and ARC fits a
  // proportionally larger working set. Per-record IOPS is unaffected — record count
  // stays the same. Workload-driven (media is incompressible; databases compress well).
  const compRatio = Math.max(1, workload.compressionRatio || 1);

  // Pool fill % degrades performance two ways:
  //   - Writes: CoW allocator searches longer + metaslabs fragment. Below 80% the penalty
  //     is small; past 80% it climbs sharply. At 100% fill, write capacity drops to 20%
  //     of nominal. (ZoL/OpenZFS docs recommend < 80% fill to avoid this cliff.)
  //   - Sequential reads: fragmentation scatters data across non-contiguous regions,
  //     turning long sequential streams into pseudo-random access. Effect is real but
  //     much milder than the write hit; modeled as a 30% drop at 100% fill, HDD-only
  //     (NVMe/SSD random access cost is ~zero, so fragmentation barely shows up).
  const fillFrac = clamp01((spec.fillPct ?? 50) / 100);
  const fillPenalty = 1 - Math.max(0, fillFrac - 0.8) / 0.2 * 0.8;
  const dominantTypeForFrag = spec.groups?.[0]?.type || 'hdd';
  const readFragPenalty = dominantTypeForFrag === 'hdd'
    ? 1 - Math.max(0, fillFrac - 0.8) / 0.2 * 0.3
    : 1;

  // Queue-depth scaling: per-disk IOPS in pool stats are quoted at peak (vendor) QD.
  // If the workload runs at lower concurrency, achievable IOPS scale ~linearly with QD
  // up to the per-type threshold, then saturate. Mixed-type pools get a per-group
  // weighted scale so a HDD-only IOPS cap isn't penalized by an unrelated NVMe SLOG QD.
  const qdInfo = weightedQdScale(spec, workload.queueDepth);
  const qdScale = qdInfo.scale;
  const dominantType = qdInfo.dominantType;
  const qdNeededDom = qdInfo.neededByType[dominantType] || QD_FOR_PEAK_IOPS[dominantType] || 8;
  const qdReachedDom = Math.min(workload.queueDepth || qdNeededDom, qdNeededDom);

  // ── reads ──
  // Random ops contend for IOPS capacity; sequential ops contend for throughput.
  // The pool's IOPS cap is sized for random small ops; sequential reads aggregate
  // up to throughput so their per-second op count doesn't pressure the random cap.
  const randomFrac = clamp01(workload.randomFraction ?? 0.5);

  // ARC hit rate derived from how much of the working set fits in ARC, weighted by
  // re-read locality. workingSet ≤ ARC and locality=1.0 → 100% hit; cold scan with
  // no re-reads → 0%. Compression makes ARC hold MORE working-set bytes — the working
  // set effectively shrinks by `compRatio` from ARC's perspective. L2ARC layers on top:
  // catches what didn't fit in ARC, bounded by L2ARC capacity (also compressed).
  const arcGB    = stats.arc || 0;
  const wsGB     = Math.max(0.001, workload.workingSetGB || 0);
  const wsCompressedGB = wsGB / compRatio;
  const locality = clamp01(workload.localityFactor ?? 0.5);
  const arcFit   = clamp01(arcGB / wsCompressedGB);
  const arcHits  = arcFit * locality;
  const l2GB     = (stats.cacheRaw || 0) * 1024;   // cacheRaw is in TB; convert to GB
  const l2Fit    = clamp01(l2GB / Math.max(0.001, wsCompressedGB - arcGB));
  const l2HitsOfMisses = l2Fit * locality;     // hit rate against the remaining miss stream
  const poolReadShare = (1 - arcHits) * (1 - l2HitsOfMisses);

  // Compression cuts the bytes-per-record on data vdevs. IOPS see record count (unchanged);
  // MB/s sees compressed bytes (host-MB / compRatio).
  const readIOPSDemand = workload.readIOPS * randomFrac * poolReadShare;
  const readMBpsDemand = workload.readMBps * (1 - randomFrac) * poolReadShare / compRatio;
  const readIOPSCap = stats.readIOPS * qdScale;
  const readMBpsCap = stats.readThroughput * readFragPenalty;

  // ── writes ──
  // ZFS routing is concurrent across roles, not a peel-cascade:
  //   - ZIL: every sync write logs here (SLOG if present, else inline on data vdev).
  //   - Special vdev: stores small blocks (and metadata) — offloads from data vdev.
  //   - Dedup vdev: every write triggers a DDT lookup + update (1 small IOPS per write).
  //   - Data vdev: full-record txg flush of everything except what special offloads.
  const syncFrac = clamp01(workload.syncFraction);
  const smallFrac = clamp01(workload.smallBlockFraction || 0);
  const hasSLOG = (stats.slogSyncIOPS || 0) > 0;
  const hasSpecial = (stats.specialVdevCount || 0) > 0;
  const hasDedup = (stats.dedupVdevCount || 0) > 0;

  // SLOG demand: every sync write writes a ZIL log entry. ZIL writes are workload-block-
  // sized (no record-amp), so MB/s = host MB/s × syncFrac (no compression in ZIL —
  // raw user data is logged before being compressed/coalesced into a txg).
  const slogIOPSDemand  = hasSLOG ? workload.writeIOPS * syncFrac : 0;
  const slogMBpsDemand  = hasSLOG ? workload.writeMBps * syncFrac : 0;

  // Special vdev: every small write goes here (whether sync or not).
  const specialShare = (hasSpecial && smallFrac > 0) ? smallFrac : 0;
  const specialIOPSDemand = workload.writeIOPS * specialShare;
  const specialMBpsDemand = workload.writeMBps * specialShare / compRatio;

  // Data vdev — sync vs async cost decomposition.
  // Sync writes:
  //   WITH SLOG  → 1 txg-flush IOPS on data vdev (coalesced, full record, no extra amp).
  //   NO SLOG    → 1 inline-ZIL IOPS + 1 txg-flush IOPS = 2 IOPS on data vdev.
  // Async writes:
  //   Always pay full record-amp on data vdev (sub-recordsize blocks force RMW).
  //
  // Each per-write factor is multiplied through the data-vdev share (everything not
  // absorbed by the special vdev) and the random/sequential split.
  const dataLargeShare = 1 - specialShare;
  const syncDataFactor  = hasSLOG ? 1 : 2;     // SLOG offloads ZIL; without it, data vdev pays both
  const asyncDataFactor = writeAmp;            // record-amp on async writes
  const dataWriteIOPSEff = dataLargeShare * (syncFrac * syncDataFactor + (1 - syncFrac) * asyncDataFactor);
  let dataWriteIOPS = workload.writeIOPS * dataWriteIOPSEff * randomFrac;
  let dataWriteMBps = workload.writeMBps * dataLargeShare * (1 - randomFrac) / compRatio;

  // Dedup demand: every write triggers a DDT lookup and update (small random IOPS).
  // Without a dedup vdev configured, "dedup off" is assumed (no DDT exists). With a
  // dedup vdev, the table lives on those drives and absorbs all DDT IOPS.
  const dedupIOPSDemand = hasDedup ? workload.writeIOPS : 0;

  // ── ARC pressure ──
  // Bar saturation = workingSet / ARC. >1 means working set spills past RAM into L2ARC
  // (or pool), which the derived arcHits already accounts for. Compression shrinks the
  // effective working set against ARC.
  const arcSat = arcGB > 0 ? wsCompressedGB / arcGB : Infinity;

  // Build candidate dims; drop the random IOPS / sequential MB/s rows when their demand
  // is zero (purely sequential or purely random workloads). Keeps the card focused on
  // dimensions that actually pressure the pool.
  const candidates = [
    {
      key: 'readIOPS',
      label: 'Read IOPS',
      demand: Math.round(readIOPSDemand),
      capacity: Math.round(readIOPSCap),
      unit: '',
      saturation: safeRatio(readIOPSDemand, readIOPSCap),
      note: (l2HitsOfMisses > 0
        ? `${(arcHits*100).toFixed(0)}% ARC + ${((1-arcHits)*l2HitsOfMisses*100).toFixed(0)}% L2ARC`
        : (arcHits > 0 ? `${(arcHits*100).toFixed(0)}% from ARC` : 'cold reads'))
        + (compRatio > 1.05 ? ` · ${compRatio.toFixed(1)}× LZ4` : '')
        + (qdScale < 0.95 ? ` · ${Math.round(qdScale*100)}% IOPS cap at QD ${qdReachedDom}/${qdNeededDom}` : ''),
      visible: readIOPSDemand > 0.5,
    },
    {
      key: 'writeIOPS',
      label: 'Write IOPS',
      demand: Math.round(dataWriteIOPS),
      capacity: Math.round(stats.writeIOPS * fillPenalty * qdScale),
      unit: '',
      saturation: safeRatio(dataWriteIOPS, stats.writeIOPS * fillPenalty * qdScale),
      note: (() => {
        // Plain-language label of the dominant cost factor.
        const parts = [];
        if (hasSLOG && syncFrac > 0 && writeAmp > 1) parts.push(`×${writeAmp.toFixed(1)} amp on async (SLOG offloads sync)`);
        else if (!hasSLOG && syncFrac > 0.1) parts.push(`sync writes pay 2× (ZIL inline on data vdev)`);
        else if (writeAmp > 1) parts.push(`×${writeAmp.toFixed(1)} record amp`);
        else parts.push('data vdevs');
        if (fillPenalty < 0.95) parts.push(`${Math.round(fillPenalty*100)}% cap at ${Math.round(fillFrac*100)}% fill`);
        if (qdScale < 0.95) parts.push(`${Math.round(qdScale*100)}% cap at QD ${qdReachedDom}/${qdNeededDom}`);
        return parts.join(' · ');
      })(),
      visible: dataWriteIOPS > 0.5,
    },
    {
      key: 'readMBps',
      label: 'Read MB/s',
      demand: Math.round(readMBpsDemand),
      capacity: Math.round(readMBpsCap),
      unit: ' MB/s',
      saturation: safeRatio(readMBpsDemand, readMBpsCap),
      note: readFragPenalty < 0.99
        ? `${Math.round(readFragPenalty*100)}% capacity at ${Math.round(fillFrac*100)}% fill (HDD fragmentation)`
        : '',
      visible: readMBpsDemand > 0.5,
    },
    {
      key: 'writeMBps',
      label: 'Write MB/s',
      demand: Math.round(dataWriteMBps),
      capacity: Math.round(stats.writeThroughput * fillPenalty),
      unit: ' MB/s',
      saturation: safeRatio(dataWriteMBps, stats.writeThroughput * fillPenalty),
      note: fillPenalty < 0.95 ? `${Math.round(fillPenalty*100)}% capacity at ${Math.round(fillFrac*100)}% fill` : '',
      visible: dataWriteMBps > 0.5,
    },
    {
      key: 'arc',
      label: 'ARC pressure',
      demand: workload.workingSetGB,
      capacity: arcGB,
      unit: ' GB',
      saturation: arcSat,
      note: arcGB ? `working set vs ${arcGB} GB ARC` : 'no ARC',
      visible: true,
    },
  ];
  const dims = candidates.filter(d => d.visible);

  // Conditional rows — only shown when the pool actually has the aux vdev.
  if (hasSLOG && syncFrac > 0) {
    dims.push({
      key: 'slog',
      label: 'SLOG sync IOPS',
      demand: Math.round(slogIOPSDemand),
      capacity: Math.round(stats.slogSyncIOPS),
      unit: '',
      saturation: safeRatio(slogIOPSDemand, stats.slogSyncIOPS),
      note: `${(syncFrac*100).toFixed(0)}% sync writes`,
    });
    // SLOG MB/s is bounded by both NVMe throughput AND the txg buffer window:
    // ZFS flushes txgs every ~5s; SLOG must hold one txg's worth of in-flight syncs.
    // Sustainable sync MB/s ≈ SLOG size / 5s. (logRaw is in TB → ×1024 → MB.)
    const TXG_WINDOW_S = 5;
    const slogSizeMB = (stats.logRaw || 0) * 1024 * 1024;   // TB → MB
    const txgBudgetMBps = slogSizeMB / TXG_WINDOW_S;
    const slogMBpsCap = Math.min(stats.slogSyncThroughput || Infinity, txgBudgetMBps);
    dims.push({
      key: 'slog-mbps',
      label: 'SLOG sync MB/s',
      demand: Math.round(slogMBpsDemand),
      capacity: Math.round(slogMBpsCap),
      unit: ' MB/s',
      saturation: safeRatio(slogMBpsDemand, slogMBpsCap),
      note: txgBudgetMBps < (stats.slogSyncThroughput || Infinity)
        ? `bounded by 5s txg window on ${slogSizeMB >= 1024 ? (slogSizeMB/1024).toFixed(1)+' GB' : Math.round(slogSizeMB)+' MB'} SLOG`
        : 'NVMe-bound',
    });
  }
  if (hasSpecial && smallFrac > 0) {
    dims.push({
      key: 'special',
      label: 'Special vdev',
      demand: Math.round(specialIOPSDemand),
      capacity: Math.round(special.iops),
      unit: '',
      saturation: safeRatio(specialIOPSDemand, special.iops),
      note: `${(smallFrac*100).toFixed(0)}% small-block writes`,
    });
  }
  if (hasDedup) {
    // Every write triggers a DDT lookup and update — 1 small random IOPS per write.
    dims.push({
      key: 'dedup',
      label: 'Dedup vdev',
      demand: Math.round(dedupIOPSDemand),
      capacity: Math.round(dedupAux.iops),
      unit: '',
      saturation: safeRatio(dedupIOPSDemand, dedupAux.iops),
      note: 'DDT lookup + update per write',
    });
  }

  // ── verdict ──
  // ARC pressure is informational — the cold-miss cost is already priced into the
  // read-IOPS saturation via the derived hit rate, so a small ARC alone doesn't
  // make a pool "fail" a workload. Verdict considers only throughput-shaped dims.
  // Latency-sensitive workloads (OLTP, VMs, video editing) tighten bands because
  // queueing delay rises sharply past ~50% utilization (M/M/1 wait time blows up).
  const verdictDims = dims.filter(d => d.key !== 'arc');
  const worst = verdictDims.reduce((a, b) => a.saturation > b.saturation ? a : b);
  const sat = worst.saturation;
  const tight = !!workload.latencySensitive;
  const thresholds = tight
    ? { bad: 0.65, warn: 0.40 }      // queueing delay matters → leave 35% headroom
    : { bad: 0.85, warn: 0.60 };     // throughput workloads can run hotter
  let verdict;
  if (!isFinite(sat))                       verdict = { tone:'bad',  text: `${worst.label}: no capacity` };
  else if (sat >= 1.0)                      verdict = { tone:'bad',  text: `won't sustain — ${worst.label} at ${pct(sat)}` };
  else if (sat >= thresholds.bad)           verdict = { tone:'bad',  text: `${tight ? 'latency cliff' : 'bottleneck'} on ${worst.label} at ${pct(sat)}` };
  else if (sat >= thresholds.warn)          verdict = { tone:'warn', text: `tight on ${worst.label} at ${pct(sat)}${tight ? ' (latency-sensitive)' : ''}` };
  else                                      verdict = { tone:'good', text: `comfortable headroom (peak ${pct(sat)} on ${worst.label})` };

  // ── resilver under load ──
  // The pool's `mttr` is computed assuming an idle pool. Under live workload, resilver
  // shares IOPS bandwidth with serving traffic. ZFS throttles resilver to leave headroom
  // for the workload, so resilver duration scales as 1 / (1 - workloadSaturation).
  // We use the worst non-ARC saturation as a proxy for "how much of the pool the workload
  // is consuming" — capped at 0.9 to avoid divide-by-zero / unbounded blowup.
  const verdictDimsForLoad = dims.filter(d => d.key !== 'arc');
  const worstForLoad = verdictDimsForLoad.length
    ? verdictDimsForLoad.reduce((a, b) => a.saturation > b.saturation ? a : b)
    : { saturation: 0 };
  const loadFrac = clamp01(Math.min(0.9, isFinite(worstForLoad.saturation) ? worstForLoad.saturation : 0.9));
  const mttrUnderLoad = stats.mttr ? Math.round(stats.mttr / Math.max(0.05, 1 - loadFrac)) : 0;

  // ── advisory notes ──
  const notes = [];
  if (syncFrac > 0.2 && !hasSLOG) {
    notes.push('Sync-heavy workload but no SLOG — every sync write pays 2× IOPS on the data vdev (inline ZIL log + txg flush).');
  }
  if (smallFrac > 0.3 && !hasSpecial) {
    notes.push('Small-block-heavy workload but no special vdev — metadata + small writes hit data vdevs.');
  }
  if (hasDedup && dedupAux.iops > 0 && safeRatio(dedupIOPSDemand, dedupAux.iops) > 0.6) {
    notes.push('Dedup vdev is under heavy DDT pressure — every write costs an extra small random IOPS regardless of recordsize.');
  }
  if (writeAmp > 1.5) {
    notes.push(`Workload block size (${workload.recordSize} K) below pool recordsize (${poolRecordKB} K) — ×${writeAmp.toFixed(1)} write-IOPS cost on data vdevs. Drop the dataset recordsize to match.`);
  }
  if (arcSat > 4 && l2GB === 0) {
    notes.push(`Working set is ${arcSat.toFixed(1)}× ARC and no L2ARC — derived ${(arcHits*100).toFixed(0)}% hit rate; the rest will be cold pool reads.`);
  }
  if (compRatio > 1.4) {
    notes.push(`LZ4 compression assumed at ${compRatio.toFixed(1)}× — data-vdev MB/s and ARC pressure scaled accordingly.`);
  }
  if (fillFrac > 0.8) {
    notes.push(`Pool at ${Math.round(fillFrac*100)}% fill — CoW allocator slows past 80%, write capacity reduced to ${Math.round(fillPenalty*100)}%.`);
  }
  if (qdScale < 0.6) {
    notes.push(`Workload queue depth (${workload.queueDepth || qdReachedDom}) is below ${qdNeededDom} that ${dominantType.toUpperCase()} needs for spec IOPS — pool-weighted effective IOPS at ${Math.round(qdScale*100)}%.`);
  }
  if (mttrUnderLoad && stats.mttr && mttrUnderLoad > stats.mttr * 1.3) {
    notes.push(`Under this workload, expected resilver time inflates from ${fmtHours(stats.mttr)} (idle) to ~${fmtHours(mttrUnderLoad)} as resilver competes for IOPS at ${Math.round(loadFrac*100)}% saturation.`);
  }

  return { dims, verdict, notes, mttrUnderLoad };
}

// Local hour formatter so the advisory note doesn't have to import format.js
// (which would create a render-layer ↔ math-layer dependency).
function fmtHours(h) {
  if (!h) return '0 h';
  if (h >= 8760) return `${(h/8760).toFixed(1)} y`;
  if (h >= 24)   return `${(h/24).toFixed(0)} d`;
  return `${Math.round(h)} h`;
}

function clamp01(v) { return Math.max(0, Math.min(1, v || 0)); }
function safeRatio(d, c) {
  if (!c || c <= 0) return d > 0 ? Infinity : 0;
  return d / c;
}
function pct(v) {
  if (!isFinite(v)) return '∞';
  return `${Math.round(v * 100)}%`;
}
