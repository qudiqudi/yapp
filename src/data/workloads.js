// ─────────── WORKLOAD PRESETS ───────────
// First-order workload models for the load simulator. Each preset declares the
// dimensions the simulator needs to map a workload onto a pool's capability:
//
//   readIOPS / writeIOPS  — sustained ops/sec the workload generates
//   readMBps / writeMBps  — sustained throughput in MiB/s
//   queueDepth            — concurrent in-flight requests (drives per-disk IOPS realism)
//   recordSize            — typical request size in KiB (drives recordsize-mismatch math)
//   randomFraction        — fraction of ops that are random vs sequential (0..1).
//                           random ops contend for IOPS capacity; sequential ops contend for MB/s.
//   syncFraction          — fraction of writes that must be flushed (sync) — routes to SLOG
//   smallBlockFraction    — fraction of writes that are small enough to land on a special vdev
//   workingSetGB          — hot data the workload re-reads — drives ARC pressure + hit rate
//   localityFactor        — re-read locality (0..1): 1 = perfectly hot, 0 = cold scan.
//                           Drives derived ARC hit rate alongside ARC/working-set ratio.
//   latencySensitive      — true for OLTP/VM-style workloads; tightens verdict bands.
//
// Numbers are deliberately conservative steady-state targets, not peak bursts.
// The disclaimer in the panel surfaces this — the goal is to compare layouts,
// not predict an SLA.

// Each workload has an archetype-first label so the user reads the I/O character, not
// an arbitrary anecdote. `category` and `fingerprint` are display-only — the simulator
// doesn't read them — so renderers can group/scan workloads at a glance without
// needing to pick one to see what it actually does.
//
// `compressionRatio` is the typical LZ4 compression ratio for this data type (real ZFS
// has compression=lz4 on by default). Compression cuts both data-vdev bandwidth demand
// and ARC working-set size by this factor — it's transparent to the workload. Values
// reflect Backblaze + ZFS community measurements, not vendor marketing.
export const WORKLOADS = [
  {
    id: 'torrents',
    category: 'Mixed',
    label: 'Torrent seedbox',
    desc: 'many concurrent peers, small random reads, light writes',
    fingerprint: '~2k r-IOPS · 200 MB/s read · 16 K block · 85% random',
    readIOPS: 2000, writeIOPS: 200, readMBps: 200, writeMBps: 50,
    queueDepth: 64, recordSize: 16,
    randomFraction: 0.85, syncFraction: 0.05, smallBlockFraction: 0.4,
    workingSetGB: 50, localityFactor: 0.5,
    compressionRatio: 1.0,   // pre-compressed media payloads
    latencySensitive: false,
  },
  {
    id: 'postgres',
    category: 'Database',
    label: 'Database / OLTP',
    desc: 'fsync-heavy, latency-sensitive small random R/W',
    fingerprint: '~4k r-IOPS · 2k w-IOPS · 8 K block · 95% sync',
    readIOPS: 4000, writeIOPS: 2000, readMBps: 300, writeMBps: 150,
    queueDepth: 32, recordSize: 8,
    randomFraction: 0.9, syncFraction: 0.95, smallBlockFraction: 0.7,
    workingSetGB: 100, localityFactor: 0.85,
    compressionRatio: 1.8,   // text + indices, structured
    latencySensitive: true,
  },
  {
    id: 'plex',
    category: 'Media',
    label: 'Media streaming',
    desc: 'sequential reads, large blocks, a few concurrent streams',
    fingerprint: '800 MB/s read · 1 M block · 90% sequential',
    readIOPS: 200, writeIOPS: 50, readMBps: 800, writeMBps: 100,
    queueDepth: 16, recordSize: 1024,
    randomFraction: 0.1, syncFraction: 0.01, smallBlockFraction: 0.0,
    workingSetGB: 200, localityFactor: 0.3,
    compressionRatio: 1.0,   // h264/h265, AAC — already compressed
    latencySensitive: false,
  },
  {
    id: 'video-edit',
    category: 'Media',
    label: 'Video editing scratch',
    desc: 'sustained sequential R/W, latency-sensitive playback',
    fingerprint: '1.5 GB/s read · 1 GB/s write · 1 M block',
    readIOPS: 500, writeIOPS: 500, readMBps: 1500, writeMBps: 1000,
    queueDepth: 8, recordSize: 1024,
    randomFraction: 0.05, syncFraction: 0.1, smallBlockFraction: 0.0,
    workingSetGB: 500, localityFactor: 0.4,
    compressionRatio: 1.0,   // ProRes / H.264 — already compressed
    latencySensitive: true,
  },
  {
    id: 'rsync',
    category: 'Backup',
    label: 'Bulk file transfer',
    desc: 'large-block sequential, no fsync pressure',
    fingerprint: '800 MB/s sustained · 1 M block · pure sequential',
    readIOPS: 100, writeIOPS: 100, readMBps: 800, writeMBps: 800,
    queueDepth: 8, recordSize: 1024,
    randomFraction: 0.0, syncFraction: 0.0, smallBlockFraction: 0.0,
    workingSetGB: 1000, localityFactor: 0.05,
    compressionRatio: 1.5,   // mixed file types
    latencySensitive: false,
  },
  {
    id: 'vm-images',
    category: 'Virtualization',
    label: 'VM / container images',
    desc: 'random R/W, mixed sync, dedup-friendly',
    fingerprint: '~5k r-IOPS · 3k w-IOPS · 16 K block · 50% sync',
    readIOPS: 5000, writeIOPS: 3000, readMBps: 400, writeMBps: 250,
    queueDepth: 64, recordSize: 16,
    randomFraction: 0.95, syncFraction: 0.5, smallBlockFraction: 0.5,
    workingSetGB: 300, localityFactor: 0.7,
    compressionRatio: 2.0,   // sparse + binaries + duplicate base images
    latencySensitive: true,
  },
  {
    id: 'archive',
    category: 'Backup',
    label: 'Cold archive',
    desc: 'write once, rarely read — capacity over speed',
    fingerprint: '100 MB/s write · negligible reads · 1 M block',
    readIOPS: 20, writeIOPS: 10, readMBps: 50, writeMBps: 100,
    queueDepth: 4, recordSize: 1024,
    randomFraction: 0.0, syncFraction: 0.0, smallBlockFraction: 0.0,
    workingSetGB: 10, localityFactor: 0.0,
    compressionRatio: 1.5,   // mixed archive content
    latencySensitive: false,
  },
];

export const WORKLOAD_BY_ID = Object.fromEntries(WORKLOADS.map(w => [w.id, w]));
