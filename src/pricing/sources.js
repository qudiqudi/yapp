// ─────────── PRICING — SOURCE REGISTRY ───────────
import {
  parseDiskpricesHTML,
  parseMindfactoryMarkdown,
  parseAlternateMarkdown,
  parseGeizhalsMarkdown,
} from './parsers.js';

// Source registry. Each source: { id, label, regions[], conditions[], note, urls(region,condition), parse }.
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
    parse: parseDiskpricesHTML,
    minRows: 20,
  },
  {
    id: 'mindfactory',
    label: 'Mindfactory',
    note: 'German retailer · HDD / SSD / NVMe categories',
    regions: ['de'],
    conditions: ['new'],
    urls: () => [
      'https://www.mindfactory.de/Hardware/Festplatten+(HDD).html',
      'https://www.mindfactory.de/Hardware/SSD/SATA+SSD.html',
      'https://www.mindfactory.de/Hardware/SSD/M.2+und+PCI-e.html',
    ],
    parse: parseMindfactoryMarkdown,
    minRows: 4,
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
    id: 'geizhals',
    label: 'Geizhals',
    note: 'German price aggregator · all retailers',
    regions: ['de'],
    conditions: ['new'],
    urls: () => [
      'https://geizhals.de/?cat=hde7s&sort=p',                    // HDD internal
      'https://geizhals.de/?cat=hdssd&sort=p&xf=4836_2.5%22',     // SATA SSD
      'https://geizhals.de/?cat=hdssd&sort=p&xf=4830_M.2',        // M.2 / NVMe
    ],
    parse: parseGeizhalsMarkdown,
    minRows: 6,
  },
];

export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map(s => [s.id, s]));

export function availableSources(regionId) {
  return SOURCES.filter(s => !regionId || s.regions.includes(regionId));
}
