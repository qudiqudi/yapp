// ─── safety constants (industry rule-of-thumb) ───
import { productFor } from '../data/products.js';

// MTBF (annualized failure rate) per disk-type, hours
export const MTBF_HOURS = { hdd: 1_200_000, ssd: 2_000_000, nvme: 2_500_000 };
// Annual Failure Rate (AFR) ≈ 8760 / MTBF
// Unrecoverable Read Error rate (bit errors per bits read)
export const URE_RATE = { hdd: 1e-14, ssd: 1e-15, nvme: 1e-17 };
// parity tolerance per vdev (disks that can fail before data loss)
export const PARITY_TOL = { stripe:0, mirror:null /*N-1*/, raidz1:1, raidz2:2, raidz3:3 };

// Real-world AFR observed by Backblaze (Q4-2024 drive-stats report and similar fleet
// telemetry). HDDs average ~1.4%/yr across enterprise fleets vs ~0.35% from datasheet
// MTBF — datasheets are wildly optimistic because they assume bathtub-curve mid-life
// failure rates. SSDs/NVMe see ~0.5-1%/yr in cloud fleets (older data, less consensus).
export const BACKBLAZE_AFR = { hdd: 0.014, ssd: 0.008, nvme: 0.005 };

// Effective specs: product overrides type defaults
export function effectiveMTBF(g)   { const p = productFor(g); return p ? p.mtbf : MTBF_HOURS[g.type]; }
export function effectiveURE(g)    { const p = productFor(g); return p ? p.ure  : URE_RATE[g.type]; }
export function effectiveBackblazeAFR(g) { return BACKBLAZE_AFR[g.type] ?? BACKBLAZE_AFR.hdd; }

export function vdevTolerance(layout, disks) {
  if (layout === 'stripe') return 0;
  if (layout === 'mirror') return Math.max(0, disks - 1);
  return PARITY_TOL[layout] ?? 0;
}

// Probability of losing a vdev during a resilver (simplified model).
// Given one disk has already failed, probability that *more than tol additional disks*
// fail within the resilver window. Uses Backblaze fleet AFR rather than vendor MTBF
// for the conditional rate — datasheet MTBF is wildly optimistic and ignores correlated
// failures in same-batch fleets, which dominate real-world resilver-window risk.
// Backblaze AFR for HDD ≈ 1.4%/yr ≈ 4× the vendor MTBF rate.
export function vdevDataLossProbDuringResilver(layout, disks, groupOrType, resilverHours) {
  const tol = vdevTolerance(layout, disks);
  if (tol === 0 && layout === 'stripe') return 1; // any failure = loss
  const remaining = disks - 1;
  if (remaining <= 0) return 0;
  const type = (typeof groupOrType === 'string') ? groupOrType : groupOrType.type;
  const afrAnnual = BACKBLAZE_AFR[type] ?? BACKBLAZE_AFR.hdd;
  const lambda = afrAnnual / 8760;  // failures per hour per disk (real-world fleet rate)
  // P(another specific disk fails in window) ≈ 1 - e^(-lambda * hours)
  const pPerDisk = 1 - Math.exp(-lambda * resilverHours);
  // tol = max additional disks the vdev can lose before data loss (1 already gone).
  // Loss = P(>= tol additional failures) via binomial tail on `remaining` disks.
  // Sum a couple extra k terms to capture the tail cleanly for small tol.
  const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
  let pLoss = 0;
  const kMax = Math.min(remaining, tol + 2);
  for (let k = tol; k <= kMax; k++) {
    pLoss += C(remaining, k) * Math.pow(pPerDisk, k) * Math.pow(1 - pPerDisk, remaining - k);
  }
  // Add URE risk: must read (disks-1) * size_bits during resilver
  // (caller injects URE term — done in pool stats)
  return Math.min(1, pLoss);
}

// URE risk: probability of hitting an unrecoverable read error during resilver of one vdev
export function vdevUREProb(layout, disks, sizeTB, groupOrType) {
  if (layout === 'stripe' || disks <= 1) return 0;
  // Bits to read = (disks - 1) * size, in bits
  const bitsRead = (disks - 1) * sizeTB * 1e12 * 8;
  const ureRate = (typeof groupOrType === 'string') ? URE_RATE[groupOrType] : effectiveURE(groupOrType);
  // P(at least one URE) = 1 - (1 - rate)^bits ≈ 1 - e^(-rate*bits)
  return 1 - Math.exp(-ureRate * bitsRead);
}

export function computeRebuildHours(layout, size, type) {
  const base = { hdd:50, ssd:200, nvme:500 }[type] || 50;
  const penalty = { mirror:1.0, raidz1:1.2, raidz2:1.5, raidz3:2.0 }[layout] || 1.0;
  const rate = base * penalty;
  return Math.round((size * 1024 * 1024) / (rate * 3600));
}

export function computeSafetyScore(tol, pLoss, ureP) {
  // 0..100
  let score = 0;
  // tolerance band
  if (tol >= 3) score += 50;
  else if (tol === 2) score += 40;
  else if (tol === 1) score += 25;
  else score += 0;
  // resilver-window risk
  if (pLoss < 1e-6) score += 35;
  else if (pLoss < 1e-4) score += 25;
  else if (pLoss < 1e-2) score += 12;
  else score += 0;
  // URE risk
  if (ureP < 0.01) score += 15;
  else if (ureP < 0.1) score += 8;
  else score += 0;
  return Math.min(100, score);
}
