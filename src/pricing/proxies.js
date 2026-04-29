// ─────────── PRICING — CORS PROXY CHAIN ───────────
// corsproxy.io serves the full HTML; allorigins is a backup; r.jina.ai
// returns markdown but only 1.5KB for JS-rendered pages — kept last as a courtesy.
export const PROXIES = [
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://r.jina.ai/${u}`,
];

export async function fetchOne(u) {
  let lastErr;
  for (const wrap of PROXIES) {
    try {
      const res = await fetch(wrap(u), { headers: { 'Accept':'text/html, text/plain, */*' } });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status} via ${wrap.name||'proxy'}`); continue; }
      const text = await res.text();
      if (text.length < 500) { lastErr = new Error(`empty (${text.length}B)`); continue; }
      return text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all proxies failed');
}
