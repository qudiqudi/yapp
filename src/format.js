// ─────────── FORMATTERS ───────────
import { currentRegion } from './pricing/state.js';

export const fmtCap = v => v >= 1024 ? `${(v/1024).toFixed(1)} PB` : `${v.toFixed(1)} TB`;
export const fmtT   = v => v >= 1024 ? `${(v/1024).toFixed(1)} GiB/s` : `${v.toFixed(0)} MiB/s`;
export const fmtDur = h => h >= 8760 ? `${(h/8760).toFixed(1)} y` : h >= 24 ? `${(h/24).toFixed(0)} d` : `${h.toFixed(0)} h`;

export function currentSymbol() {
  return currentRegion()?.symbol || '$';
}
export const fmtMoney = v => `${currentSymbol()}${Math.round(v).toLocaleString()}`;

export function safetyGrade(score) {
  if (score >= 85) return { grade: 'A', label: 'Very safe', colorClass: 'text-success' };
  if (score >= 70) return { grade: 'B', label: 'Safe',      colorClass: 'text-success' };
  if (score >= 50) return { grade: 'C', label: 'Adequate',  colorClass: 'text-warn' };
  if (score >= 30) return { grade: 'D', label: 'Risky',     colorClass: 'text-warn' };
  return { grade: 'F', label: 'Dangerous',                  colorClass: 'text-danger' };
}

// Parse a single number string honoring the region's decimal/thousand separators.
export function parseNumber(str, region) {
  if (!str) return NaN;
  // Remove non-numeric except separators
  let s = str.trim();
  if (region) {
    // Remove thousand sep, then convert decimal sep to '.'
    const T = region.thousand, D = region.decimal;
    s = s.split(T).join('').split(D).join('.');
  }
  const negative = /^-/.test(s);
  s = s.replace(/[^\d.]/g, '');
  if (negative) s = '-' + s;
  return parseFloat(s);
}

export function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
