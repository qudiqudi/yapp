// ─────────── SAVED POOLS RENDER ───────────
import { ICON } from '../icons.js';
import { ROLES } from '../data/layouts.js';
import { state, saveState } from '../state.js';
import { rerender } from '../bus.js';
import { computePoolStats } from '../math/pool.js';
import { fmtCap, fmtMoney, currentSymbol } from '../format.js';
import { renderCompare } from './compare.js';

const savedRow = document.getElementById('savedRow');

export function renderSaved() {
  savedRow.innerHTML = '';
  const sym = currentSymbol();
  document.getElementById('savedCount').textContent = state.savedPools.length === 0 ? '' : `${state.savedPools.length} saved`;

  if (state.savedPools.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'saved-empty-card';
    empty.innerHTML = `<div>Save your first pool —<br>stack 'em side-by-side to compare.</div>`;
    savedRow.appendChild(empty);
    return;
  }

  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  state.savedPools.forEach(p => {
    const stats = computePoolStats(p.spec);
    const card = document.createElement('div');
    card.className = 'saved-card';
    if (p.id === state.activeSavedId) card.classList.add('active');

    const dataPart = p.spec.groups.map(g => `${g.count}× ${g.layout} (${g.disks}× ${g.size}TB ${g.type.toUpperCase()})`).join(' + ');
    const auxParts = ROLES
      .map(r => {
        const groups = p.spec[r.id] || [];
        if (!groups.length) return null;
        const drives = groups.reduce((n, g) => n + (g.count * g.disks), 0);
        return `${r.short} ${drives}-drv`;
      })
      .filter(Boolean);
    const summary = auxParts.length ? `${dataPart} + ${auxParts.join(' + ')}` : dataPart;

    card.innerHTML = `
      <div class="saved-name"><input type="text" value="${esc(p.name)}" data-id="${p.id}" /></div>
      <div class="saved-summary">${summary}</div>
      <div class="saved-stats">
        <div class="saved-stat"><span class="saved-stat-label">Usable</span><strong>${fmtCap(stats.totalUsable)}</strong></div>
        <div class="saved-stat"><span class="saved-stat-label">${sym}/TB</span><strong>${fmtMoney(stats.costPerTB)}</strong></div>
        <div class="saved-stat"><span class="saved-stat-label">R IOPS</span><strong>${stats.readIOPS.toLocaleString()}</strong></div>
        <div class="saved-stat"><span class="saved-stat-label">W IOPS</span><strong>${stats.writeIOPS.toLocaleString()}</strong></div>
      </div>
      <div class="saved-actions">
        <button class="saved-icon-btn" data-action="load" title="Load into composer">${ICON.load}</button>
        <button class="saved-icon-btn danger" data-action="delete" title="Delete">${ICON.trash}</button>
      </div>
    `;
    card.onclick = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'load') {
        state.spec = JSON.parse(JSON.stringify(p.spec));
        state.activeSavedId = p.id;
        rerender();
      } else if (action === 'delete') {
        state.savedPools = state.savedPools.filter(x => x.id !== p.id);
        if (state.activeSavedId === p.id) state.activeSavedId = null;
        rerender();
      } else {
        // tap card = load it
        state.spec = JSON.parse(JSON.stringify(p.spec));
        state.activeSavedId = p.id;
        rerender();
      }
    };
    const inp = card.querySelector('input');
    inp.onclick = e => e.stopPropagation();
    inp.onchange = () => {
      const target = state.savedPools.find(s => s.id === p.id);
      if (target) target.name = inp.value || target.name;
      saveState();
      renderCompare();
    };
    savedRow.appendChild(card);
  });
}
