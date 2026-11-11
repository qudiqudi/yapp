// ─────────── POPOVER ───────────
// Tracks the single currently-open popover and dismisses it on outside-click or Esc.
// Also wires keyboard navigation (ArrowUp/ArrowDown, Enter/Space, Tab focus trap)
// across `.popover-item` children so popovers are usable without a mouse.
let _activePopover = null;
let _activeTrigger = null;

export function setActivePopover(el, trigger = null) {
  _activePopover = el;
  _activeTrigger = trigger;
  if (el) {
    // Mark as listbox for assistive tech and bind keyboard nav after the
    // caller finishes appending items (next microtask).
    el.setAttribute('role', 'listbox');
    queueMicrotask(() => initPopoverKeyboard(el));
  }
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
}

export function closeActivePopover() {
  if (_activePopover) {
    _activePopover.remove();
    _activePopover = null;
  }
  if (_activeTrigger) {
    _activeTrigger.setAttribute('aria-expanded', 'false');
    // return focus to the trigger that opened the popover
    try { _activeTrigger.focus(); } catch (_) { /* trigger may be gone after rerender */ }
    _activeTrigger = null;
  }
}

// Outside-click + global Esc handler — call from main.js bootstrap to register once.
export function installPopoverDismissHandler() {
  document.addEventListener('click', () => {
    closeActivePopover();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _activePopover) {
      e.preventDefault();
      closeActivePopover();
    }
  });
}

// Set up role/option attributes and arrow-key navigation on a freshly-opened popover.
function initPopoverKeyboard(pop) {
  const items = Array.from(pop.querySelectorAll('.popover-item'));
  if (!items.length) return;

  items.forEach(it => {
    it.setAttribute('role', 'option');
    it.setAttribute('tabindex', '-1');
    it.setAttribute('aria-selected', it.classList.contains('selected') ? 'true' : 'false');
  });

  // focus the selected item, else the first
  const start = items.findIndex(it => it.classList.contains('selected'));
  const initial = start >= 0 ? items[start] : items[0];
  try { initial.focus(); } catch (_) {}

  pop.addEventListener('keydown', (e) => {
    const cur = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = cur < 0 ? 0 : (cur + 1) % items.length;
      items[next].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = cur < 0 ? items.length - 1 : (cur - 1 + items.length) % items.length;
      items[prev].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (cur >= 0) {
        e.preventDefault();
        items[cur].click();
      }
    } else if (e.key === 'Tab') {
      // Lightweight focus trap — cycle within items, never escape the popover.
      e.preventDefault();
      if (e.shiftKey) {
        const prev = cur <= 0 ? items.length - 1 : cur - 1;
        items[prev].focus();
      } else {
        const next = cur < 0 ? 0 : (cur + 1) % items.length;
        items[next].focus();
      }
    }
  });
}
