// ─────────── REGIONS ───────────
// Note: FR uses U+00A0 (non-breaking space) as thousand separator — keep as escape.
export const REGIONS = [
  { id:'us', label:'US', locale:'us', tld:'.com',    symbol:'$', currency:'USD', decimal:'.', thousand:',' },
  { id:'uk', label:'UK', locale:'uk', tld:'.co.uk',  symbol:'£', currency:'GBP', decimal:'.', thousand:',' },
  { id:'de', label:'DE', locale:'de', tld:'.de',     symbol:'€', currency:'EUR', decimal:',', thousand:'.' },
  { id:'fr', label:'FR', locale:'fr', tld:'.fr',     symbol:'€', currency:'EUR', decimal:',', thousand:' ' },
  { id:'es', label:'ES', locale:'es', tld:'.es',     symbol:'€', currency:'EUR', decimal:',', thousand:'.' },
  { id:'it', label:'IT', locale:'it', tld:'.it',     symbol:'€', currency:'EUR', decimal:',', thousand:'.' },
  { id:'ca', label:'CA', locale:'ca', tld:'.ca',     symbol:'CA$', currency:'CAD', decimal:'.', thousand:',' },
  { id:'au', label:'AU', locale:'au', tld:'.com.au', symbol:'A$',  currency:'AUD', decimal:'.', thousand:',' },
];
export const REGION_BY_ID = Object.fromEntries(REGIONS.map(r => [r.id, r]));
