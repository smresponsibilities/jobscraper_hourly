import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ISOLATED = new Set(['stripe', 'avoca', 'ssctech', 'paypal']);

function normalizeSlug(raw: string): string {
  const s = String(raw || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '');
  const part0 = s.split('/')[0] || '';
  const sub0 = part0.split('.')[0] || '';
  return sub0.replace(/[^a-z0-9-]/g, '').trim();
}

async function checkBoardHasLiveJobs(ats: string, slug: string, timeoutMs = 3500): Promise<number> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let url = '';
    if (ats === 'greenhouse') url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`;
    else if (ats === 'ashby') url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
    else if (ats === 'lever') url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json&limit=5`;
    else if (ats === 'smartrecruiters') url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=5`;
    else return 0;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return 0;
    const data = (await res.json().catch(() => null)) as any;
    if (!data) return 0;
    if (Array.isArray(data)) return data.length;
    if (Array.isArray(data.jobs)) return data.jobs.length;
    if (Array.isArray(data.content)) return data.content.length;
    return 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyAndAddLiveBoardsToCompaniesJson(maxCandidatesToProbe = 1200): Promise<{
  beforeCount: number;
  probedCandidates: number;
  verifiedLiveAdded: number;
  afterCount: number;
}> {
  const raw = JSON.parse(fs.readFileSync('companies.json', 'utf8'));
  const isWrapper = !Array.isArray(raw) && Array.isArray(raw?.companies);
  const list: Record<string, unknown>[] = isWrapper ? raw.companies : raw;
  const beforeCount = list.length;
  const sample = list[0] || { name: 'Example', ats: 'greenhouse', slug: 'example' };

  const seenKeys = new Set<string>();
  for (const item of list) {
    const ats = String(item.ats || item.provider || item.type || '').toLowerCase();
    const slug = String(item.slug || item.board || item.id || item.token || '').toLowerCase();
    if (ats && slug) seenKeys.add(`${ats}:${slug}`);
  }

  // Gather candidate slugs from verified-live-boards.json, YC, and local domain files
  const candidateProbes: Array<{ name: string; ats: string; slug: string }> = [];
  const candidateSeen = new Set<string>();
  const enqueueProbe = (name: string, ats: string, slug: string) => {
    const clean = slug.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (clean.length < 2 || ISOLATED.has(clean)) return;
    const key = `${ats}:${clean}`;
    if (seenKeys.has(key) || candidateSeen.has(key)) return;
    candidateSeen.add(key);
    candidateProbes.push({ name: name || clean, ats, slug: clean });
  };

  if (fs.existsSync('state/verified-live-boards.json')) {
    try {
      const v = JSON.parse(fs.readFileSync('state/verified-live-boards.json', 'utf8'));
      for (const b of Array.isArray(v) ? v : []) {
        if (b.ats && b.slug) enqueueProbe(b.name || b.slug, b.ats, b.slug);
      }
    } catch {}
  }

  for (const df of ['domains-gcc.txt', 'domains-gcc2.txt', 'candidates-startups.txt', 'domains-major.txt']) {
    if (!fs.existsSync(df)) continue;
    for (const line of fs.readFileSync(df, 'utf8').split(/\r?\n/)) {
      const s = normalizeSlug(line);
      if (s.length >= 2) {
        enqueueProbe(s, 'greenhouse', s);
        enqueueProbe(s, 'ashby', s);
        enqueueProbe(s, 'lever', s);
      }
      if (candidateProbes.length >= maxCandidatesToProbe) break;
    }
    if (candidateProbes.length >= maxCandidatesToProbe) break;
  }

  const batchSize = 80;
  const toProbe = candidateProbes.slice(0, maxCandidatesToProbe);
  let verifiedLiveAdded = 0;

  for (let i = 0; i < toProbe.length; i += batchSize) {
    const batch = toProbe.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (c) => {
        const count = await checkBoardHasLiveJobs(c.ats, c.slug);
        return count > 0 ? c : null;
      })
    );
    for (const hit of results) {
      if (!hit) continue;
      const key = `${hit.ats}:${hit.slug}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const entry: Record<string, unknown> = {};
      if ('name' in sample) entry.name = hit.name;
      else entry.company = hit.name;
      if ('ats' in sample) entry.ats = hit.ats;
      else entry.provider = hit.ats;
      if ('slug' in sample) entry.slug = hit.slug;
      else entry.board = hit.slug;
      list.push(entry);
      verifiedLiveAdded++;
    }
  }

  const outData = isWrapper ? { ...raw, companies: list } : list;
  fs.writeFileSync('companies.json', JSON.stringify(outData, null, 2));
  return {
    beforeCount,
    probedCandidates: toProbe.length,
    verifiedLiveAdded,
    afterCount: list.length,
  };
}

const isDirectCli = process.argv[1] && (
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase() ||
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
);

if (isDirectCli) {
  verifyAndAddLiveBoardsToCompaniesJson(1200).then((r) =>
    console.log('Verified Live Boards Added to companies.json:', r)
  );
}
