// ─────────── DRIVE CATALOG ───────────
// Real, publicly-spec'd drives. Specs from manufacturer datasheets (cite refs at bottom of sources panel).
// MTBF in hours, URE = unrecoverable bit errors per bits read, throughput in MiB/s.
// One entry per MODEL — `sizes[]` lists each capacity sold with a baked-in $/TB estimate (US, mid-2024 to early-2025).
// Live prices override `sizes[i].cost` per region when available.
//
// `match` is the lowercase substring(s) used to identify a row in retailer feeds. Strict-match: at least one
// `match` substring must appear in the row name AND `notMatch` must not, AND capacity must match `sizes[i].tb`.
// `dcOnly:true` flags drives no retail proxy tracks (enterprise channel) — they keep their baked-in estimate.
export const PRODUCTS = [
  // ── ENTERPRISE HDD (CMR, helium) ──
  { id:'seagate-exos-x22', brand:'Seagate', model:'Exos X22', tier:'enterprise-hdd', type:'hdd',
    match:['exos x22'],
    // Exos datasheet publishes random IOPS at 4K QD16: 168 read / 550 write (write-cache disabled)
    mtbf:2_500_000, ure:1e-15, readIOPS:168, writeIOPS:550, readMBs:285, writeMBs:285, ref:'A1',
    sizes:[ {tb:20, cost:18}, {tb:22, cost:18} ] },
  { id:'seagate-exos-x20', brand:'Seagate', model:'Exos X20', tier:'enterprise-hdd', type:'hdd',
    match:['exos x20'],
    mtbf:2_500_000, ure:1e-15, readIOPS:168, writeIOPS:550, readMBs:285, writeMBs:285, ref:'A1',
    sizes:[ {tb:18, cost:18}, {tb:20, cost:18} ] },
  { id:'seagate-exos-x18', brand:'Seagate', model:'Exos X18', tier:'enterprise-hdd', type:'hdd',
    match:['exos x18'],
    mtbf:2_500_000, ure:1e-15, readIOPS:170, writeIOPS:550, readMBs:270, writeMBs:270, ref:'A1',
    sizes:[ {tb:12, cost:17}, {tb:14, cost:17}, {tb:16, cost:17}, {tb:18, cost:17} ] },
  { id:'wd-gold', brand:'WD', model:'Gold', tier:'enterprise-hdd', type:'hdd',
    match:['wd gold','western digital gold'],
    // WD Gold doesn't publish random IOPS — derived from 4.16ms rotational latency + ~4ms seek (≈120 IOPS).
    mtbf:2_500_000, ure:1e-15, readIOPS:120, writeIOPS:120, readMBs:291, writeMBs:291, ref:'A2',
    sizes:[ {tb:8, cost:22}, {tb:10, cost:21}, {tb:12, cost:20}, {tb:14, cost:19}, {tb:16, cost:19}, {tb:18, cost:19}, {tb:20, cost:19}, {tb:22, cost:19} ] },
  { id:'toshiba-mg10', brand:'Toshiba', model:'MG10ACA', tier:'enterprise-hdd', type:'hdd',
    match:['mg10aca','toshiba mg10'],
    // Toshiba MG10 datasheet: 281 MiB/s sustained (20TB), random IOPS not published — derived.
    mtbf:2_500_000, ure:1e-15, readIOPS:120, writeIOPS:120, readMBs:281, writeMBs:281, ref:'A3',
    sizes:[ {tb:18, cost:17}, {tb:20, cost:17}, {tb:22, cost:17} ] },
  { id:'wd-ultrastar-hc550', brand:'WD', model:'Ultrastar DC HC550', tier:'enterprise-hdd', type:'hdd',
    match:['hc550','ultrastar dc hc550','wuh721818','wuh721816'],
    // HC550 SAS datasheet: 269/257 MB/s sustained (18TB). Random IOPS not directly published — derived.
    mtbf:2_500_000, ure:1e-15, readIOPS:120, writeIOPS:120, readMBs:269, writeMBs:257, ref:'A7',
    sizes:[ {tb:16, cost:16}, {tb:18, cost:15} ] },
  { id:'wd-ultrastar-hc560', brand:'WD', model:'Ultrastar DC HC560', tier:'enterprise-hdd', type:'hdd',
    match:['hc560','ultrastar dc hc560','wuh722020'],
    // HC560 datasheet: random R 212 IOPS (4K QD32), random W 565 IOPS (4K QD32 WCE), 50/50 mix 220 IOPS.
    mtbf:2_500_000, ure:1e-15, readIOPS:212, writeIOPS:565, readMBs:291, writeMBs:277, ref:'A7',
    sizes:[ {tb:20, cost:16} ] },
  { id:'wd-ultrastar-hc570', brand:'WD', model:'Ultrastar DC HC570', tier:'enterprise-hdd', type:'hdd',
    match:['hc570','ultrastar dc hc570','wuh722222'],
    mtbf:2_500_000, ure:1e-15, readIOPS:212, writeIOPS:565, readMBs:291, writeMBs:277, ref:'A7',
    sizes:[ {tb:22, cost:17} ] },
  { id:'wd-ultrastar-hc580', brand:'WD', model:'Ultrastar DC HC580', tier:'enterprise-hdd', type:'hdd',
    match:['hc580','ultrastar dc hc580','wuh722424'],
    // HC580 datasheet: 298/284 MB/s sustained (24TB).
    mtbf:2_500_000, ure:1e-15, readIOPS:212, writeIOPS:565, readMBs:298, writeMBs:284, ref:'A7',
    sizes:[ {tb:24, cost:19}, {tb:26, cost:21} ] },

  // ── NAS HDD (smaller fleets, lighter duty cycle) ──
  // Random IOPS for NAS HDDs are not published in datasheets — derived from rotational latency + seek time.
  { id:'seagate-ironwolf-pro', brand:'Seagate', model:'IronWolf Pro', tier:'nas-hdd', type:'hdd',
    match:['ironwolf pro'],
    // Current 22/20/18TB IronWolf Pro NT001: 2.5 M h MTBF, 285 MB/s. Older 18TB NE000 was 1.2 M h / 260 MB/s.
    mtbf:2_500_000, ure:1e-15, readIOPS:120, writeIOPS:120, readMBs:285, writeMBs:285, ref:'A4',
    sizes:[ {tb:4, cost:28}, {tb:8, cost:24}, {tb:10, cost:22}, {tb:12, cost:21}, {tb:14, cost:20}, {tb:16, cost:20}, {tb:18, cost:20}, {tb:20, cost:20}, {tb:22, cost:20} ] },
  { id:'wd-red-pro', brand:'WD', model:'Red Pro', tier:'nas-hdd', type:'hdd',
    match:['wd red pro','red pro'],
    // WD Red Pro datasheet: 2.5 M h MTBF, 1 in 10^15 URE, 287 MB/s sustained (24/26TB).
    mtbf:2_500_000, ure:1e-15, readIOPS:120, writeIOPS:120, readMBs:272, writeMBs:272, ref:'A5',
    sizes:[ {tb:4, cost:30}, {tb:6, cost:27}, {tb:8, cost:25}, {tb:10, cost:23}, {tb:12, cost:22}, {tb:14, cost:22}, {tb:16, cost:22}, {tb:18, cost:22}, {tb:20, cost:22}, {tb:22, cost:22} ] },
  { id:'wd-red-plus', brand:'WD', model:'Red Plus', tier:'nas-hdd', type:'hdd',
    match:['wd red plus','red plus'],
    // WD Red Plus 12TB CMR: 1 M h MTBF, 1 in 10^14 URE, 215 MB/s sustained (10TB+).
    mtbf:1_000_000, ure:1e-14, readIOPS:100, writeIOPS:100, readMBs:215, writeMBs:215, ref:'A5',
    sizes:[ {tb:2, cost:35}, {tb:4, cost:28}, {tb:6, cost:27}, {tb:8, cost:26}, {tb:10, cost:25}, {tb:12, cost:24}, {tb:14, cost:24} ] },
  { id:'seagate-ironwolf', brand:'Seagate', model:'IronWolf', tier:'nas-hdd', type:'hdd',
    match:['ironwolf'], notMatch:['pro'],
    // IronWolf 14-18TB datasheet: 240 MB/s; 10/12TB: 210 MB/s.
    mtbf:1_000_000, ure:1e-15, readIOPS:100, writeIOPS:100, readMBs:240, writeMBs:240, ref:'A4',
    sizes:[ {tb:1, cost:55}, {tb:2, cost:35}, {tb:3, cost:28}, {tb:4, cost:22}, {tb:6, cost:20}, {tb:8, cost:18}, {tb:10, cost:18}, {tb:12, cost:18} ] },
  { id:'toshiba-n300', brand:'Toshiba', model:'N300', tier:'nas-hdd', type:'hdd',
    match:['toshiba n300','n300'],
    // Toshiba N300 22TB datasheet: 1.2 M h MTTF, 281 MB/s sustained.
    mtbf:1_200_000, ure:1e-15, readIOPS:120, writeIOPS:120, readMBs:281, writeMBs:281, ref:'A3',
    sizes:[ {tb:4, cost:23}, {tb:6, cost:21}, {tb:8, cost:20}, {tb:10, cost:19}, {tb:12, cost:19}, {tb:14, cost:19}, {tb:16, cost:19}, {tb:18, cost:19}, {tb:20, cost:19} ] },

  // ── CONSUMER HDD (desktop, single-drive use, lower duty cycle) ──
  // Consumer HDD datasheets often omit MTBF and random IOPS — these are derived from physics + comparable specs.
  { id:'seagate-barracuda', brand:'Seagate', model:'BarraCuda', tier:'consumer-hdd', type:'hdd',
    match:['barracuda'], notMatch:['pro','ssd'],
    // BarraCuda DS1900: 190 MB/s (8TB), URE ≤1 in 10^15 for 4-8TB SKUs (10^14 for older/smaller).
    // No MTBF row in current datasheet; 1 M h is a reasonable consumer-class estimate.
    mtbf:1_000_000, ure:1e-15, readIOPS:100, writeIOPS:100, readMBs:190, writeMBs:190, ref:'A6',
    sizes:[ {tb:1, cost:55}, {tb:2, cost:30}, {tb:3, cost:25}, {tb:4, cost:22}, {tb:6, cost:18}, {tb:8, cost:16} ] },
  { id:'wd-blue', brand:'WD', model:'Blue', tier:'consumer-hdd', type:'hdd',
    match:['wd blue','western digital blue'], notMatch:['ssd','sn'],
    // WD Blue PC HDD datasheet omits MTBF; URE <1 in 10^14. Sustained MB/s tier-dependent: 215 (8TB CMR), 180 (1-6TB).
    mtbf:1_000_000, ure:1e-14, readIOPS:80, writeIOPS:80, readMBs:180, writeMBs:180, ref:'A6',
    sizes:[ {tb:1, cost:50}, {tb:2, cost:30}, {tb:3, cost:25}, {tb:4, cost:22}, {tb:6, cost:18}, {tb:8, cost:17} ] },
  { id:'toshiba-p300', brand:'Toshiba', model:'P300', tier:'consumer-hdd', type:'hdd',
    match:['toshiba p300','p300'],
    // Toshiba P300 datasheet omits MTBF and sustained MB/s. URE 1 in 10^14. Consumer 7200rpm class.
    mtbf:600_000, ure:1e-14, readIOPS:120, writeIOPS:120, readMBs:200, writeMBs:200, ref:'A6',
    sizes:[ {tb:1, cost:50}, {tb:2, cost:28}, {tb:3, cost:23}, {tb:4, cost:20}, {tb:6, cost:18} ] },

  // ── SURVEILLANCE / 24×7 HDD (often shucked or used for write-heavy archives) ──
  { id:'wd-purple', brand:'WD', model:'Purple', tier:'surveillance-hdd', type:'hdd',
    match:['wd purple','western digital purple'],
    // WD Purple datasheet: 215 MB/s (8TB), 180 MB/s (4-6TB). 1 M h MTBF, URE <1 in 10^14.
    mtbf:1_000_000, ure:1e-14, readIOPS:100, writeIOPS:100, readMBs:180, writeMBs:180, ref:'A5',
    sizes:[ {tb:2, cost:32}, {tb:3, cost:26}, {tb:4, cost:22}, {tb:6, cost:20}, {tb:8, cost:19}, {tb:10, cost:19}, {tb:12, cost:19}, {tb:14, cost:19}, {tb:18, cost:19}, {tb:22, cost:19} ] },
  { id:'seagate-skyhawk', brand:'Seagate', model:'SkyHawk', tier:'surveillance-hdd', type:'hdd',
    match:['skyhawk'], notMatch:['ai'],
    // SkyHawk 8TB+ datasheet: 210 MB/s, URE <1 in 10^15. 1-6TB SKUs: 180 MB/s, URE 10^14.
    mtbf:1_000_000, ure:1e-14, readIOPS:100, writeIOPS:100, readMBs:210, writeMBs:210, ref:'A4',
    sizes:[ {tb:2, cost:32}, {tb:3, cost:26}, {tb:4, cost:22}, {tb:6, cost:20}, {tb:8, cost:19}, {tb:10, cost:19} ] },

  // ── CONSUMER SSD (SATA) ──
  // Samsung consumer datasheets do not publish UBER — URE entries here are conservative class estimates.
  { id:'samsung-870-evo', brand:'Samsung', model:'870 EVO', tier:'consumer-ssd', type:'ssd',
    match:['870 evo'],
    mtbf:1_500_000, ure:1e-15, readIOPS:98000, writeIOPS:88000, readMBs:560, writeMBs:530, ref:'B1',
    sizes:[ {tb:0.5, cost:80}, {tb:1, cost:75}, {tb:2, cost:70}, {tb:4, cost:65} ] },
  { id:'samsung-870-qvo', brand:'Samsung', model:'870 QVO (QLC)', tier:'consumer-ssd', type:'ssd',
    match:['870 qvo'],
    mtbf:1_500_000, ure:1e-15, readIOPS:98000, writeIOPS:88000, readMBs:560, writeMBs:530, ref:'B2',
    sizes:[ {tb:1, cost:65}, {tb:2, cost:60}, {tb:4, cost:55}, {tb:8, cost:55} ] },
  { id:'crucial-mx500', brand:'Crucial', model:'MX500', tier:'consumer-ssd', type:'ssd',
    match:['mx500'],
    mtbf:1_800_000, ure:1e-15, readIOPS:95000, writeIOPS:90000, readMBs:560, writeMBs:510, ref:'B3',
    sizes:[ {tb:0.25, cost:80}, {tb:0.5, cost:70}, {tb:1, cost:65}, {tb:2, cost:60}, {tb:4, cost:60} ] },

  // ── DATACENTER SSD (SATA) — enterprise channel, no live retail listings ──
  { id:'samsung-pm893', brand:'Samsung', model:'PM893', tier:'datacenter-ssd', type:'ssd',
    match:['pm893'], dcOnly:true,
    // PM893 datasheet: 2 M h MTBF, 1 sector per 10^17, 550 MB/s read, 520 MB/s write (max), 98K read / 30K write IOPS.
    mtbf:2_000_000, ure:1e-17, readIOPS:98000, writeIOPS:30000, readMBs:550, writeMBs:520, ref:'B4',
    sizes:[ {tb:0.96, cost:110}, {tb:1.92, cost:100}, {tb:3.84, cost:95}, {tb:7.68, cost:95} ] },

  // ── CONSUMER NVMe ──
  // Samsung/WD consumer NVMe datasheets do not publish UBER — URE values here are class estimates.
  { id:'samsung-990-pro', brand:'Samsung', model:'990 Pro', tier:'consumer-nvme', type:'nvme',
    match:['990 pro'],
    // Datasheet IOPS for 2/4TB: 1.4M read / 1.55M write. 1TB capped at 1.2M read / 1.55M write.
    mtbf:1_500_000, ure:1e-17, readIOPS:1400000, writeIOPS:1550000, readMBs:7450, writeMBs:6900, ref:'C1',
    sizes:[ {tb:1, cost:90}, {tb:2, cost:80}, {tb:4, cost:75} ] },
  { id:'wd-sn850x', brand:'WD', model:'Black SN850X', tier:'consumer-nvme', type:'nvme',
    match:['sn850x'],
    // Datasheet IOPS for 2/4TB: 1.2M read / 1.1M write. 1TB capped at 800K read.
    mtbf:1_750_000, ure:1e-17, readIOPS:1200000, writeIOPS:1100000, readMBs:7300, writeMBs:6600, ref:'C2',
    sizes:[ {tb:1, cost:80}, {tb:2, cost:75}, {tb:4, cost:70}, {tb:8, cost:75} ] },

  // ── DATACENTER NVMe — enterprise channel, no live retail listings ──
  { id:'samsung-pm9a3', brand:'Samsung', model:'PM9A3', tier:'datacenter-nvme', type:'nvme',
    match:['pm9a3'], dcOnly:true,
    // PM9A3 7.68TB datasheet: 1.1M read / 200K write IOPS, 6.7 GB/s read / 4.0 GB/s write.
    mtbf:2_000_000, ure:1e-17, readIOPS:1100000, writeIOPS:200000, readMBs:6700, writeMBs:4000, ref:'C3',
    sizes:[ {tb:1.92, cost:140}, {tb:3.84, cost:130}, {tb:7.68, cost:120}, {tb:15.36, cost:120} ] },
  { id:'solidigm-d7-p5520', brand:'Solidigm', model:'D7-P5520', tier:'datacenter-nvme', type:'nvme',
    match:['d7-p5520','p5520'], dcOnly:true,
    // D7-P5520 datasheet: 2 M h MTBF, 7.1 GB/s read / 4.2 GB/s write, 1.1M read / 200K write IOPS (7.68TB).
    mtbf:2_000_000, ure:1e-17, readIOPS:1100000, writeIOPS:200000, readMBs:7100, writeMBs:4200, ref:'C4',
    sizes:[ {tb:1.92, cost:150}, {tb:3.84, cost:140}, {tb:7.68, cost:135}, {tb:15.36, cost:130} ] },
  { id:'kioxia-cd8', brand:'Kioxia', model:'CD8-R', tier:'datacenter-nvme', type:'nvme',
    match:['cd8-r','kioxia cd8'], dcOnly:true,
    // CD8-R 3.84TB datasheet: 2.5 M h MTTF, 1.25M read / 200K write IOPS, 7.2 GB/s read / 3.8 GB/s write.
    mtbf:2_500_000, ure:1e-17, readIOPS:1250000, writeIOPS:200000, readMBs:7200, writeMBs:3800, ref:'C5',
    sizes:[ {tb:1.92, cost:155}, {tb:3.84, cost:145}, {tb:7.68, cost:140}, {tb:15.36, cost:135} ] },
];

// Snapshot the baked-in USD costs so we can reset to them when the user picks "USD baseline".
PRODUCTS.forEach(p => {
  p.sizes.forEach(s => {
    s._origCostUSD = s.cost;
    // livePrice gets {cost, currency, condition, source, sourcesSeen, fetchedAt} when matched against any live source, else null
    s.livePrice = null;
  });
});

export const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

export function productFor(g) { return g.product ? PRODUCT_BY_ID[g.product] : null; }

// Find the size-row on a product matching the group's size (tolerant float compare).
export function sizeRowFor(g) {
  const p = productFor(g); if (!p) return null;
  return p.sizes.find(s => Math.abs(s.tb - g.size) < 0.01) || null;
}

// Effective $/TB for a group: live price > baked-in size cost > group.cost (custom)
export function effectiveCost(g) {
  const sr = sizeRowFor(g);
  if (sr) {
    if (sr.livePrice && typeof sr.livePrice.cost === 'number') return sr.livePrice.cost;
    return sr.cost;
  }
  return g.cost;
}
