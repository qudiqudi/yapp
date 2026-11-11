// ─────────── BLUEPRINT RENDER ───────────
import { LAYOUTS, ROLES, ROLE_BY_ID } from '../data/layouts.js';
import { ICON } from '../icons.js';
import { state } from '../state.js';
import { computePoolStats, calcUsable } from '../math/pool.js';
import { fmtCap, fmtT, fmtDur, fmtMoney, safetyGrade } from '../format.js';

const stageEl = document.getElementById('bpStage');
const bpStatsEl = document.getElementById('bpStats');
const bpSubEl = document.getElementById('bpSub');

function roleFor(layout, i, n) {
  switch (layout) {
    case 'stripe': return { role:'data', label:'D' };
    case 'mirror': return i === 0 ? { role:'data', label:'D' } : { role:'mirror', label:'M' };
    case 'raidz1': return i === n-1 ? { role:'parity', label:'P' } : { role:'data', label:'D' };
    case 'raidz2':
      if (i >= n-2) return { role:'parity', label: i === n-2 ? 'P' : 'Q' };
      return { role:'data', label:'D' };
    case 'raidz3':
      if (i >= n-3) return { role:'parity', label: ['P','Q','R'][i-(n-3)] };
      return { role:'data', label:'D' };
  }
  return { role:'data', label:'' };
}

// Render one vdev card. `roleId` is informational (added as a small chip on the card).
function renderVdevCard(g, vIdxLabel, layoutDef, roleId) {
  const vd = document.createElement('div');
  vd.className = 'bp-vdev';
  if (roleId && roleId !== 'data') vd.classList.add('bp-vdev-aux');
  const isInvalid = g.disks < layoutDef.min;
  if (isInvalid) vd.classList.add('invalid');

  const vtag = document.createElement('div');
  vtag.className = 'bp-vdev-tag';
  vtag.textContent = `${layoutDef.label} ${vIdxLabel}`;
  vd.appendChild(vtag);

  const dwrap = document.createElement('div');
  dwrap.className = 'bp-vdev-disks';
  for (let d = 0; d < g.disks; d++) {
    const role = roleFor(g.layout, d, g.disks);
    const dEl = document.createElement('div');
    dEl.className = 'bp-disk';
    dEl.dataset.type = g.type;
    if (role.role) dEl.dataset.role = role.role;
    dEl.innerHTML = `<div class="bp-disk-size">${g.size}T</div>${role.label ? `<div class="bp-disk-role">${role.label}</div>` : ''}`;
    dwrap.appendChild(dEl);
  }
  vd.appendChild(dwrap);

  const meta = document.createElement('div');
  meta.className = 'bp-vdev-meta';
  const cap = g.disks * g.size;
  const us = calcUsable(g.layout, g.disks, g.size, state.spec.recordsizeKB ?? 128);
  meta.innerHTML = `<span>${cap.toFixed(0)} TB raw</span><span>${us.toFixed(1)} TB usable</span>`;
  vd.appendChild(meta);
  return vd;
}

export function renderBlueprint() {
  const stats = computePoolStats(state.spec);

  // header subline — describe data vdevs + any aux vdevs in shorthand
  const dataSummary = state.spec.groups
    .map(g => `${g.count}× ${LAYOUTS.find(l => l.value === g.layout)?.label || g.layout}(${g.disks}× ${g.size}TB ${g.type.toUpperCase()})`)
    .join(' + ');
  const auxSummary = ROLES
    .map(r => {
      const groups = state.spec[r.id] || [];
      if (!groups.length) return null;
      const drives = groups.reduce((n, g) => n + (g.count * g.disks), 0);
      return `${r.short} ${drives}-drv`;
    })
    .filter(Boolean).join(' + ');
  bpSubEl.textContent = auxSummary ? `${dataSummary} + ${auxSummary}` : dataSummary;

  // ── data pool frame ──
  const frame = document.createElement('div');
  frame.className = 'bp-pool-frame';
  const tag = document.createElement('div');
  tag.className = 'bp-pool-tag';
  tag.textContent = `Pool · ${stats.vdevCount} vdev${stats.vdevCount===1?'':'s'} striped`;
  frame.appendChild(tag);

  const vdevsWrap = document.createElement('div');
  vdevsWrap.className = 'bp-vdevs';

  let vIdx = 0;
  state.spec.groups.forEach(g => {
    const layoutDef = LAYOUTS.find(l => l.value === g.layout);
    if (!layoutDef) return;
    for (let i = 0; i < g.count; i++) {
      vIdx++;
      if (vIdx > 1) {
        const arrow = document.createElement('div');
        arrow.className = 'bp-stripe-arrow';
        arrow.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/><polyline points="11 6 5 12 11 18"/></svg>`;
        arrow.title = 'Striped across';
        vdevsWrap.appendChild(arrow);
      }
      vdevsWrap.appendChild(renderVdevCard(g, `#${vIdx}`, layoutDef, 'data'));
    }
  });
  frame.appendChild(vdevsWrap);

  stageEl.innerHTML = '';
  stageEl.appendChild(frame);

  // ── aux vdev panels (one row per non-empty role) ──
  ROLES.forEach(roleDef => {
    const groups = state.spec[roleDef.id] || [];
    if (!groups.length) return;

    const auxFrame = document.createElement('div');
    auxFrame.className = 'bp-aux-frame';
    auxFrame.dataset.role = roleDef.id;

    const auxTag = document.createElement('div');
    auxTag.className = 'bp-aux-tag';
    auxTag.innerHTML = `<strong>${roleDef.label}</strong><span class="bp-aux-tag-desc">${roleDef.desc}</span>`;
    auxFrame.appendChild(auxTag);

    const auxVdevs = document.createElement('div');
    auxVdevs.className = 'bp-vdevs bp-vdevs-aux';

    let aIdx = 0;
    groups.forEach(g => {
      const layoutDef = LAYOUTS.find(l => l.value === g.layout);
      if (!layoutDef) return;
      for (let i = 0; i < g.count; i++) {
        aIdx++;
        if (aIdx > 1) {
          const sep = document.createElement('div');
          sep.className = 'bp-aux-sep';
          auxVdevs.appendChild(sep);
        }
        auxVdevs.appendChild(renderVdevCard(g, `#${aIdx}`, layoutDef, roleDef.id));
      }
    });
    auxFrame.appendChild(auxVdevs);
    stageEl.appendChild(auxFrame);
  });

  if (stats.invalid.length > 0) {
    const w = document.createElement('div');
    w.className = 'bp-warn';
    w.innerHTML = `${ICON.warn} ${stats.invalid.join(' · ')}`;
    stageEl.appendChild(w);
  }

  // ── stats strip ──
  bpStatsEl.innerHTML = '';
  const grade = safetyGrade(stats.safetyScore);
  const tolStr = stats.minTolerance === 0 ? 'NONE' : `${stats.minTolerance} disk${stats.minTolerance>1?'s':''}/vdev`;
  const mttdlStr = !isFinite(stats.mttdlYears) ? '∞'
    : stats.mttdlYears >= 1000 ? `${(stats.mttdlYears/1000).toFixed(0)}k yr`
    : stats.mttdlYears >= 1 ? `${stats.mttdlYears.toFixed(0)} yr`
    : `${(stats.mttdlYears*12).toFixed(1)} mo`;
  const lossPct = (stats.poolLossProbDuringResilver * 100);
  const lossStr = lossPct < 0.001 ? '<0.001%'
    : lossPct < 0.01 ? lossPct.toFixed(4)+'%'
    : lossPct < 1 ? lossPct.toFixed(3)+'%'
    : lossPct.toFixed(2)+'%';
  const ureStr = (stats.worstUREProb * 100) < 0.01 ? '<0.01%'
    : (stats.worstUREProb * 100).toFixed(2)+'%';

  const auxDisksTotal = stats.specialDisks + stats.dedupDisks + stats.logDisks + stats.cacheDisks + stats.spareCount;
  const dataDisks = stats.totalDisks - auxDisksTotal;

  const statRows = [
    { label: 'Disks',       value: `${stats.totalDisks}`,
      sub: auxDisksTotal ? `${dataDisks} data + ${auxDisksTotal} aux` : `${stats.vdevCount} vdev${stats.vdevCount===1?'':'s'}` },
    { label: 'Raw',         value: fmtCap(stats.totalRaw) },
    { label: 'Usable',      value: fmtCap(stats.totalUsable), sub: `${stats.efficiency.toFixed(1)}% efficient` },
    { label: 'Cost',        value: fmtMoney(stats.totalCost), sub: `${fmtMoney(stats.costPerTB)} / TB` },
    { label: 'Read IOPS',   value: stats.readIOPS.toLocaleString(),
      sub: stats.cacheReadIOPSAdd ? `+${stats.cacheReadIOPSAdd.toLocaleString()} L2ARC · ${fmtT(stats.readThroughput)}` : fmtT(stats.readThroughput) },
    { label: 'Write IOPS',  value: stats.writeIOPS.toLocaleString(),
      sub: stats.slogSyncIOPS ? `+${stats.slogSyncIOPS.toLocaleString()} sync (SLOG) · ${fmtT(stats.writeThroughput)}` : fmtT(stats.writeThroughput) },
    { label: 'Resilver',    value: stats.mttr ? fmtDur(stats.mttr) : '—',
      sub: stats.spareCount ? `auto-resilver · ${stats.spareCount} spare${stats.spareCount===1?'':'s'}`
        : stats.danglingHours ? `degraded ${fmtDur(stats.danglingHours)}` : '' },
    { label: 'ARC RAM',     value: `${stats.arc} GB` },
    { label: 'Safety',      value: `${grade.grade} · ${stats.safetyScore}`, sub: grade.label, colorClass: grade.colorClass },
    { label: 'Tolerance',   value: tolStr, sub: 'min disks lost / vdev' },
    { label: 'MTTDL',       value: mttdlStr, sub: 'mean time to data loss' },
    { label: 'Disk fails / yr', value: stats.annualDiskFailures.toFixed(2),
      sub: `${stats.annualDiskFailuresReal.toFixed(2)} Backblaze · ${stats.expectedFailuresIn3yr.toFixed(1)} in 3 yr (vendor)` },
    { label: 'Loss in resilver', value: lossStr, sub: 'after 1st failure' },
    { label: 'URE risk',    value: ureStr, sub: 'per resilver pass' },
  ];

  // Conditional aux-only stat tiles — only shown when the user has actually configured them.
  if (stats.specialVdevCount > 0) {
    statRows.push({ label: 'Special', value: fmtCap(stats.specialUsable),
      sub: `${stats.specialDisks} drv · metadata offload` });
  }
  if (stats.dedupVdevCount > 0) {
    statRows.push({ label: 'Dedup', value: fmtCap(stats.dedupUsable),
      sub: `${stats.dedupDisks} drv · dedup table` });
  }
  if (stats.cacheVdevCount > 0) {
    statRows.push({ label: 'L2ARC', value: fmtCap(stats.cacheRaw),
      sub: `${stats.cacheDisks} drv · read cache` });
  }
  if (stats.logVdevCount > 0) {
    statRows.push({ label: 'SLOG', value: fmtCap(stats.logRaw),
      sub: `${stats.logDisks} drv · sync log` });
  }
  if (stats.spareCount > 0) {
    statRows.push({ label: 'Spares', value: `${stats.spareCount}`,
      sub: 'hot standby' });
  }

  statRows.forEach(s => {
    const d = document.createElement('div');
    d.className = 'bp-stat';
    d.innerHTML = `
      <div class="bp-stat-label">${s.label}</div>
      <div class="bp-stat-value${s.colorClass ? ' ' + s.colorClass : ''}">${s.value}</div>
      ${s.sub ? `<div class="bp-stat-sub">${s.sub}</div>` : ''}
    `;
    bpStatsEl.appendChild(d);
  });
}
