import axios from 'axios';
import { cache } from '../cache';

const TTL = 7 * 24 * 60 * 60 * 1000; // 7 days — Wikipedia content is stable
const HEADERS = { 'User-Agent': 'BurdyGurdy/1.0 (bird identification learning app)' };

export interface AttributedPhoto {
  url: string;
  credit: string; // e.g. "© John Smith · Wikimedia Commons (CC BY-SA 4.0)"
  source?: 'macaulay' | 'inat' | 'wiki';
}

export interface WikiSummary {
  extract: string;        // full introductory extract
  url: string;            // canonical desktop Wikipedia URL
  imageUrl: string | null; // Wikipedia thumbnail (separate from our photo sources)
}

export interface RangeMapLegendItem {
  color: string;  // hex color e.g. "#4a86c8"
  label: string;  // e.g. "Breeding range"
}

/** Expand 3-char hex to 6-char, normalise to lowercase. */
function normaliseHex(hex: string): string {
  const h = hex.replace('#', '');
  const expanded = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return `#${expanded.toLowerCase()}`;
}

/**
 * Fetch the Wikipedia article's parsed HTML (intro section only) and extract
 * legend colour/label pairs from <div class="legend"> elements in the infobox.
 * These are the coloured swatches shown alongside range maps on bird articles.
 */
export async function getWikipediaRangeMapLegend(sciName: string, comName: string): Promise<RangeMapLegendItem[]> {
  const cacheKey = `wikimaplegend:${sciName}`;
  const hit = cache.get<RangeMapLegendItem[]>(cacheKey);
  if (hit !== undefined) return hit;

  const candidates = [sciName, comName];

  for (const name of candidates) {
    try {
      const res = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action:   'parse',
          format:   'json',
          page:     name,
          prop:     'text',
          section:  0,        // intro + infobox only — keeps the payload small
          redirects: 1,
        },
        headers: HEADERS,
      });

      const html: string = res.data?.parse?.text?.['*'] ?? '';
      if (!html) continue;

      // Match: <div class="legend"...><span class="legend-color..." style="...background-color:#rrggbb...">…</span>…Label text…</div>
      const legendRe = /<div[^>]+class="[^"]*legend[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
      const colorRe  = /background-color\s*:\s*(#[0-9a-fA-F]{3,8}|[a-z]+\([^)]+\))/i;

      const items: RangeMapLegendItem[] = [];
      let m: RegExpExecArray | null;

      while ((m = legendRe.exec(html)) !== null) {
        const inner = m[1];
        const colorMatch = colorRe.exec(inner);
        if (!colorMatch) continue;

        // Remove the color swatch span (including its inner content), then decode entities
        const label = inner
          .replace(/<span[\s\S]*?<\/span>/gi, '') // remove swatch span + its content (e.g. &#160;)
          .replace(/<[^>]+>/g, '')                // remove any remaining tags
          .replace(/&#\d+;/g, ' ')               // numeric entities → space
          .replace(/&[a-z]+;/gi, ' ')            // named entities → space
          .replace(/\s+/g, ' ')
          .trim();
        if (!label) continue;

        items.push({ color: normaliseHex(colorMatch[1].startsWith('#') ? colorMatch[1] : colorMatch[1]), label });
      }

      if (items.length > 0) {
        cache.set(cacheKey, items, TTL);
        return items;
      }
    } catch { /* try next candidate */ }
  }

  cache.set(cacheKey, [], TTL);
  return [];
}

/** Strip HTML tags from a string (used to clean Wikimedia Artist metadata). */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/** Batch-fetch attribution metadata for a list of Wikimedia file titles. */
async function fetchWikiAttribution(titles: string[]): Promise<Map<string, string>> {
  if (titles.length === 0) return new Map();
  try {
    const res = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        titles: titles.join('|'),
        prop: 'imageinfo',
        iiprop: 'extmetadata',
        iiextmetadatafilter: 'Artist|LicenseShortName',
        format: 'json',
        origin: '*',
      },
      headers: HEADERS,
    });
    const pages = res.data?.query?.pages ?? {};
    const map = new Map<string, string>();
    for (const page of Object.values(pages) as Array<{
      title?: string;
      imageinfo?: Array<{ extmetadata?: { Artist?: { value?: string }; LicenseShortName?: { value?: string } } }>;
    }>) {
      if (!page.title || !page.imageinfo?.[0]) continue;
      const meta = page.imageinfo[0].extmetadata;
      const artist  = meta?.Artist?.value          ? stripHtml(meta.Artist.value)          : '';
      const license = meta?.LicenseShortName?.value ?? '';
      const parts   = [artist ? `© ${artist}` : '', 'Wikimedia Commons', license].filter(Boolean);
      map.set(page.title, parts.join(' · '));
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Fetches high-quality bird photos from the Wikipedia article's media list.
 * Returns AttributedPhoto objects with CC attribution, excluding range maps,
 * icons, flags, and diagrams. Requires known width of at least 300px.
 */
export async function getWikipediaPhotos(sciName: string, comName: string): Promise<AttributedPhoto[]> {
  const cacheKey = `wikiphotos6:${sciName}`;
  const hit = cache.get<AttributedPhoto[]>(cacheKey);
  if (hit !== undefined) return hit;

  const candidates = [
    sciName.replace(/ /g, '_'),
    comName.replace(/ /g, '_'),
  ];

  const EXCLUDE   = /range|distribution|map|license|plate|iucn|mhnt|flag|logo|icon|symbol|chart|graph|diagram|coat_of_arms|silhouette|feather/i;
  const PHOTO_EXT = /\.(jpg|jpeg|png)$/i;

  for (const title of candidates) {
    try {
      const res = await axios.get(
        `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title)}`,
        { headers: HEADERS },
      );
      const items: Array<{
        title?: string;
        original?: { source?: string; width?: number; height?: number };
        srcset?: Array<{ src?: string }>;
      }> = res.data?.items ?? [];

      const found: Array<{ title: string; url: string }> = [];
      for (const item of items) {
        if (!item.title || EXCLUDE.test(item.title)) continue;
        if (!PHOTO_EXT.test(item.title)) continue;

        // Prefer original.source (full-res direct URL); fall back to the largest srcset entry.
        // Some Wikimedia items omit original.source and only provide srcset thumbnails.
        let url: string | null = null;
        if (item.original?.source) {
          url = item.original.source;
        } else {
          const src = item.srcset?.[item.srcset.length - 1]?.src ?? null;
          if (src) url = src.startsWith('//') ? `https:${src}` : src;
        }
        if (!url) continue;

        // Reject only if we know the image is too small
        if (item.original?.width && item.original.width < 250) continue;

        found.push({ title: item.title, url });
        if (found.length >= 8) break;
      }

      if (found.length > 0) {
        const attribution = await fetchWikiAttribution(found.map(f => f.title));
        const photos: AttributedPhoto[] = found.map(f => ({
          url: f.url,
          credit: attribution.get(f.title) ?? 'Wikimedia Commons',
          source: 'wiki' as const,
        }));
        cache.set(cacheKey, photos, TTL);
        return photos;
      }
    } catch { /* try next candidate */ }
  }

  cache.set(cacheKey, [], TTL);
  return [];
}

/**
 * Fetches the range/distribution map image URL from the Wikipedia article's media list.
 * Filters for images with "range", "distribution", or "map" in the filename.
 * Returns the direct image URL, or null if none found.
 */
export async function getWikipediaRangeMap(sciName: string, comName: string): Promise<string | null> {
  const cacheKey = `wikimap:${sciName}`;
  const hit = cache.get<string | null>(cacheKey);
  if (hit !== undefined) return hit;

  const candidates = [
    sciName.replace(/ /g, '_'),
    comName.replace(/ /g, '_'),
  ];

  const mapTerms = /range|distribution|map/i;
  const imageExts = /\.(png|jpg|jpeg|svg)$/i;

  for (const title of candidates) {
    try {
      const res = await axios.get(
        `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title)}`,
        { headers: HEADERS },
      );
      const items: Array<{
        title?: string;
        type?: string;
        original?: { source?: string };
        srcset?: Array<{ src?: string; scale?: string }>;
      }> = res.data?.items ?? [];

      // Find a range/distribution map image; SVGs often have no original.source, only srcset
      const mapItem = items.find(
        item =>
          item.title &&
          mapTerms.test(item.title) &&
          imageExts.test(item.title),
      );

      // if (!mapItem) {
      //   console.log(`[rangemap] no map image found in ${title}; titles:`, items.map(i => i.title).filter(Boolean));
      // }
      if (mapItem) {
        const url =
          mapItem.original?.source ??
          (mapItem.srcset?.[0]?.src
            ? mapItem.srcset[0].src!.startsWith('//')
              ? `https:${mapItem.srcset[0].src}`
              : mapItem.srcset[0].src
            : null);
        if (url) {
          cache.set(cacheKey, url, TTL);
          return url;
        }
      }
    } catch { /* try next candidate */ }
  }

  cache.set(cacheKey, null, TTL);
  return null;
}

/**
 * Fetches the Wikipedia introductory summary for a bird species.
 * Tries the scientific name first (most reliable for birds), then the common name.
 */
export async function getWikipediaSummary(sciName: string, comName: string): Promise<WikiSummary | null> {
  const cacheKey = `wiki:${sciName}`;
  const hit = cache.get<WikiSummary | null>(cacheKey);
  if (hit !== undefined) return hit;

  const candidates = [sciName, comName];

  for (const name of candidates) {
    try {
      const res = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action:      'query',
          format:      'json',
          titles:      name,
          prop:        'extracts|pageimages',
          // no exintro — fetch the full article text
          explaintext: 1,        // plain text, no HTML markup
          pithumbsize: 400,
          redirects:   1,
        },
        headers: HEADERS,
      });

      const pages = res.data?.query?.pages as Record<string, { pageid?: number; title?: string; extract?: string; thumbnail?: { source?: string } }> | undefined;
      if (!pages) continue;

      const page = Object.values(pages)[0];
      if (!page || page.pageid === -1 || !page.extract?.trim()) continue;

      const wikiTitle = (page.title ?? name).replace(/ /g, '_');
      const result: WikiSummary = {
        extract:  page.extract,
        url:      `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`,
        imageUrl: page.thumbnail?.source ?? null,
      };
      cache.set(cacheKey, result, TTL);
      return result;
    } catch { /* try next candidate */ }
  }

  cache.set(cacheKey, null, TTL);
  return null;
}
