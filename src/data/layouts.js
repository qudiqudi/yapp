// ─────────── LAYOUTS / PRESETS ───────────
export const LAYOUTS = [
  { value:'mirror',  label:'mirror',   min:2, parity:0, desc:'2× redundancy' },
  { value:'raidz1',  label:'RAID-Z1',  min:3, parity:1, desc:'1 disk redundancy' },
  { value:'raidz2',  label:'RAID-Z2',  min:4, parity:2, desc:'2 disk redundancy' },
  { value:'raidz3',  label:'RAID-Z3',  min:5, parity:3, desc:'3 disk redundancy' },
  { value:'stripe',  label:'stripe',   min:1, parity:0, desc:'no redundancy' },
];

// TrueNAS-style auxiliary vdev roles. Each role lives in its own array on state.spec
// (parallel to spec.groups for data vdevs). Layout constraints reflect what ZFS actually
// supports for that role:
//   - special / dedup: must be redundant (mirror or raidz). Loss of any of these = pool loss.
//   - log (SLOG): mirror recommended; stripe (single drive) allowed but loses in-flight sync writes if it dies.
//   - cache (L2ARC): always non-redundant — ZFS doesn't support mirrored L2ARC; multiple cache devices stripe.
//   - spares: just a pool of standby drives, no layout. Modeled as stripe with a count of disks.
export const ROLES = [
  { id:'special', label:'special vdev', short:'special', desc:'metadata + small blocks',
    layouts:['mirror','raidz1','raidz2','raidz3'], defaultLayout:'mirror', minDisks:2,
    poolCritical:true,
    defaultGroup:{ count:1, layout:'mirror', disks:2, size:1, type:'nvme', cost:80, product:'samsung-990-pro' } },
  { id:'dedup',   label:'dedup vdev', short:'dedup', desc:'dedup table',
    layouts:['mirror','raidz1','raidz2','raidz3'], defaultLayout:'mirror', minDisks:2,
    poolCritical:true,
    defaultGroup:{ count:1, layout:'mirror', disks:2, size:1, type:'nvme', cost:80, product:'samsung-990-pro' } },
  { id:'log',     label:'SLOG (log vdev)', short:'SLOG', desc:'sync write log',
    layouts:['mirror','stripe'], defaultLayout:'mirror', minDisks:1,
    poolCritical:false,
    defaultGroup:{ count:1, layout:'mirror', disks:2, size:1, type:'nvme', cost:80, product:'samsung-990-pro' } },
  { id:'cache',   label:'L2ARC (cache vdev)', short:'L2ARC', desc:'read cache',
    layouts:['stripe'], defaultLayout:'stripe', minDisks:1,
    poolCritical:false,
    defaultGroup:{ count:1, layout:'stripe', disks:1, size:1, type:'nvme', cost:80, product:'samsung-990-pro' } },
  { id:'spares',  label:'hot spares', short:'spares', desc:'auto-replace failed drives',
    layouts:['stripe'], defaultLayout:'stripe', minDisks:1,
    poolCritical:false,
    defaultGroup:{ count:1, layout:'stripe', disks:2, size:8, type:'hdd', cost:25, product:'wd-red-pro' } },
];

export const ROLE_BY_ID = Object.fromEntries(ROLES.map(r => [r.id, r]));
export const AUX_ROLE_IDS = ROLES.map(r => r.id);

export const PRESETS = [
  { id: 'mirror2',     label: 'Mirror (2 disks)',           groups: [{ count:1, layout:'mirror', disks:2, size:8,  type:'hdd',  cost:25, product:'wd-red-pro' }] },
  { id: 'raid10',      label: 'Striped Mirrors (RAID-10)',  groups: [{ count:2, layout:'mirror', disks:2, size:8,  type:'hdd',  cost:25, product:'wd-red-pro' }] },
  { id: 'raidz1',      label: 'RAID-Z1 (4 disks)',          groups: [{ count:1, layout:'raidz1', disks:4, size:8,  type:'hdd',  cost:25, product:'wd-red-pro' }] },
  { id: 'raidz2',      label: 'RAID-Z2 (6 × 16 TB NAS)',    groups: [{ count:1, layout:'raidz2', disks:6, size:16, type:'hdd',  cost:20, product:'seagate-ironwolf-pro' }] },
  { id: 'raidz2x2',    label: 'Striped RAID-Z2 (Exos)',     groups: [{ count:2, layout:'raidz2', disks:6, size:20, type:'hdd',  cost:18, product:'seagate-exos-x20' }] },
  { id: 'raidz3',      label: 'RAID-Z3 (8 × 18 TB Exos)',   groups: [{ count:1, layout:'raidz3', disks:8, size:18, type:'hdd',  cost:17, product:'seagate-exos-x18' }] },
  { id: 'flash',       label: 'All-flash mirrors (NVMe)',   groups: [{ count:3, layout:'mirror', disks:2, size:4,  type:'nvme', cost:75, product:'samsung-990-pro' }] },
];
