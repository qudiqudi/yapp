// ─────────── LIVE PRICING — STATE ───────────
import { REGION_BY_ID } from '../data/regions.js';

export const PRICE_STORAGE_KEY = 'yapp-prices-v1';
export const PRICE_CACHE_TTL_MIN = 120; // 2h

export const priceState = {
  region: null,            // null = no live pricing, baked-in USD only
  condition: 'new',        // 'new' | 'used'
  // True once the user has explicitly chosen a region from the toolbar (incl. picking
  // "USD baseline"). Drives whether we run boot-time auto-detection or honor their pick.
  regionExplicit: false,
  fetchStatus: 'idle',     // 'idle' | 'loading' | 'ok' | 'partial' | 'error'
  fetchError: null,
  sourceStatus: {},        // { diskprices: { ok:true, rows:897 }, mindfactory: { ok:false, error:'...' } }
  cache: {},               // { "de:new": { rows:[...], sourceStatus:{...}, fetchedAt:Date.ms } }
};

export function loadPriceState() {
  try {
    const s = JSON.parse(localStorage.getItem(PRICE_STORAGE_KEY) || 'null');
    if (s) Object.assign(priceState, s);
  } catch {}
}
export function savePriceState() {
  localStorage.setItem(PRICE_STORAGE_KEY, JSON.stringify({
    region: priceState.region,
    condition: priceState.condition,
    regionExplicit: priceState.regionExplicit,
    cache: priceState.cache,
  }));
}

export function currentRegion() { return priceState.region ? REGION_BY_ID[priceState.region] : null; }

export function cacheKey() {
  return `${priceState.region || 'us'}:${priceState.condition}`;
}

// Best-effort region detection. Timezone is the primary signal because it almost always
// reflects physical location — people in Germany running an English-US browser locale
// would still report a Berlin TZ. The locale country code is a tiebreaker.
// Returns a region id we actually have a pricing source for, or null.
const COUNTRY_TO_REGION = {
  us: 'us',
  gb: 'uk', uk: 'uk',
  de: 'de', at: 'de', ch: 'de',  // German-speaking → Mindfactory/Geizhals catalog
  fr: 'fr', be: 'fr', lu: 'fr',
  es: 'es',
  it: 'it',
  ca: 'ca',
  au: 'au', nz: 'au',
};

const TZ_PREFIX_TO_REGION = [
  ['Europe/London',    'uk'],
  ['Europe/Berlin',    'de'], ['Europe/Vienna', 'de'], ['Europe/Zurich', 'de'],
  ['Europe/Paris',     'fr'], ['Europe/Brussels', 'fr'], ['Europe/Luxembourg', 'fr'],
  ['Europe/Madrid',    'es'],
  ['Europe/Rome',      'it'],
  ['Australia/',       'au'], ['Pacific/Auckland', 'au'],
  ['America/Toronto',  'ca'], ['America/Vancouver', 'ca'], ['America/Montreal', 'ca'],
  ['America/Edmonton', 'ca'], ['America/Halifax', 'ca'],
  ['America/',         'us'],
];

export function detectRegion() {
  // 1) Timezone — most reliable signal for physical location.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    for (const [prefix, region] of TZ_PREFIX_TO_REGION) {
      if (tz.startsWith(prefix)) return region;
    }
  } catch {}
  // 2) Browser locale country code (de-DE → de). Skip the language-only form
  // (bare "en", "de") because language alone isn't location info.
  const langs = (navigator.languages && navigator.languages.length)
    ? navigator.languages
    : [navigator.language || ''];
  for (const tag of langs) {
    const country = (tag.split('-')[1] || '').toLowerCase();
    if (COUNTRY_TO_REGION[country]) return COUNTRY_TO_REGION[country];
  }
  return null;
}
