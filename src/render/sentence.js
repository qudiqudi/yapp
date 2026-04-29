// ─────────── COMPOSER RENDER ───────────
import { LAYOUTS, PRESETS, ROLES, ROLE_BY_ID } from '../data/layouts.js';
import { TIERS } from '../data/tiers.js';
import { PRODUCTS, productFor, sizeRowFor, effectiveCost } from '../data/products.js';
import { ICON } from '../icons.js';
import { state, updateGroup, updateAuxGroup } from '../state.js';
import { rerender } from '../bus.js';
import { currentSymbol } from '../format.js';
import { currentRegion } from '../pricing/state.js';
import { SOURCE_BY_ID } from '../pricing/sources.js';
import { setActivePopover, closeActivePopover } from '../popover.js';

const sentenceEl = document.getElementById('sentence');

// A "ctx" wraps the group-array reference plus its role id and index, so all
// chip helpers can mutate the right slot whether it lives in spec.groups or
// any of the aux arrays (spec.special, spec.cache, ...).
function dataCtx(gi) { return { arr: state.spec.groups, role: 'data', gi }; }
function auxCtx(role, gi) { return { arr: state.spec[role], role, gi }; }

function applyUpdate(ctx, key, value) {
  if (ctx.role === 'data') updateGroup(ctx.gi, key, value);
  else updateAuxGroup(ctx.role, ctx.gi, key, value);
}

function span(txt, cls) {
  const s = document.createElement('span');
  s.className = cls || '';
  s.textContent = txt;
  return s;
}

// Make a focused chip activatable via Enter/Space (matches the chip's onclick handler).
function bindKeyActivate(el) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  });
}

// numeric token - inline editable
function numTok(value, min, max, onChange, prefix, suffix) {
  const el = document.createElement('span');
  el.className = 'tok';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  bindKeyActivate(el);
  const render = () => {
    el.innerHTML = '';
    if (prefix) el.appendChild(span(prefix));
    el.appendChild(document.createTextNode(value));
    if (suffix) el.appendChild(span(suffix));
  };
  render();
  el.onclick = (e) => {
    e.stopPropagation();
    if (el.classList.contains('editing-num')) return;
    el.classList.add('editing-num');
    el.innerHTML = '';
    if (prefix) el.appendChild(span(prefix));
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.className = 'tok-num-input';
    inp.value = value;
    inp.min = min; inp.max = max;
    el.appendChild(inp);
    if (suffix) el.appendChild(span(suffix));
    inp.focus();
    inp.select();
    const commit = () => {
      let v = parseFloat(inp.value);
      if (isNaN(v)) v = value;
      v = Math.max(min, Math.min(max, v));
      el.classList.remove('editing-num');
      onChange(v);
    };
    inp.onblur = commit;
    inp.onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
      if (ev.key === 'Escape') { inp.value = value; inp.blur(); }
    };
  };
  return el;
}

// dropdown token
function selectTok(options, current, onChange, labelFn, metaFn) {
  const el = document.createElement('span');
  el.className = 'tok';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-haspopup', 'listbox');
  el.setAttribute('aria-expanded', 'false');
  bindKeyActivate(el);
  const opt = options.find(o => o.value === current) || options[0];
  el.textContent = labelFn(opt);
  el.onclick = (e) => {
    e.stopPropagation();
    closeActivePopover();
    const pop = document.createElement('div');
    pop.className = 'popover';
    options.forEach(o => {
      const item = document.createElement('div');
      item.className = 'popover-item' + (o.value === current ? ' selected' : '');
      const meta = metaFn(o);
      item.innerHTML = `<span class="popover-name">${labelFn(o)}</span>${meta ? `<span class="popover-meta">${meta}</span>` : ''}`;
      item.onclick = (ev) => { ev.stopPropagation(); onChange(o.value); closeActivePopover(); };
      pop.appendChild(item);
    });
    document.body.appendChild(pop);
    const r = el.getBoundingClientRect();
    pop.style.left = Math.max(8, r.left) + 'px';
    pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
    setActivePopover(pop, el);
  };
  return el;
}

// product picker token — wide popover, grouped by tier (one row per model)
function productTok(g, ctx) {
  const el = document.createElement('span');
  el.className = 'tok tok-product';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-haspopup', 'listbox');
  el.setAttribute('aria-expanded', 'false');
  bindKeyActivate(el);
  const p = productFor(g);
  if (p) {
    el.innerHTML = `<span class="tok-product-brand">${p.brand}</span> <span class="tok-product-model">${p.model}</span>`;
  } else {
    el.innerHTML = `<span class="tok-product-custom">Custom ${g.size} TB ${g.type.toUpperCase()}</span>`;
  }

  el.onclick = (e) => {
    e.stopPropagation();
    closeActivePopover();
    const pop = document.createElement('div');
    pop.className = 'popover popover-products';

    // "Custom" option first
    const customRow = document.createElement('div');
    customRow.className = 'popover-item popover-product-custom' + (!g.product ? ' selected' : '');
    customRow.innerHTML = `
      <div class="pp-name">Custom drive</div>
      <div class="pp-meta">use type-defaults — set capacity & price/TB by hand</div>
    `;
    customRow.onclick = (ev) => {
      ev.stopPropagation();
      applyUpdate(ctx, 'product', null);
      closeActivePopover();
    };
    pop.appendChild(customRow);

    TIERS.forEach(tier => {
      const items = PRODUCTS.filter(p => p.tier === tier.id);
      if (!items.length) return;
      const hdr = document.createElement('div');
      hdr.className = 'popover-section';
      hdr.innerHTML = `<span class="pp-section-label">${tier.label}</span><span class="pp-section-sub">${tier.sub}</span>`;
      pop.appendChild(hdr);
      items.forEach(prod => {
        const row = document.createElement('div');
        row.className = 'popover-item popover-product' + (g.product === prod.id ? ' selected' : '');
        const afr = (8760 / prod.mtbf * 100).toFixed(2);
        const iopsLabel = prod.readIOPS >= 100000 ? `${(prod.readIOPS/1000).toFixed(0)}k IOPS` : `${prod.readIOPS} IOPS`;
        const sizeRange = prod.sizes.length === 1
          ? `${prod.sizes[0].tb} TB`
          : `${prod.sizes[0].tb}–${prod.sizes[prod.sizes.length-1].tb} TB`;
        // Cheapest live $/TB across this product's sizes (if any)
        const liveQuotes = prod.sizes.map(s => s.livePrice?.cost).filter(c => typeof c === 'number');
        const cheapestLive = liveQuotes.length ? Math.min(...liveQuotes) : null;
        const cheapestSpec = Math.min(...prod.sizes.map(s => s.cost));
        const sym = currentSymbol();
        const priceTxt = cheapestLive !== null
          ? `from ${sym}${cheapestLive.toFixed(0)}/TB · live`
          : `from ${sym}${cheapestSpec}/TB · est.${prod.dcOnly ? ' · enterprise channel' : ''}`;
        row.innerHTML = `
          <div class="pp-main">
            <div class="pp-name"><span class="pp-brand">${prod.brand}</span> ${prod.model}</div>
            <div class="pp-spec">${sizeRange} · ${priceTxt} · ${(prod.mtbf/1e6).toFixed(1)} M h MTBF · ${afr}% AFR · ${iopsLabel}</div>
          </div>
          <div class="pp-cite">[${prod.ref}]</div>
        `;
        row.onclick = (ev) => {
          ev.stopPropagation();
          // Pick the size closest to the group's current size; else use the largest available.
          const target = g.size;
          const bestSize = prod.sizes
            .map(s => ({ s, d: Math.abs(s.tb - target) }))
            .sort((a,b) => a.d - b.d)[0].s;
          const grp = ctx.arr[ctx.gi];
          grp.product = prod.id;
          grp.type = prod.type;
          grp.size = bestSize.tb;
          grp.cost = bestSize.cost;
          rerender();
          closeActivePopover();
        };
        pop.appendChild(row);
      });
    });

    document.body.appendChild(pop);
    const r = el.getBoundingClientRect();
    const popW = 460;
    let left = r.left;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
    setActivePopover(pop, el);
  };
  return el;
}

// Capacity dropdown — appears after a product is picked, lets user choose between available sizes.
function capacityTok(g, ctx) {
  const p = productFor(g);
  const el = document.createElement('span');
  el.className = 'tok tok-product tok-capacity';
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-haspopup', 'listbox');
  el.setAttribute('aria-expanded', 'false');
  bindKeyActivate(el);
  el.innerHTML = `<span class="tok-product-cap">${g.size} TB</span>`;
  if (!p) return el;

  el.onclick = (e) => {
    e.stopPropagation();
    closeActivePopover();
    const pop = document.createElement('div');
    pop.className = 'popover popover-capacity';
    p.sizes.forEach(s => {
      const row = document.createElement('div');
      row.className = 'popover-item popover-capacity-item' + (Math.abs(s.tb - g.size) < 0.01 ? ' selected' : '');
      const live = s.livePrice;
      const sym = currentSymbol();
      let priceLabel;
      if (live && live.derived) {
        priceLabel = `<span class="cap-derived" title="${live.derivedBasis || ''}">${sym}${live.cost.toFixed(0)}/TB · est.</span>`;
      } else if (live) {
        priceLabel = `<span class="cap-live">${sym}${live.cost.toFixed(0)}/TB · live${live.condition && live.condition !== 'new' ? ' · ' + live.condition : ''}</span>`;
      } else {
        priceLabel = `<span class="cap-est">${sym}${s.cost}/TB · est.${p.dcOnly ? ' · enterprise channel' : ''}</span>`;
      }
      row.innerHTML = `<div class="cap-tb">${s.tb} TB</div>${priceLabel}`;
      row.onclick = (ev) => {
        ev.stopPropagation();
        const grp = ctx.arr[ctx.gi];
        grp.size = s.tb;
        grp.cost = s.cost;
        rerender();
        closeActivePopover();
      };
      pop.appendChild(row);
    });
    document.body.appendChild(pop);
    const r = el.getBoundingClientRect();
    const popW = 220;
    let left = r.left;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
    setActivePopover(pop, el);
  };
  return el;
}

// Read-only $/TB chip (when a product is selected — price comes from catalog or live feed).
// The chip carries a `data-tip` attribute; the styled hover tooltip is pure CSS (see styles.css).
function livePriceTok(g) {
  const sr = sizeRowFor(g);
  const el = document.createElement('span');
  el.className = 'tok tok-num tok-price-readonly';
  el.tabIndex = 0;
  const sym = currentSymbol();
  if (sr && sr.livePrice) {
    const cur = currentRegion();
    const live = sr.livePrice;
    if (live.derived) {
      el.classList.add('tok-price-derived');
      el.innerHTML = `<span class="tok-prefix">${sym}</span><span class="tok-num-val">${live.cost.toFixed(0)}</span><span class="tok-suffix">/TB · est.</span>`;
      // Strip the parenthesised currency hints from the basis ("10 TB (€37) and 14 TB (€35)" → "10 TB and 14 TB")
      const basis = (live.derivedBasis || '').replace(/\s*\([^)]*\)/g, '');
      el.dataset.tip = basis ? `interpolated from ${basis.replace(/^interpolated\s+(?:between|from)\s+/, '').replace(/^extrapolated\s+from\s+/, '')}` : 'interpolated from neighbours';
    } else {
      el.classList.add('tok-price-live');
      el.innerHTML = `<span class="tok-prefix">${sym}</span><span class="tok-num-val">${live.cost.toFixed(0)}</span><span class="tok-suffix">/TB · live</span>`;
      const srcLabel = SOURCE_BY_ID[live.source]?.label || 'live source';
      el.dataset.tip = `from ${srcLabel} · ${cur?.label || ''} ${live.condition || 'new'}`;
    }
  } else {
    el.innerHTML = `<span class="tok-prefix">${sym}</span><span class="tok-num-val">${effectiveCost(g)}</span><span class="tok-suffix">/TB · est.</span>`;
    const cur = currentRegion();
    el.dataset.tip = cur
      ? `no live listing in ${cur.label} · USD baseline shown with ${cur.symbol}`
      : `USD estimate · pick a region for live prices`;
  }
  return el;
}

// Render one editable group sentence — used for both data and aux roles.
// opts:
//   prefix       — lead-in phrase ("A pool of ", "plus ", "plus a special vdev: ", ...)
//   showCount    — show the count chip (default true; false for cache/spares which are always 1)
//   showLayout   — show the layout chip (default true; false for cache/spares which are always stripe)
//   layoutOptions — restricted layout list for this role (default: LAYOUTS)
function renderGroupSentence(g, ctx, opts) {
  const wrap = document.createElement('div');
  wrap.className = 'vdev-group';
  if (ctx.role !== 'data') wrap.classList.add('vdev-group-aux');
  wrap.dataset.role = ctx.role;
  wrap.dataset.gi = ctx.gi;

  const sym = currentSymbol();
  const layoutOpts = opts.layoutOptions || LAYOUTS;
  const showCount  = opts.showCount  !== false;
  const showLayout = opts.showLayout !== false;

  if (opts.prefix) wrap.appendChild(span(opts.prefix, 'static'));

  if (showCount) {
    wrap.appendChild(numTok(g.count, 1, 64, v => applyUpdate(ctx, 'count', v)));
    wrap.appendChild(span(' ', 'static'));
  }

  if (showLayout) {
    wrap.appendChild(selectTok(layoutOpts, g.layout, v => applyUpdate(ctx, 'layout', v),
      l => `${l.label}`, l => `min ${l.min} disks · ${l.desc}`));
    wrap.appendChild(span(g.count > 1 ? ' vdevs, each with ' : ' vdev with ', 'static'));
  }

  // disks per vdev (no preamble when both count & layout chips are hidden — we go straight to "N × <product>")
  wrap.appendChild(numTok(g.disks, 1, 32, v => applyUpdate(ctx, 'disks', v)));
  wrap.appendChild(span(' × ', 'static'));

  // product / capacity / price chips
  wrap.appendChild(productTok(g, ctx));
  if (productFor(g)) {
    wrap.appendChild(span(' ', 'static'));
    wrap.appendChild(capacityTok(g, ctx));
  }
  wrap.appendChild(span(' at ', 'static'));
  if (productFor(g)) {
    wrap.appendChild(livePriceTok(g));
  } else {
    wrap.appendChild(numTok(g.cost, 0, 9999, v => applyUpdate(ctx, 'cost', v), sym, '/TB'));
  }
  wrap.appendChild(span('.', 'static'));

  // remove action — every aux group is removable; data groups only when more than one exists
  const canRemove = (ctx.role === 'data') ? (state.spec.groups.length > 1) : true;
  if (canRemove) {
    const acts = document.createElement('div');
    acts.className = 'group-actions';
    const rm = document.createElement('button');
    rm.className = 'group-action-btn';
    rm.title = 'Remove this vdev group';
    rm.innerHTML = ICON.trash;
    rm.onclick = () => {
      if (ctx.role === 'data') state.spec.groups.splice(ctx.gi, 1);
      else state.spec[ctx.role].splice(ctx.gi, 1);
      rerender();
    };
    acts.appendChild(rm);
    wrap.appendChild(acts);
  }
  return wrap;
}

export function renderSentence() {
  sentenceEl.innerHTML = '';

  // ── DATA VDEV SENTENCES ──
  state.spec.groups.forEach((g, gi) => {
    const prefix = (gi === 0) ? 'A pool of ' : 'plus ';
    sentenceEl.appendChild(renderGroupSentence(g, dataCtx(gi), { prefix }));
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'add-group-btn';
  addBtn.innerHTML = `${ICON.plus} Add a different vdev group`;
  addBtn.onclick = () => {
    state.spec.groups.push({ count:1, layout:'raidz2', disks:6, size:16, type:'hdd', cost:20, product:'seagate-ironwolf-pro' });
    rerender();
  };
  sentenceEl.appendChild(addBtn);

  // ── AUX VDEV SENTENCES (TrueNAS-style: special / dedup / log / cache / spares) ──
  // Per-role composer wording. Cache and spares hide both count + layout chips because in
  // ZFS they're always single-vdev stripes — what the user actually picks is the drive count.
  const ROLE_COMPOSER = {
    special: { prefix: 'plus a special vdev: ',  showCount: true,  showLayout: true  },
    dedup:   { prefix: 'plus a dedup vdev: ',    showCount: true,  showLayout: true  },
    log:     { prefix: 'plus an SLOG: ',         showCount: true,  showLayout: true  },
    cache:   { prefix: 'plus an L2ARC: ',        showCount: false, showLayout: false },
    spares:  { prefix: 'plus hot spares: ',      showCount: false, showLayout: false },
  };
  ROLES.forEach(roleDef => {
    const groups = state.spec[roleDef.id] || [];
    const cfg = ROLE_COMPOSER[roleDef.id];
    groups.forEach((g, gi) => {
      const ctx = auxCtx(roleDef.id, gi);
      const allowedLayouts = LAYOUTS.filter(l => roleDef.layouts.includes(l.value));
      sentenceEl.appendChild(renderGroupSentence(g, ctx, {
        prefix: gi === 0 ? cfg.prefix : `plus another ${roleDef.short}: `,
        showCount: cfg.showCount,
        showLayout: cfg.showLayout,
        layoutOptions: allowedLayouts,
      }));
    });
  });

  // Action row: one + button per aux role
  const auxAdd = document.createElement('div');
  auxAdd.className = 'aux-add-row';
  ROLES.forEach(roleDef => {
    const btn = document.createElement('button');
    btn.className = 'aux-add-btn';
    btn.innerHTML = `${ICON.plus} Add ${roleDef.label}`;
    btn.title = roleDef.desc;
    btn.onclick = () => {
      if (!Array.isArray(state.spec[roleDef.id])) state.spec[roleDef.id] = [];
      state.spec[roleDef.id].push({ ...roleDef.defaultGroup });
      rerender();
    };
    auxAdd.appendChild(btn);
  });
  sentenceEl.appendChild(auxAdd);

  // ── DATASET TUNABLES ──
  // Per-pool recordsize and planned fill % drive the load sim's write-amp and CoW
  // penalty math. A separate sentence keeps it visually distinct from vdev composition.
  const tune = document.createElement('div');
  tune.className = 'vdev-group vdev-group-tune';
  tune.appendChild(span('Tuned for ', 'static'));
  const RECORDSIZE_OPTIONS = [
    { value: 4,    label: '4 K'   },
    { value: 8,    label: '8 K'   },
    { value: 16,   label: '16 K'  },
    { value: 32,   label: '32 K'  },
    { value: 64,   label: '64 K'  },
    { value: 128,  label: '128 K (default)' },
    { value: 256,  label: '256 K' },
    { value: 512,  label: '512 K' },
    { value: 1024, label: '1 M'   },
  ];
  tune.appendChild(selectTok(
    RECORDSIZE_OPTIONS,
    state.spec.recordsizeKB ?? 128,
    v => { state.spec.recordsizeKB = v; rerender(); },
    o => o.label,
    o => o.value === 128 ? 'ZFS default — good for mixed' : (o.value <= 16 ? 'OLTP / VM workloads' : 'sequential / media'),
  ));
  tune.appendChild(span(' records, planned at ', 'static'));
  tune.appendChild(numTok(state.spec.fillPct ?? 50, 0, 100, v => { state.spec.fillPct = v; rerender(); }, '', '%'));
  tune.appendChild(span(' fill.', 'static'));
  sentenceEl.appendChild(tune);
}

// ─────────── PRESETS RENDER ───────────
const presetsRow = document.getElementById('presetsRow');

function presetMatchesSpec(preset, sp) {
  if (preset.groups.length !== sp.groups.length) return false;
  // Presets are data-only — if any aux vdev is configured, the preset doesn't match.
  const auxActive = ROLES.some(r => (sp[r.id] || []).length > 0);
  if (auxActive) return false;
  return preset.groups.every((pg, i) => {
    const sg = sp.groups[i];
    return pg.count === sg.count && pg.layout === sg.layout && pg.disks === sg.disks
      && pg.size === sg.size && pg.type === sg.type;
  });
}

export function renderPresets() {
  presetsRow.innerHTML = '';
  PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.className = 'preset-btn';
    if (presetMatchesSpec(p, state.spec)) b.classList.add('active');
    b.innerHTML = `${p.label}`;
    b.onclick = () => {
      state.spec = {
        groups: p.groups.map(g => ({ ...g })),
        special: [], dedup: [], log: [], cache: [], spares: [],
        recordsizeKB: 128,
        fillPct: 50,
      };
      state.activeSavedId = null;
      rerender();
    };
    presetsRow.appendChild(b);
  });
}
