// ─────────── TIERS ───────────
export const TIERS = [
  { id:'enterprise-hdd',   label:'Enterprise HDD',   sub:'24/7 helium-filled, 2.5 M h MTBF' },
  { id:'nas-hdd',          label:'NAS HDD',          sub:'Lighter duty, 1–1.4 M h MTBF' },
  { id:'consumer-hdd',     label:'Consumer HDD',     sub:'Desktop class, single-drive duty cycle' },
  { id:'surveillance-hdd', label:'Surveillance HDD', sub:'24×7 write-optimized, lower URE budget' },
  { id:'consumer-ssd',     label:'Consumer SSD',     sub:'SATA, TLC/QLC NAND' },
  { id:'datacenter-ssd',   label:'Datacenter SSD',   sub:'SATA, mixed-use endurance' },
  { id:'consumer-nvme',    label:'Consumer NVMe',    sub:'PCIe 4.0/5.0, M.2' },
  { id:'datacenter-nvme',  label:'Datacenter NVMe',  sub:'U.2, mixed-use, power-loss protection' },
];
