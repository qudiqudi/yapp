// ─────────── PRICING — SOURCE REGISTRY ───────────
import {
  parseDiskprices,
  parseAlternateMarkdown,
  parseGalaxusText,
  parseShopifyProducts,
  parseTextListing,
} from './parsers.js';

// Source registry. Each source: { id, label, regions[], conditions[], note, urls(region,condition), parse(text,region,condition),
// optional format:'html' (ask the proxy for page HTML instead of rendered text) }.
export const SOURCES = [
  {
    id: 'diskprices',
    label: 'diskprices.com',
    note: 'Amazon listings · $/TB pre-computed',
    regions: ['us','uk','de','fr','es','it','ca','au'],
    conditions: ['new','used'],
    urls: (region, condition) => [
      `https://diskprices.com/?locale=${region.locale}&condition=${condition}`,
    ],
    format: 'html',   // rows are hidden until the page JS runs; the text render can be empty
    parse: parseDiskprices,
    minRows: 20,
  },
  {
    id: 'alternate',
    label: 'Alternate.de',
    note: 'German retailer · Festplatten + SSD',
    regions: ['de'],
    conditions: ['new'],
    urls: () => [
      'https://www.alternate.de/Festplatten',
      'https://www.alternate.de/SSD-Festplatten',
    ],
    parse: parseAlternateMarkdown,
    minRows: 4,
  },
  {
    id: 'galaxus',
    label: 'Galaxus',
    note: 'European retailer · HDD + SSD categories',
    regions: ['de','fr','it'],
    conditions: ['new'],
    // Same site per country: galaxus.<tld>/<lang>/s1/producttype/<slug>-<id>. The numeric id
    // (36 = HDD, 545 = SSD) selects the category; the slug is the localized name.
    urls: (region) => {
      const hddSlug = { de:'festplatten', fr:'disques-durs', it:'hard-disk' }[region.id];
      const base = `https://www.galaxus.${region.id}/${region.id}/s1/producttype`;
      return [
        `${base}/${hddSlug}-36?take=120`,
        `${base}/ssd-545?take=120`,
      ];
    },
    parse: parseGalaxusText,
    minRows: 6,
  },
  {
    id: 'officepartner',
    label: 'office-partner.de',
    note: 'German retailer · internal / NAS / enterprise HDD + SSD',
    regions: ['de'],
    conditions: ['new'],
    // About 12 products per page; ?from=N pages further.
    urls: () => [
      'https://www.office-partner.de/pc-hardware/festplatten/interne-festplatten/',
      'https://www.office-partner.de/pc-hardware/festplatten/nas-festplatten/',
      'https://www.office-partner.de/pc-hardware/festplatten/enterprise-festplatten/',
      'https://www.office-partner.de/pc-hardware/ssd/solid-state-drives/interne-ssd/',
    ],
    parse: parseTextListing,
    minRows: 4,
  },
  {
    id: 'futurex',
    label: 'future-x.de',
    note: 'German retailer · HDD + SSD, strong on enterprise models',
    regions: ['de'],
    conditions: ['new'],
    // 24 products per page; ?p=N pages further.
    urls: () => [
      'https://www.future-x.de/Hardware-Netzwerk/PC-Komponenten/Festplatten/',
      'https://www.future-x.de/Hardware-Netzwerk/PC-Komponenten/Festplatten/?p=2',
      'https://www.future-x.de/Hardware-Netzwerk/PC-Komponenten/Festplatten/SSD/',
    ],
    parse: parseTextListing,
    minRows: 4,
  },
  {
    id: 'arlt',
    label: 'ARLT',
    note: 'German retailer · internal drives',
    regions: ['de'],
    conditions: ['new'],
    // "intern" filter of the Festplatten category. 10 products per page; ?pgNr=N pages further (0-based).
    urls: () => [0, 1, 2].map(n =>
      'https://www.arlt.com/Hardware/PC-Komponenten/Festplatten/_Filter/Bauart%2B%2528intern%257C%257Cextern%2529/intern/'
      + (n ? `?pgNr=${n}` : '')
    ),
    parse: parseTextListing,
    minRows: 4,
  },
  {
    id: 'serverpartdeals',
    label: 'ServerPartDeals',
    note: 'US retailer · new + recertified enterprise drives',
    regions: ['us'],
    conditions: ['new','used'],
    urls: () => [
      'https://serverpartdeals.com/collections/hard-drives/products.json?limit=250',
      'https://serverpartdeals.com/collections/solid-state-drives/products.json?limit=250',
    ],
    parse: parseShopifyProducts,
    minRows: 6,
  },
];

export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map(s => [s.id, s]));

export function availableSources(regionId) {
  return SOURCES.filter(s => !regionId || s.regions.includes(regionId));
}
