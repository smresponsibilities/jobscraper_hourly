import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { employerKey, parseOfficeDirectory, type Office, type OfficeCity } from '../web/lib/office-data.js';
import { JOB_CITIES } from '../web/lib/job-cities.js';

const REFERENCE = 'https://www.blrstartuparena.com/map';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const OUTPUT = 'web/public/data/offices.json';
export function officeQuery(city: typeof JOB_CITIES[number]): string {
  const bounds = `(${city.lat - .32},${city.lng - .4},${city.lat + .32},${city.lng + .4})`;
  return `[out:json][timeout:40];(nwr["office"]${bounds};nwr["building"="office"]["name"]${bounds};);out center tags;`;
}

export async function fetchOsmOffices(request: typeof fetch = fetch, signal?: AbortSignal): Promise<{ elements: unknown[] }> {
  const elements: unknown[] = [];
  for (const city of JOB_CITIES) {
    let complete = false;
    const failures: string[] = [];
    for (const endpoint of OVERPASS) {
      signal?.throwIfAborted();
      try {
        const response = await request(endpoint, {
          method: 'POST', body: new URLSearchParams({ data: officeQuery(city) }),
          headers: { 'user-agent': 'JobscraperOfficeMap/1.0' },
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(55_000)]) : AbortSignal.timeout(55_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as { elements?: unknown; remark?: unknown } | null;
        if (!data || !Array.isArray(data.elements) || !data.elements.length || data.remark) throw new Error('Incomplete office response');
        elements.push(...data.elements);
        complete = true;
        break;
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push(`${new URL(endpoint).hostname}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!complete) throw new Error(`${city.name} office sources failed: ${failures.join('; ')}`);
  }
  return { elements };
}


export function referenceCompanies(html: string): Record<string, unknown>[] {
  let payload = '';
  for (const match of html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)) {
    const chunk: unknown = JSON.parse(match[1]!);
    if (Array.isArray(chunk) && chunk[0] === 1 && typeof chunk[1] === 'string') payload += chunk[1];
  }
  for (const line of payload.split('\n')) {
    let row: unknown;
    try { row = JSON.parse(line.slice(line.indexOf(':') + 1)); } catch { continue; }
    if (Array.isArray(row) && Array.isArray(row[3]?.companies) && row[3].companies.length) return row[3].companies;
  }
  throw new Error('Reference map company payload missing');
}

export function buildOffices(companies: Record<string, unknown>[], osm: unknown): Office[] {
  const offices: Office[] = [];
  for (const c of companies) {
    if (typeof c.name !== 'string' || !c.name.trim()) throw new Error('Invalid reference company');
    if (typeof c.slug !== 'string' || typeof c.latitude !== 'number' || typeof c.longitude !== 'number' || typeof c.approximate !== 'boolean') throw new Error('Invalid reference office');
    offices.push({ id: `blr:${c.slug}`, company: c.name, city: 'Bengaluru', latitude: c.latitude, longitude: c.longitude,
      officeName: typeof c.officeName === 'string' ? c.officeName : '', locality: typeof c.locality === 'string' ? c.locality : '',
      address: typeof c.address === 'string' ? c.address : '', approximate: c.approximate, source: `${REFERENCE}#${encodeURIComponent(c.slug)}`,
      ...(typeof c.logoUrl === 'string' && /^https:\/\//.test(c.logoUrl) ? { logoUrl: c.logoUrl } : {}) });
  }
  const response = osm as { elements?: unknown; remark?: unknown } | null;
  if (!response || !Array.isArray(response.elements) || response.remark) throw new Error('Incomplete OpenStreetMap office response');
  for (const element of response.elements) {
    const e = element as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };
    const tags = e.tags;
    if (!tags || (!tags.office && tags.building !== 'office')) continue;
    const employer = [tags.brand, tags['name:en'], tags.operator, tags.name].find(name => typeof name === 'string' && name.trim());
    if (!employer) continue;
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !['node', 'way', 'relation'].includes(e.type ?? '') || !Number.isSafeInteger(e.id)) throw new Error('Invalid OSM office location');
    const city = JOB_CITIES.find(c => Math.abs(c.lat - lat) < .45 && Math.abs(c.lng - lng) < .45)?.name as OfficeCity | undefined;
    if (!city || offices.some(o => o.city === city && employerKey(o.company) === employerKey(employer))) continue;
    offices.push({ id: `osm:${e.type}:${e.id}`, company: employer, city, latitude: lat, longitude: lng,
      officeName: tags.name ?? employer, locality: tags['addr:suburb'] ?? tags['addr:neighbourhood'] ?? (tags['addr:city'] !== city ? tags['addr:city'] ?? '' : ''),
      address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'], tags['addr:postcode']].filter(Boolean).join(', '),
      approximate: e.type !== 'node', source: `https://www.openstreetmap.org/${e.type}/${e.id}` });
  }
  return offices;
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, { headers: { 'user-agent': 'JobscraperOfficeMap/1.0' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(55_000)]) : AbortSignal.timeout(55_000) });
  if (!response.ok) throw new Error(`Office source HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const args = process.argv.slice(2);
  const input = async (flag: string, remote: () => Promise<string>) => {
    const index = args.indexOf(flag);
    if (index < 0) return remote();
    if (!args[index + 1]) throw new Error(`${flag} requires a file`);
    return readFile(args[index + 1]!, 'utf8');
  };
  const abort = new AbortController();
  let html: string, osmText: string;
  try {
    [html, osmText] = await Promise.all([
      input('--reference', () => fetchText(REFERENCE, abort.signal)),
      input('--osm', async () => JSON.stringify(await fetchOsmOffices(fetch, abort.signal))),
    ]);
  } finally {
    abort.abort();
  }
  const offices = buildOffices(referenceCompanies(html), JSON.parse(osmText));
  const directory = parseOfficeDirectory({ version: 1, generatedAt: new Date().toISOString(), offices });
  for (const city of JOB_CITIES) if (!offices.some(o => o.city === city.name)) throw new Error(`No sourced offices for ${city.name}; preserving existing directory`);
  await mkdir('web/public/data', { recursive: true });
  const temporary = `${OUTPUT}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(directory, null, 2)}\n`);
  await rename(temporary, OUTPUT);
  console.log(JOB_CITIES.map(c => `${c.name}: ${offices.filter(o => o.city === c.name).length} offices`).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
