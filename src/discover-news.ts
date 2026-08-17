import type { Candidate, Hit } from './board-probe.js';
import { probeSlug } from './board-probe.js';
import { mapLimit, UA } from './fetchers/util.js';
import { isServiceCompany } from './filter.js';
import { extractNames, headlines, FUNDING, INDIA_EXPANSION } from './news-extract.js';
import { loadCompanies, saveCompanies } from './state.js';

/**
 * Harvests company names from Indian startup-funding and India-expansion
 * coverage, then probes them for a real board.
 *
 *   npm run discover-news
 *
 * The premise: a company that just raised a round, or just announced an India
 * centre, is about to start hiring — and is exactly the employer this tracker
 * would otherwise learn about months late, once it happened to appear in a
 * placement report or a Common Crawl index.
 *
 * Name extraction is deliberately GENEROUS rather than clever. Pulling a wrong
 * phrase out of a headline costs one failed HTTP probe and nothing else, while
 * being strict would miss companies whose headline phrasing wasn't anticipated.
 * The board probe is the real filter — same principle as the URL import: every
 * board is validated before it is kept, so a bad guess is free.
 */
const FEEDS = [
  'https://entrackr.com/rss',
  'https://inc42.com/feed/',
  'https://yourstory.com/feed',
  'https://techcrunch.com/feed/',
  'https://startupstorymedia.com/feed/',
  'https://www.livemint.com/rss/companies',
];

async function fetchFeed(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const existing = await loadCompanies();
  const known = new Set(existing.map((c) => `${c.ats}:${c.token.toLowerCase()}`));
  const knownNames = new Set(existing.map((c) => c.name.toLowerCase().replace(/[^a-z0-9]/g, '')));

  const feeds = await mapLimit(FEEDS, 6, fetchFeed);
  const live = feeds.filter(Boolean).length;

  const relevant: string[] = [];
  for (const xml of feeds) {
    for (const title of headlines(xml)) {
      if (FUNDING.test(title) || INDIA_EXPANSION.test(title)) relevant.push(title);
    }
  }
  console.log(`${live}/${FEEDS.length} feeds reachable, ${relevant.length} funding/expansion headlines`);

  const candidates = new Map<string, Candidate>();
  for (const title of relevant) {
    for (const name of extractNames(title)) {
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!key || knownNames.has(key) || candidates.has(key)) continue;
      candidates.set(key, { slug: name, name, industry: 'tech' });
    }
  }
  console.log(`${candidates.size} candidate names not already tracked`);
  if (candidates.size === 0) return;

  const hits = (
    await mapLimit([...candidates.values()], 10, (c) => probeSlug(c, known, 'discovered'))
  ).filter((hit): hit is Hit => hit !== null && !isServiceCompany(hit.company.name));

  // Same bar as `npm run probe`: a live board with no India or remote role is
  // not worth an hourly request. Single-word candidates get a higher bar —
  // a generic word like "LEAP" (extracted from "LEAP India" after "India" was
  // stripped as a stopword) resolved live to an unrelated company's real
  // Ashby board (ashby:leap) during this audit. One coincidental India/remote
  // role on that board would have silently attributed a stranger's job
  // listing to the wrong company — the same class of bug as the Oracle
  // tenants that looked like IBM (see ADDING-COMPANIES.md §4d). A multi-word
  // candidate's token ("leapindia") is specific enough that this is a
  // non-issue; a single common word is not.
  const keep = hits.filter((hit) => (hit.company.name.includes(' ') ? hit.relevant > 0 : hit.relevant >= 2));
  for (const hit of hits) {
    console.log(
      `  ${keep.includes(hit) ? '+' : '-'} ${hit.company.name.padEnd(24)} ${hit.company.ats.padEnd(10)} ${String(hit.total).padStart(4)} jobs, ${hit.relevant} India/remote`,
    );
  }

  console.log(`\n${hits.length} live boards, ${keep.length} with India/remote roles`);
  if (keep.length === 0) return;

  await saveCompanies([...existing, ...keep.map((hit) => hit.company)]);
  console.log(`companies.json: ${existing.length} -> ${existing.length + keep.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
