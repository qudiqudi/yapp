// ─────────── POOL RECOMMENDER PANEL ───────────
// Flagship feature: workload + capacity + reliability → top-3 pool picks.
// Renders inline (not popover) above the load-sim panel so it's the first thing
// users land on. Picks load into the composer with one click and also push into
// saved pools so users can compare them side-by-side in the existing compare panel.
import { WORKLOADS, WORKLOAD_BY_ID } from '../data/workloads.js';
import { recommendPools } from '../math/recommender.js';
import { state, saveState } from '../state.js';
import { rerender } from '../bus.js';
import { fmtCap, fmtMoney } from '../format.js';
import { LAYOUTS } from '../data/layouts.js';

const formEl    = document.getElementById('recommendForm');
const resultsEl = document.getElementById('recommendResults');

// Local UI state — kept on window so re-renders don't lose the user's last picks.
// Note: workloadId lives on `state` (shared with the load-sim picker so picking once
// updates both), so it's intentionally not duplicated here.
const uiState = (window.__recState = window.__recState || {
  minUsableTB: null,
  reliability: 'enterprise',
  results: [],
  ran: false,
});

const DEFAULT_FLOOR_TB = {
  torrents: 20, postgres: 2, plex: 40, 'video-edit': 20,
  rsync: 40, 'vm-images': 10, archive: 100,
};

const RELIABILITY_OPTIONS = [
  { value: 'enterprise', label: 'Enterprise',  desc: 'datacenter HDD/SSD/NVMe only — recommended for ZFS' },
  { value: 'nas-grade',  label: 'NAS-grade',   desc: 'enterprise + NAS HDDs + consumer NVMe' },
  { value: 'any',        label: 'Any',         desc: 'include consumer/surveillance — cheapest, lower MTBF' },
];

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

export function renderRecommend() {
  if (!formEl || !resultsEl) return;

  // Workload is shared with the load-sim picker via state.workloadId — pick it once,
  // both panels update. Default to whichever the load-sim was already on.
  if (!state.workloadId || !WORKLOAD_BY_ID[state.workloadId]) state.workloadId = 'plex';
  const workload = WORKLOAD_BY_ID[state.workloadId];
  if (uiState.minUsableTB == null) uiState.minUsableTB = DEFAULT_FLOOR_TB[workload.id] ?? 10;

  // ── form ──
  // Workload picker is a chip-card grid — same visual language as the load-sim picker
  // below — so the user reads each workload's character at a glance instead of decoding
  // an arbitrary dropdown label. The category prefix and fingerprint surface the I/O
  // archetype without needing to click first.
  const chipsHtml = WORKLOADS.map(w => `
    <button class="workload-chip${w.id === workload.id ? ' active' : ''}" data-id="${w.id}" type="button">
      <span class="workload-chip-cat">${escapeHtml(w.category)}</span>
      <span class="workload-chip-label">${escapeHtml(w.label)}</span>
      <span class="workload-chip-desc">${escapeHtml(w.desc)}</span>
      <span class="workload-chip-fp tnum">${escapeHtml(w.fingerprint)}</span>
    </button>
  `).join('');

  formEl.innerHTML = `
    <div class="rec-form-row rec-form-row-workload">
      <label class="field-label">Workload</label>
      <div class="workload-picker" id="recWorkloadPicker">${chipsHtml}</div>
    </div>
    <div class="rec-form-row rec-form-row-controls">
      <div class="field">
        <label class="field-label">Min usable</label>
        <div class="field-suffix-group">
          <input type="number" id="recMinUsable" min="1" max="2000" step="1" value="${uiState.minUsableTB}" class="field-input rec-field-min-input"/>
          <span class="field-suffix">TB</span>
        </div>
      </div>
      <div class="field">
        <label class="field-label">Drive grade</label>
        <select class="field-select rec-field-min-select" id="recReliability">
          ${RELIABILITY_OPTIONS.map(o =>
            `<option value="${o.value}"${o.value === uiState.reliability ? ' selected' : ''} title="${escapeHtml(o.desc)}">${escapeHtml(o.label)}</option>`
          ).join('')}
        </select>
      </div>
      <button class="btn btn-accent" id="recRun">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Recommend
      </button>
    </div>
  `;

  formEl.querySelectorAll('.workload-chip').forEach(btn => {
    btn.onclick = () => {
      state.workloadId = btn.dataset.id;
      // Reset min usable to the new workload's default whenever the user changes
      // workloads — the previous floor is rarely the right answer for a new archetype.
      uiState.minUsableTB = DEFAULT_FLOOR_TB[state.workloadId] ?? 10;
      // rerender() updates both the recommender and the load-sim picker so the two
      // panels stay in sync without either side importing the other.
      rerender();
    };
  });
  formEl.querySelector('#recMinUsable').oninput = (e) => {
    uiState.minUsableTB = parseFloat(e.target.value) || 1;
  };
  formEl.querySelector('#recReliability').onchange = (e) => {
    uiState.reliability = e.target.value;
  };
  formEl.querySelector('#recRun').onclick = runSearch;
  formEl.querySelector('#recMinUsable').onkeydown = (e) => {
    if (e.key === 'Enter') runSearch();
  };

  // ── results ──
  // The empty-state sits inside a flex container, so the message must live in a single
  // wrapping <span> — otherwise the inline <strong> becomes its own flex item and the
  // surrounding whitespace gets collapsed ("hitRecommend.").
  if (!uiState.ran) {
    resultsEl.innerHTML = `
      <div class="rec-empty">
        <span><span class="rec-empty-arrow">←</span>Pick a workload, set capacity, and hit <strong>Recommend</strong>.</span>
      </div>
    `;
    return;
  }
  if (!uiState.results.length) {
    resultsEl.innerHTML = `
      <div class="rec-empty rec-empty-warn">
        <span>No pool in the catalog comfortably sustains <strong>${escapeHtml(workload.label)}</strong> at ${uiState.minUsableTB} TB usable with <strong>${RELIABILITY_OPTIONS.find(o=>o.value===uiState.reliability).label}</strong> drives. Try lowering capacity, relaxing drive grade, or accepting a tighter verdict in the load sim below.</span>
      </div>
    `;
    return;
  }
  resultsEl.innerHTML = `
    ${renderSearchNote(uiState.results, workload)}
    <div class="rec-cards">
      ${uiState.results.map((p, i) => renderPickCard(p, i)).join('')}
    </div>
    <div class="rec-actions">
      <button class="btn btn-outline btn-sm" id="recLoadAll">Save all 3 for side-by-side compare</button>
      <span class="rec-action-hint">picks scored against <strong>${escapeHtml(workload.label)}</strong> · ${uiState.minUsableTB} TB min · ${RELIABILITY_OPTIONS.find(o=>o.value===uiState.reliability).label} drives</span>
    </div>
  `;
  resultsEl.querySelectorAll('.rec-card').forEach(card => {
    card.querySelector('.rec-card-load').onclick = () => {
      const idx = parseInt(card.dataset.idx, 10);
      loadIntoComposer(uiState.results[idx]);
    };
    card.querySelector('.rec-card-save').onclick = () => {
      const idx = parseInt(card.dataset.idx, 10);
      saveAsPool(uiState.results[idx], idx + 1);
    };
  });
  resultsEl.querySelector('#recLoadAll').onclick = saveAllAsPools;
}

function runSearch() {
  const workload = WORKLOAD_BY_ID[state.workloadId];
  if (!workload) return;
  uiState.results = recommendPools(workload, {
    minUsableTB: uiState.minUsableTB,
    reliability: uiState.reliability,
    limit: 3,
  });
  uiState.ran = true;
  renderRecommend();
}

// Footnote that explains *why* the picks look the way they do — particularly useful when
// every pick is flash. The recommender attaches per-type pass/fail counts to the result
// array so we don't have to re-run the search here.
function renderSearchNote(results, workload) {
  const search = results.search;
  if (!search) return '';
  const passed = search.passed || {};
  const tried  = search.tried || {};
  const types  = ['hdd', 'ssd', 'nvme'];
  const present = types.filter(t => passed[t] > 0);
  if (!present.length) return '';
  // If every result is the same type, point out which types couldn't sustain.
  const onlyType = present.length === 1 ? present[0] : null;
  if (!onlyType) return '';

  const failedTypes = types.filter(t => tried[t] > 0 && passed[t] === 0);
  if (!failedTypes.length) return '';

  const typeLabel = { hdd: 'HDD', ssd: 'SSD', nvme: 'NVMe' };
  const verb = onlyType === 'hdd' ? 'flash dropped out — '
                                  : `${failedTypes.map(t=>typeLabel[t]).join(' / ')} couldn't comfortably sustain `;
  // Pick a representative bottleneck from the cheapest near-miss of the failed type.
  const fail = search.cheapestFailing && search.cheapestFailing[failedTypes[0]];
  const why = fail
    ? ` (cheapest ${typeLabel[failedTypes[0]]} layout bottlenecked on ${escapeHtml(fail.worstDim.label)} at ${Math.round(fail.worstDim.saturation*100)}%)`
    : '';
  return `<div class="rec-footnote">All picks use <strong>${typeLabel[onlyType]}</strong> — ${verb}<strong>${escapeHtml(workload.label)}</strong>${why}.</div>`;
}

function renderPickCard(p, idx) {
  const dataSummary = p.spec.groups.map(g => {
    const layout = LAYOUTS.find(l => l.value === g.layout)?.label || g.layout;
    return `${g.count}× ${layout}(${g.disks}× ${g.size} TB)`;
  }).join(' + ');
  const auxBits = [];
  if (p.spec.log?.length)     auxBits.push('SLOG');
  if (p.spec.special?.length) auxBits.push('special');
  if (p.spec.cache?.length)   auxBits.push('L2ARC');
  const auxLabel = auxBits.length ? auxBits.join(' + ') : null;
  const recordLabel = p.spec.recordsizeKB && p.spec.recordsizeKB !== 128 ? `recordsize ${p.spec.recordsizeKB} K` : null;
  const driveProduct = p.spec.groups[0]?.product || 'custom';
  const isWinner = idx === 0;
  return `
    <div class="rec-card${isWinner ? ' rec-card-winner' : ''}" data-idx="${idx}">
      <div class="rec-card-rank">#${idx+1}${isWinner ? ' · best value' : ''}</div>
      <div class="rec-card-cost">${fmtMoney(p.cost)}</div>
      <div class="rec-card-perTB">${fmtMoney(p.costPerTB)}/TB · ${fmtCap(p.usableTB)} usable</div>
      <div class="rec-card-summary">${escapeHtml(dataSummary)}</div>
      ${auxLabel ? `<div class="rec-card-aux">+ ${escapeHtml(auxLabel)}</div>` : ''}
      ${recordLabel ? `<div class="rec-card-tune">${escapeHtml(recordLabel)}</div>` : ''}
      <div class="rec-card-headroom">peak ${(p.worstSat*100).toFixed(0)}% saturation</div>
      <div class="rec-card-buttons">
        <button class="btn btn-accent btn-sm rec-card-load">Load into composer</button>
        <button class="btn btn-outline btn-sm rec-card-save" title="Save to compare side-by-side">Save</button>
      </div>
    </div>
  `;
}

function loadIntoComposer(pick) {
  state.spec = JSON.parse(JSON.stringify(pick.spec));
  state.activeSavedId = null;
  saveState();
  rerender();
  document.getElementById('composer')?.scrollIntoView({ behavior:'smooth', block:'start' });
}

function saveAsPool(pick, rank) {
  const workload = WORKLOAD_BY_ID[state.workloadId];
  const name = `Pick #${rank} for ${workload.label}`;
  const id = 'rec-' + Date.now() + '-' + rank;
  state.savedPools.push({ id, name, spec: JSON.parse(JSON.stringify(pick.spec)) });
  saveState();
  rerender();
}

function saveAllAsPools() {
  const workload = WORKLOAD_BY_ID[state.workloadId];
  uiState.results.forEach((pick, i) => {
    const id = 'rec-' + Date.now() + '-' + (i+1);
    const name = `Pick #${i+1} for ${workload.label}`;
    state.savedPools.push({ id, name, spec: JSON.parse(JSON.stringify(pick.spec)) });
  });
  saveState();
  rerender();
  document.getElementById('comparePanel')?.scrollIntoView({ behavior:'smooth', block:'start' });
}
