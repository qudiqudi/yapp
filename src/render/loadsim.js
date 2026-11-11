// ─────────── LOAD SIMULATION RENDER ───────────
// Workload picker + per-pool saturation bars. The composer pool always renders
// a card; saved pools each get their own card so the user can see side-by-side
// how a layout choice changes saturation under the same workload.
import { WORKLOADS, WORKLOAD_BY_ID } from '../data/workloads.js';
import { simulateLoad } from '../math/loadsim.js';
import { state, saveState } from '../state.js';
import { rerender } from '../bus.js';

const pickerEl = document.getElementById('loadSimPicker');
const resultsEl = document.getElementById('loadSimResults');
const detailsEl = document.getElementById('loadSimDetails');

function pct(v) {
  if (!isFinite(v)) return '∞';
  return `${Math.round(v * 100)}%`;
}

function toneFor(saturation) {
  if (!isFinite(saturation) || saturation >= 1.0) return 'danger';
  if (saturation >= 0.85) return 'danger';
  if (saturation >= 0.6) return 'warn';
  return 'good';
}

function renderBar(dim) {
  const tone = toneFor(dim.saturation);
  // Cap visual fill at 100%; >100% gets an "over" badge that sticks past the track.
  const fillPct = Math.min(100, Math.max(0, (isFinite(dim.saturation) ? dim.saturation : 1) * 100));
  const overflow = isFinite(dim.saturation) && dim.saturation > 1.0;

  const dStr = `${dim.demand.toLocaleString()}${dim.unit}`;
  const cStr = dim.capacity > 0
    ? `${dim.capacity.toLocaleString()}${dim.unit}`
    : 'no capacity';

  return `
    <div class="loadsim-row">
      <div class="loadsim-row-head">
        <span class="loadsim-row-label">${dim.label}</span>
        <span class="loadsim-row-numbers tnum">
          <span class="loadsim-demand">${dStr}</span>
          <span class="loadsim-vs">/</span>
          <span class="loadsim-cap">${cStr}</span>
          <span class="loadsim-sat loadsim-${tone}">${pct(dim.saturation)}</span>
        </span>
      </div>
      <div class="loadsim-bar">
        <div class="loadsim-bar-fill loadsim-${tone}" style="width:${fillPct}%"></div>
        ${overflow ? `<div class="loadsim-bar-over">over</div>` : ''}
      </div>
      ${dim.note ? `<div class="loadsim-row-note">${dim.note}</div>` : ''}
    </div>
  `;
}

function renderCard(name, spec, workload, opts = {}) {
  const result = simulateLoad(spec, workload);
  const verdictTone = result.verdict.tone;
  const notesHtml = result.notes.length
    ? `<div class="loadsim-notes">${result.notes.map(n => `<div class="loadsim-note">${n}</div>`).join('')}</div>`
    : '';
  return `
    <div class="loadsim-card${opts.active ? ' active' : ''}">
      <div class="loadsim-card-head">
        <div class="loadsim-card-name">${escapeHtml(name)}</div>
        <div class="loadsim-verdict loadsim-${verdictTone}">${result.verdict.text}</div>
      </div>
      <div class="loadsim-bars">
        ${result.dims.map(renderBar).join('')}
      </div>
      ${notesHtml}
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function renderPicker(activeId) {
  // Same chip-card grid as the recommender's workload picker — one workload language
  // across both panels.
  pickerEl.className = 'workload-picker';
  pickerEl.innerHTML = WORKLOADS.map(w => `
    <button class="workload-chip${w.id === activeId ? ' active' : ''}" data-id="${w.id}" type="button">
      <span class="workload-chip-cat">${escapeHtml(w.category)}</span>
      <span class="workload-chip-label">${escapeHtml(w.label)}</span>
      <span class="workload-chip-desc">${escapeHtml(w.desc)}</span>
      <span class="workload-chip-fp tnum">${escapeHtml(w.fingerprint)}</span>
    </button>
  `).join('');
  pickerEl.querySelectorAll('.workload-chip').forEach(btn => {
    btn.onclick = () => {
      state.workloadId = btn.dataset.id;
      saveState();
      // Re-render so the recommender's highlighted chip stays in sync.
      rerender();
    };
  });
}

export function renderLoadSim() {
  const workload = WORKLOAD_BY_ID[state.workloadId] || WORKLOADS[0];
  if (!WORKLOAD_BY_ID[state.workloadId]) state.workloadId = workload.id;

  renderPicker(workload.id);

  // Always show the live composer pool first; saved pools follow as comparison cards.
  const cards = [];
  cards.push(renderCard('Composer (live)', state.spec, workload, { active: true }));
  state.savedPools.forEach(p => {
    cards.push(renderCard(p.name, p.spec, workload));
  });
  resultsEl.innerHTML = cards.join('');

  // Show the workload spec sheet underneath so users can sanity-check assumptions.
  // ARC hit rate is now derived per-pool from working set vs ARC × locality, so it
  // belongs in the per-card row notes, not in the workload-spec strip.
  if (detailsEl) {
    detailsEl.innerHTML = `
      <div class="loadsim-spec">
        <span class="loadsim-spec-label">Workload spec</span>
        <span class="loadsim-spec-item tnum">${workload.readIOPS.toLocaleString()} read IOPS</span>
        <span class="loadsim-spec-item tnum">${workload.writeIOPS.toLocaleString()} write IOPS</span>
        <span class="loadsim-spec-item tnum">${workload.readMBps} MB/s read</span>
        <span class="loadsim-spec-item tnum">${workload.writeMBps} MB/s write</span>
        <span class="loadsim-spec-item tnum">${workload.recordSize} K block</span>
        <span class="loadsim-spec-item tnum">QD ${workload.queueDepth}</span>
        <span class="loadsim-spec-item tnum">${((workload.randomFraction ?? 0.5)*100).toFixed(0)}% random</span>
        <span class="loadsim-spec-item tnum">${(workload.syncFraction*100).toFixed(0)}% sync</span>
        <span class="loadsim-spec-item tnum">${(workload.smallBlockFraction*100).toFixed(0)}% small-block</span>
        <span class="loadsim-spec-item tnum">${workload.workingSetGB} GB working set</span>
        <span class="loadsim-spec-item tnum">${((workload.localityFactor ?? 0.5)*100).toFixed(0)}% locality</span>
        ${workload.latencySensitive ? '<span class="loadsim-spec-item tnum">latency-sensitive</span>' : ''}
      </div>
    `;
  }
}
