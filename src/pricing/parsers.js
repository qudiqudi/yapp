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
// where $/TB isn't pre-computed (Alternate, Galaxus HTML fallback path).
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
    // on either side (some retailers use "[NTB] Brand Model"; Amazon uses "Brand Model NTB").
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
//
// The page ships every condition in one table and hides rows with JS, so the
// ?condition= query does not filter the response. We filter on the Condition cell.
export function parseDiskpricesHTML(text, region, condition) {
  if (!text || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const rows = [];
  for (const tr of doc.querySelectorAll('table tr')) {
    const cells = tr.children;
    if (cells.length < 9) continue;
    if (cells[0].tagName === 'TH') continue;
    const row = diskpricesRow(
      cells[1].textContent, cells[3].textContent, cells[7].textContent, cells[8].textContent,
      region, condition
    );
    if (row) rows.push(row);
  }
  return rows;
}

// r.jina.ai returns the same table as plain text, one row per line, tab-separated,
// without the hidden per-GB column:
//   Price per TB \t Price \t Capacity \t Warranty \t Form Factor \t Technology \t Condition \t Name
export function parseDiskpricesText(text, region, condition) {
  const rows = [];
  if (!text) return rows;
  for (const line of text.split('\n')) {
    const cells = line.split('\t');
    if (cells.length < 8) continue;
    const row = diskpricesRow(cells[0], cells[2], cells[6], cells.slice(7).join(' '), region, condition);
    if (row) rows.push(row);
  }
  return rows;
}

// Dispatch on the response shape: raw HTML from a pass-through proxy, text from Jina.
export function parseDiskprices(text, region, condition) {
  if (!text) return [];
  return /<table[\s>]/i.test(text)
    ? parseDiskpricesHTML(text, region, condition)
    : parseDiskpricesText(text, region, condition);
}

function diskpricesRow(pricePerTBRaw, capacityRaw, conditionRaw, productName, region, condition) {
  if (condition && conditionRaw.trim().toLowerCase() !== condition) return null;
  const pricePerTB = parseNumber(pricePerTBRaw.trim(), region);
  if (!isFinite(pricePerTB) || pricePerTB <= 0 || pricePerTB > 5000) return null;
  capacityRaw = capacityRaw.trim();
  if (/x\s*\d+/i.test(capacityRaw)) return null; // skip multi-packs like "12 TB x20"
  const capMatch = capacityRaw.match(/^([\d.,]+)\s*(TB|GB)/i);
  if (!capMatch) return null;
  const num = parseNumber(capMatch[1], region);
  const capTB = capMatch[2].toUpperCase() === 'GB' ? num / 1000 : num;
  if (!isFinite(capTB) || capTB < 0.1 || capTB > 100) return null;
  productName = productName.trim();
  return {
    name: productName.toLowerCase(),
    capacityTB: capTB,
    pricePerTB,
    raw: productName,
  };
}

// Strip HTML tags + decode entities via DOMParser, then run the listing parser on
// rendered text. Retailer pages (Alternate) use HTML entities like
// `&euro;` for the currency symbol — the regex parser misses those if it sees raw HTML.
export function parseHTMLAsListing(text, region) {
  if (typeof DOMParser === 'undefined') return parseListingMarkdown(text, region);
  const doc = new DOMParser().parseFromString(text, 'text/html');
  doc.querySelectorAll('script, style, noscript, header, footer, nav').forEach(el => el.remove());
  const rendered = doc.body?.textContent || text;
  return parseListingMarkdown(rendered, region);
}

export const parseAlternateMarkdown = parseHTMLAsListing;

// Galaxus category pages through r.jina.ai render each product as three text lines
// separated by blank lines:
//   EUR 209,99 EUR 52,50/1TB            (price first; "429,–" means 429,00; an optional
//                                        "statt EUR …" / "zuletzt neu EUR …" old price follows)
//   **Seagate**IronWolf                 (brand in bold, then the model)
//   4 TB, 3.5"                          (capacity, form factor; galaxus.fr writes "To" / "Go")
// Price per TB is computed from the first price and the capacity line.
export function parseGalaxusText(text, region) {
  if (!text) return [];
  if (/<html[\s>]/i.test(text)) return parseHTMLAsListing(text, region);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const priceRe = /^EUR\s+([\d.]+(?:,\d{1,2})?)/;
  const nameRe  = /^\*\*(.+?)\*\*\s*(.*)$/;
  const capRe   = /^([\d.,]+)\s*(TB|GB|To|Go)\b/i;
  const rows = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const priceM = lines[i].match(priceRe);
    if (!priceM) continue;
    const nameM = lines[i + 1].match(nameRe);
    const capM  = lines[i + 2].match(capRe);
    if (!nameM || !capM) continue;
    const total = parseNumber(priceM[1], region);
    if (!isFinite(total) || total < 20 || total > 12000) continue;
    const num = parseNumber(capM[1], region);
    const capTB = /^G/i.test(capM[2]) ? num / 1000 : num;
    if (!isFinite(capTB) || capTB < 0.1 || capTB > 100) continue;
    const raw = `${nameM[1]} ${nameM[2]} ${lines[i + 2]}`.replace(/\s+/g, ' ').trim();
    rows.push({ name: raw.toLowerCase(), capacityTB: capTB, pricePerTB: total / capTB, raw });
  }
  return rows;
}

// Shopify stores publish each collection as JSON at /collections/<handle>/products.json.
// Used for serverpartdeals.com. Fields we read per product:
//   title                    — product name, includes the model number
//   tags[]                   — "capacity:18TB", "condition:New" / "condition:Manufacturer Recertified" /
//                              "condition:Seller Refurbished"
//   variants[].price         — decimal string in the store currency
//   variants[].available     — false when sold out (skipped)
// Anything that is not "condition:New" counts as used. Proxies can wrap the JSON in a text
// header, so parsing starts at the first {"products".
export function parseShopifyProducts(text, region, condition) {
  if (!text) return [];
  const start = text.indexOf('{"products"');
  if (start < 0) return [];
  let products;
  try { products = JSON.parse(text.slice(start)).products; } catch { return []; }
  if (!Array.isArray(products)) return [];
  const rows = [];
  for (const p of products) {
    const tags = Array.isArray(p.tags) ? p.tags : [];
    const tag = (key) => (tags.find(t => t.toLowerCase().startsWith(key + ':')) || '').slice(key.length + 1);
    const isNew = tag('condition').trim().toLowerCase() === 'new';
    if (condition && (condition === 'new') !== isNew) continue;
    const prices = (p.variants || []).filter(v => v.available).map(v => parseFloat(v.price)).filter(n => isFinite(n) && n > 0);
    if (!prices.length) continue;
    const total = Math.min(...prices);
    const title = String(p.title || '');
    const capM = tag('capacity').match(/([\d.]+)\s*(TB|GB)/i) || title.match(/([\d.]+)\s*(TB|GB)\b/i);
    if (!capM) continue;
    const num = parseFloat(capM[1]);
    const capTB = capM[2].toUpperCase() === 'GB' ? num / 1000 : num;
    if (!isFinite(capTB) || capTB < 0.1 || capTB > 100) continue;
    rows.push({ name: title.toLowerCase(), capacityTB: capTB, pricePerTB: total / capTB, raw: title });
  }
  return rows;
}

// Line-based parser for retailer category pages as r.jina.ai renders them (ARLT, office-partner,
// future-x). Each product ends in a line that holds only the price ("679,00€"). From that line we
// walk back, up to the previous price line, to the closest title that carries a capacity:
//   - the text of a markdown link:  [1TB Seagate Expansion … Festplatte](https://…)
//   - or a short plain line:        Synology Plus-Serie 3.5" SATA Festplatte 16 TB
// Bullet lines, image alt text and long description paragraphs are skipped, because they
// mention other sizes (cache, flash, "bis zu 24 TB"). Struck-through list prices (~~ … ~~)
// and "ab 5,99€" shipping lines are not price-only lines, so they never match.
export function parseTextListing(text, region) {
  if (!text) return [];
  if (/<html[\s>]/i.test(text)) return parseHTMLAsListing(text, region);
  const sym = escapeRegex(region.symbol);
  const priceRe = new RegExp(`^(?:${sym}\\s?)?(\\d[\\d.,]*\\d)\\s?(?:${sym})?$`);
  const hasSym  = new RegExp(sym);
  const capRe   = /(\d+(?:[.,]\d+)?)\s*(TB|GB)\b/i;
  const linkRe  = /(?<!!)\[([^\]]+)\]\(/g;
  const lines = text.split('\n').map(l => l.trim());
  const isPrice = (l) => hasSym.test(l) && priceRe.test(l);

  const titleOf = (line) => {
    if (!line) return null;
    for (const m of line.matchAll(linkRe)) {
      if (!m[1].startsWith('![') && capRe.test(m[1])) return m[1];
    }
    if (/^[*!\[#>-]/.test(line) || line.length > 160) return null;
    return capRe.test(line) ? line : null;
  };

  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isPrice(lines[i])) continue;
    const total = parseNumber(lines[i].match(priceRe)[1], region);
    if (!isFinite(total) || total < 20 || total > 12000) continue;
    let title = null;
    for (let j = i - 1; j >= 0 && j >= i - 40 && !isPrice(lines[j]); j--) {
      title = titleOf(lines[j]);
      if (title) break;
    }
    if (!title) continue;
    const capM = title.match(capRe);
    // Capacity uses "." or "," as the decimal mark ("1.2 TB", "1,92 TB") regardless of region.
    const num = parseFloat(capM[1].replace(',', '.'));
    const capTB = capM[2].toUpperCase() === 'GB' ? num / 1000 : num;
    if (!isFinite(capTB) || capTB < 0.1 || capTB > 100) continue;
    rows.push({ name: title.toLowerCase(), capacityTB: capTB, pricePerTB: total / capTB, raw: title });
  }
  return rows;
}
