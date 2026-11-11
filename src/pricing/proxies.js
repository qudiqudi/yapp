// ─────────── PRICING — CORS PROXY CHAIN ───────────
// r.jina.ai is first: it is the only keyless proxy that still answers reliably. By default it
// returns rendered text/markdown; with the X-Return-Format: html header it returns the page
// HTML instead. Sources that need the DOM (diskprices hides its table rows until its own JS
// runs, so the text render is sometimes empty) ask for it with `format: 'html'`.
// allorigins passes the raw HTML through but is frequently down (520/522). corsproxy.io was
// dropped: it now rejects keyless requests with 403 keyless_legacy_url.
export const PROXIES = [
  {
    url: (u) => `https://r.jina.ai/${u}`,
    headers: (format) => (format === 'html' ? { 'X-Return-Format': 'html' } : {}),
  },
  {
    url: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    headers: () => ({}),
  },
];

// Cold pages sometimes time out at the proxy (HTTP 408) or drop the connection while it renders
// them; a second pass after a short pause usually hits the proxy cache. The error message lists
// every attempt so a dead fallback proxy does not hide the reason the first one failed.
const RETRY_PAUSE_MS = 2000;
// A dead proxy can hold a connection open for minutes; without a limit one hung fetch
// keeps the whole refresh in the loading state.
const ATTEMPT_TIMEOUT_MS = 20000;

export async function fetchOne(u, { format } = {}) {
  const errors = [];
  for (let pass = 0; pass < 2; pass++) {
    if (pass) await new Promise(r => setTimeout(r, RETRY_PAUSE_MS));
    for (const proxy of PROXIES) {
      const host = new URL(proxy.url(u)).host;
      try {
        const res = await fetch(proxy.url(u), {
          headers: { 'Accept':'text/html, text/plain, */*', ...proxy.headers(format) },
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        });
        if (!res.ok) { errors.push(`${host}: HTTP ${res.status}`); continue; }
        const text = await res.text();
        if (text.length < 500) { errors.push(`${host}: empty (${text.length}B)`); continue; }
        return text;
      } catch (e) { errors.push(`${host}: ${e.message || e}`); }
    }
  }
  throw new Error(errors.join(', ') || 'all proxies failed');
}
