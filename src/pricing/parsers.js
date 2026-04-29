// ─────────── PRICING — PARSERS ───────────
import { parseNumber, escapeRegex } from '../format.js';

// Extract price-per-TB rows from a Jina-Reader markdown dump of diskprices.com.
// Returns array of { name, capacityTB, pricePerTB, totalPrice, condition, raw }.
export function parseDiskpricesMarkdown(md, region) {
  const rows = [];
  if (!md) return rows;
  const lines = md.split('\n');
  // Pattern for "X.XX/TB" or "X,XX/TB" optionally preceded by currency symbol.
  // Diskprices typically renders like:  "$ 23.41/TB"  or "€ 23,41 / TB"
  const perTBRe = /([0-9][0-9., \s]{0,12})\s*\/\s*TB/i;
  // Capacity pattern — matches "16 TB", "1.92 TB", "1,92TB", "480 GB", etc.
  const capRe = /(\d+[., \d\s]*)\s*(TB|GB)\b/i;
  // Total price — first currency-prefixed amount on the line that ISN'T followed by /TB.
  // We'll grab any number starting with the region's symbol (or generic currency chars).
  for (const line of lines) {
    if (!perTBRe.test(line)) continue;
    const perTBMatch = line.match(perTBRe);
    if (!perTBMatch) continue;
    const pricePerTB = parseNumber(perTBMatch[1], region);
    if (!isFinite(pricePerTB) || pricePerTB <= 0 || pricePerTB > 5000) continue;

    // Capacity — prefer match BEFORE the per-TB token so "23.41/TB" doesn't match as "23.41 TB"
    const beforePerTB = line.slice(0, line.indexOf(perTBMatch[0]));
    const capMatch = beforePerTB.match(capRe) || line.match(capRe);
    let capacityTB = NaN;
    if (capMatch) {
      const num = parseNumber(capMatch[1], region);
      capacityTB = capMatch[2].toUpperCase() === 'GB' ? num / 1000 : num;
    }
    if (!isFinite(capacityTB)) continue;

    // Strip markdown link syntax / images so the name is searchable
    const name = line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[|*_`>#-]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();

    rows.push({ name, capacityTB, pricePerTB, raw: line });
  }
  return rows;
}

// Generic listing parser: scans for currency-prefixed totals, walks back ~600 chars to find a
// nearby capacity token, and computes pricePerTB = total / capacity. Used by retailer pages
// where $/TB isn't pre-computed (Mindfactory, Alternate, Geizhals fallback path).
export function parseListingMarkdown(md, region, opts = {}) {
  const rows = [];
  if (!md) return rows;
  const sym = region.symbol;
  const symRe = escapeRegex(sym);
  // Match totals like "189,90 €", "€ 189.90", "189.90 EUR", "EUR 189,90"
  const totalRe = new RegExp(
    `(?:${symRe}|${region.currency})\\s*([0-9][0-9.,\\s\\u00A0]{1,12})`
    + `|([0-9][0-9.,\\s\\u00A0]{1,12})\\s*(?:${symRe}|${region.currency})`,
    'gi'
  );
  const capInlineRe = /(\d+[.,]?\d*)\s*(TB|GB)\b/gi;
  const minTotal = opts.minTotal ?? 20;
  const maxTotal = opts.maxTotal ?? 12000;

  let m;
  while ((m = totalRe.exec(md)) !== null) {
    const priceStr = m[1] || m[2];
    if (!priceStr) continue;
    const total = parseNumber(priceStr, region);
    if (!isFinite(total) || total < minTotal || total > maxTotal) continue;

    // Skip per-TB tokens (these are diskprices-style — handled by the dedicated parser)
    const tail = md.slice(m.index + m[0].length, m.index + m[0].length + 6);
    if (/\s*\/\s*TB/i.test(tail)) continue;

    // Look ~800 chars before and a bit after the price — brand+model+capacity can sit
    // on either side (Mindfactory uses "[NTB] Brand Model"; Amazon uses "Brand Model NTB").
    const ctxStart = Math.max(0, m.index - 800);
    const ctxEnd   = Math.min(md.length, m.index + 80);
    const ctx = md.slice(ctxStart, ctxEnd);
    const capMatches = [...ctx.matchAll(capInlineRe)];
    if (!capMatches.length) continue;
    const priceIdxInCtx = m.index - ctxStart;
    const capM = capMatches.reduce((a,b) =>
      Math.abs(a.index - priceIdxInCtx) < Math.abs(b.index - priceIdxInCtx) ? a : b
    );
    const capNum = parseNumber(capM[1], region);
    let capTB = capM[2].toUpperCase() === 'GB' ? capNum / 1000 : capNum;
    if (!isFinite(capTB) || capTB < 0.1 || capTB > 100) continue;

    // Name: full window — brand/model match anywhere in this slice still classifies the row.
    const name = ctx
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[|*_`>#\n-]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
    if (name.length < 4) continue;

    rows.push({
      name: (name + ' ' + capM[0]).trim(),
      capacityTB: capTB,
      pricePerTB: total / capTB,
      raw: ctx.slice(-160) + ' [' + m[0] + ']',
    });
  }
  // Dedupe near-identical rows (same name+capacity, keep cheapest)
  const dedup = new Map();
  for (const r of rows) {
    const k = `${r.name}::${r.capacityTB.toFixed(2)}`;
    if (!dedup.has(k) || dedup.get(k).pricePerTB > r.pricePerTB) dedup.set(k, r);
  }
  return [...dedup.values()];
}

// Diskprices.com renders a real HTML <table>. Columns we use:
//   [1] Price per TB (e.g. "€5,410")
//   [3] Capacity     (e.g. "18 TB" or "12 TB x20" — multi-packs skipped)
//   [7] Condition    ("New" / "Used")
//   [8] Affiliate Link (text contains the product name)
export function parseDiskpricesHTML(text, region) {
  if (!text || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const rows = [];
  for (const tr of doc.querySelectorAll('table tr')) {
    const cells = tr.children;
    if (cells.length < 9) continue;
    if (cells[0].tagName === 'TH') continue;
    const pricePerTBRaw = cells[1].textContent.trim();
    const capacityRaw   = cells[3].textContent.trim();
    const productName   = cells[8].textContent.trim();
    const pricePerTB = parseNumber(pricePerTBRaw, region);
    if (!isFinite(pricePerTB) || pricePerTB <= 0 || pricePerTB > 5000) continue;
    if (/x\s*\d+/i.test(capacityRaw)) continue; // skip multi-packs like "12 TB x20"
    const capMatch = capacityRaw.match(/^([\d.,]+)\s*(TB|GB)/i);
    if (!capMatch) continue;
    const num = parseNumber(capMatch[1], region);
    const capTB = capMatch[2].toUpperCase() === 'GB' ? num / 1000 : num;
    if (!isFinite(capTB) || capTB < 0.1 || capTB > 100) continue;
    rows.push({
      name: productName.toLowerCase(),
      capacityTB: capTB,
      pricePerTB,
      raw: productName,
    });
  }
  return rows;
}

// Strip HTML tags + decode entities via DOMParser, then run the listing parser on
// rendered text. Retailer pages (Mindfactory, Alternate) use HTML entities like
// `&euro;` for the currency symbol — the regex parser misses those if it sees raw HTML.
export function parseHTMLAsListing(text, region) {
  if (typeof DOMParser === 'undefined') return parseListingMarkdown(text, region);
  const doc = new DOMParser().parseFromString(text, 'text/html');
  doc.querySelectorAll('script, style, noscript, header, footer, nav').forEach(el => el.remove());
  const rendered = doc.body?.textContent || text;
  return parseListingMarkdown(rendered, region);
}

export const parseMindfactoryMarkdown = parseHTMLAsListing;
export const parseAlternateMarkdown   = parseHTMLAsListing;

// Geizhals: try the markdown $/TB parser first, fall back to HTML-rendered listing parser.
export function parseGeizhalsMarkdown(text, region) {
  const direct = parseDiskpricesMarkdown(text, region);
  if (direct.length >= 8) return direct;
  return parseHTMLAsListing(text, region);
}
