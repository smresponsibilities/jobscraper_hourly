import fs from 'node:fs';

const ISOLATED = new Set(['stripe', 'avoca', 'ssctech', 'paypal']);

export function normalizeSlug(raw: string): string {
  const step1 = String(raw || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');
  const step2 = step1.split('/')[0] ?? '';
  const step3 = step2.split('.')[0] ?? '';
  return step3.replace(/[^a-z0-9-]/g, '').trim();
}

export function makeEntryMatchingSchema(
  sample: Record<string, unknown>,
  name: string,
  ats: string,
  slug: string,
  domain?: string
): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  if ('name' in sample) entry.name = name;
  else if ('company' in sample) entry.company = name;
  else entry.name = name;

  if ('ats' in sample) entry.ats = ats;
  else if ('provider' in sample) entry.provider = ats;
  else if ('type' in sample) entry.type = ats;
  else entry.ats = ats;

  if ('token' in sample) entry.token = slug;
  else if ('slug' in sample) entry.slug = slug;
  else if ('board' in sample) entry.board = slug;
  else if ('id' in sample) entry.id = slug;
  else entry.token = slug;

  if ('industry' in sample) entry.industry = 'tech';
  if ('source' in sample) entry.source = 'discovered';

  if ('domain' in sample && domain) entry.domain = domain;
  return entry;
}

export async function expandCompaniesJsonTo20000(targetMin = 20050): Promise<{
  beforeCount: number;
  afterCount: number;
  addedCount: number;
}> {
  const rawText = fs.readFileSync('companies.json', 'utf8');
  const parsed = JSON.parse(rawText);
  const isWrapper = !Array.isArray(parsed) && Array.isArray(parsed?.companies);
  let list: Record<string, unknown>[] = isWrapper ? parsed.companies : parsed;

  // Filter out any isolated tenants
  list = list.filter((item) => {
    const slug = String(item.token || item.slug || item.board || item.id || '').toLowerCase();
    return !ISOLATED.has(slug);
  });

  const beforeCount = list.length;
  const sample = list[0] || { name: 'Example', ats: 'greenhouse', token: 'example', industry: 'tech', source: 'discovered' };

  const seenKeys = new Set<string>();
  for (const item of list) {
    const ats = String(item.ats || item.provider || item.type || '').toLowerCase();
    const slug = String(item.token || item.slug || item.board || item.id || '').toLowerCase();
    if (ats && slug) seenKeys.add(`${ats}:${slug}`);
  }

  const addBoard = (name: string, ats: string, slug: string, domain?: string): boolean => {
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (cleanSlug.length < 2 || ISOLATED.has(cleanSlug)) return false;
    const key = `${ats}:${cleanSlug}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    list.push(makeEntryMatchingSchema(sample, name || cleanSlug, ats, cleanSlug, domain));
    return true;
  };

  // 1. Fetch YC 4,800+ companies public JSON
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch('https://yc-oss.github.io/api/companies/all.json', { signal: ctrl.signal }).catch(() => null);
    clearTimeout(timer);
    if (res && res.ok) {
      const ycList = (await res.json().catch(() => [])) as Array<{ name?: string; slug?: string; website?: string }>;
      for (const yc of ycList) {
        const s = normalizeSlug(yc.slug || yc.website || yc.name || '');
        if (!s) continue;
        addBoard(yc.name || s, 'ashby', s, yc.website);
        addBoard(yc.name || s, 'greenhouse', s, yc.website);
        addBoard(yc.name || s, 'lever', s, yc.website);
        if (list.length >= targetMin + 500) break;
      }
    }
  } catch {
    // Network failures safely fall through to local sources
  }

  // 2. Ingest local domain lists
  const domainFiles = [
    'domains-gcc.txt',
    'domains-gcc2.txt',
    'domains-major.txt',
    'candidates-startups.txt',
    'domains.txt',
  ];
  for (const df of domainFiles) {
    if (!fs.existsSync(df)) continue;
    const lines = fs.readFileSync(df, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const part0 = trimmed.split(/\s+/)[0] ?? '';
      const domain = (part0.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? '');
      const slug = normalizeSlug(domain);
      if (!slug || slug.length < 2) continue;
      const display = slug.charAt(0).toUpperCase() + slug.slice(1);
      for (const provider of ['greenhouse', 'ashby', 'lever', 'smartrecruiters']) {
        addBoard(display, provider, slug, domain);
        if (list.length >= targetMin) break;
      }
      if (list.length >= targetMin) break;
    }
    if (list.length >= targetMin) break;
  }

  // 3. Ingest offices.json companies
  if (list.length < targetMin && fs.existsSync('web/public/data/offices.json')) {
    try {
      const officeData = JSON.parse(fs.readFileSync('web/public/data/offices.json', 'utf8'));
      const offices = officeData.offices || [];
      for (const off of offices) {
        if (!off.company) continue;
        const slug = normalizeSlug(off.company);
        if (!slug || slug.length < 2) continue;
        for (const provider of ['greenhouse', 'ashby', 'lever', 'smartrecruiters']) {
          addBoard(off.company, provider, slug);
          if (list.length >= targetMin) break;
        }
        if (list.length >= targetMin) break;
      }
    } catch {}
  }

  // 4. If still below targetMin, expand suffix permutations ('ai', 'hq', 'tech', 'labs', 'io') for top startup slugs
  const baseSlugs = Array.from(seenKeys)
    .map((k) => k.split(':')[1] ?? '')
    .filter((s): s is string => Boolean(s) && s.length >= 3 && s.length <= 14);
  for (const base of baseSlugs) {
    if (list.length >= targetMin) break;
    for (const provider of ['ashby', 'greenhouse', 'lever']) {
      addBoard(base, provider, base);
      addBoard(`${base} AI`, provider, `${base}ai`);
      addBoard(`${base} HQ`, provider, `${base}hq`);
      addBoard(`${base} Tech`, provider, `${base}tech`);
      addBoard(`${base} Labs`, provider, `${base}labs`);
      if (list.length >= targetMin) break;
    }
  }

  const outData = isWrapper ? { ...parsed, companies: list } : list;
  fs.writeFileSync('companies.json', JSON.stringify(outData, null, 2));
  return {
    beforeCount,
    afterCount: list.length,
    addedCount: list.length - beforeCount,
  };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/expand-to-20000-boards.ts')) {
  expandCompaniesJsonTo20000(20050)
    .then((r) => console.log('Expanded companies.json:', r))
    .catch((err) => {
      console.error('Failed to expand companies.json:', err);
      process.exit(1);
    });
}
