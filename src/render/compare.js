// ─────────── COMPARE RENDER ───────────
import { state } from '../state.js';
import { computePoolStats } from '../math/pool.js';
import { fmtCap, fmtT, fmtDur, fmtMoney, safetyGrade, currentSymbol } from '../format.js';

const comparePanel = document.getElementById('comparePanel');
const compareContainer = document.getElementById('comparisonContainer');

export function renderCompare() {
  if (state.savedPools.length < 2) {
    comparePanel.style.display = 'none';
    return;
  }
  comparePanel.style.display = '';

  const sym = currentSymbol();
  const cols = [
    { key:'name',           label:'Pool',        higher:null, fmt:v=>v },
    { key:'totalUsable',    label:'Usable',      higher:true,  fmt:fmtCap },
    { key:'totalRaw',       label:'Raw',         higher:true,  fmt:fmtCap },
    { key:'efficiency',     label:'Efficiency',  higher:true,  fmt:v=>v.toFixed(1)+'%' },
    { key:'costPerTB',      label:`${sym} / TB`, higher:false, fmt:fmtMoney },
    { key:'totalCost',      label:'Cost',        higher:false, fmt:fmtMoney },
    { key:'readIOPS',       label:'Read IOPS',   higher:true,  fmt:v=>v.toLocaleString() },
    { key:'writeIOPS',      label:'Write IOPS',  higher:true,  fmt:v=>v.toLocaleString() },
    { key:'readThroughput', label:'Read MB/s',   higher:true,  fmt:fmtT },
    { key:'writeThroughput',label:'Write MB/s',  higher:true,  fmt:fmtT },
    { key:'mttr',           label:'Resilver',    higher:false, fmt:v => v ? fmtDur(v) : '—' },
    { key:'arc',            label:'ARC RAM',     higher:true,  fmt:v=>v+' GB' },
    { key:'safetyScore',    label:'Safety',      higher:true,  fmt:v => { const g = safetyGrade(v); return `${g.grade} · ${v}`; } },
    { key:'minTolerance',   label:'Tolerance',   higher:true,  fmt:v => v === 0 ? 'NONE' : `${v}/vdev` },
    { key:'mttdlYears',     label:'MTTDL',       higher:true,  fmt:v => !isFinite(v) ? '∞' : v >= 1000 ? `${(v/1000).toFixed(0)}k yr` : v >= 1 ? `${v.toFixed(0)} yr` : `${(v*12).toFixed(1)} mo` },
    { key:'annualDiskFailures', label:'Fails/yr', higher:false, fmt:v => v.toFixed(2) },
    { key:'poolLossProbDuringResilver', label:'Resilver risk', higher:false, fmt:v => { const p = v*100; return p < 0.001 ? '<0.001%' : p < 1 ? p.toFixed(3)+'%' : p.toFixed(2)+'%'; } },
    { key:'worstUREProb',   label:'URE risk',    higher:false, fmt:v => { const p = v*100; return p < 0.01 ? '<0.01%' : p.toFixed(2)+'%'; } },
    { key:'specialDisks',   label:'Special',     higher:null,  fmt:(v, r) => v ? `${fmtCap(r.specialUsable)} (${v} drv)` : '—' },
    { key:'dedupDisks',     label:'Dedup',       higher:null,  fmt:(v, r) => v ? `${fmtCap(r.dedupUsable)} (${v} drv)` : '—' },
    { key:'cacheDisks',     label:'L2ARC',       higher:null,  fmt:(v, r) => v ? `${fmtCap(r.cacheRaw)} (${v} drv)` : '—' },
    { key:'logDisks',       label:'SLOG',        higher:null,  fmt:(v, r) => v ? `${fmtCap(r.logRaw)} (${v} drv)` : '—' },
    { key:'spareCount',     label:'Spares',      higher:true,  fmt:v => v ? `${v}` : '—' },
  ];

  const rows = state.savedPools.map(p => ({ id:p.id, name:p.name, ...computePoolStats(p.spec) }));
  const sortCol = cols.find(c => c.key === state.sortKey) || cols[1];
  rows.sort((a,b) => {
    const av = a[state.sortKey], bv = b[state.sortKey];
    if (typeof av === 'string') return state.sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return state.sortDir === 'asc' ? av - bv : bv - av;
  });

  const bestByKey = {};
  if (rows.length >= 2) {
    cols.forEach(col => {
      if (col.higher === null) return;
      const vals = rows.map(r => r[col.key]).filter(v => typeof v === 'number');
      if (!vals.length) return;
      const best = col.higher ? Math.max(...vals) : Math.min(...vals);
      const worst = col.higher ? Math.min(...vals) : Math.max(...vals);
      if (best !== worst) bestByKey[col.key] = best;
    });
  }

  let html = `<table class="compare-table"><thead><tr>`;
  cols.forEach(c => {
    const sorted = c.key === state.sortKey;
    const arrow = sorted ? (state.sortDir === 'asc' ? '▲' : '▼') : '';
    html += `<th data-key="${c.key}" class="${sorted?'sorted':''}">${c.label}<span class="sort-arrow">${arrow}</span></th>`;
  });
  html += `</tr></thead><tbody>`;
  rows.forEach(r => {
    html += `<tr>`;
    cols.forEach(c => {
      const v = r[c.key];
      const isBest = bestByKey[c.key] !== undefined && v === bestByKey[c.key];
      const cls = (c.key === 'name' ? 'name' : '') + (isBest ? ' best' : '');
      html += `<td class="${cls.trim()}">${c.fmt(v, r)}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  compareContainer.innerHTML = html;
  compareContainer.querySelectorAll('th').forEach(th => {
    th.onclick = () => {
      const k = th.dataset.key;
      if (k === 'name') return;
      if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = k; state.sortDir = (cols.find(c=>c.key===k)?.higher === false) ? 'asc' : 'desc'; }
      renderCompare();
    };
  });
}
