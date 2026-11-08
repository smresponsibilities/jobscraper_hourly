import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractAtsLinksFromHtml } from '../src/discovery/ats-board-resolver.js';
import { isSafeOutreachEmailSyntax } from './sync-applied-to-outreach.js';

export interface HnDiscoveredLead {
  companyHint: string;
  email: string;
  domain: string;
  atsLinks: string[];
}

export async function runLiveHnAndNewsDiscoverySweep(): Promise<{
  hnCommentsScanned: number;
  newBoardsAddedToCompaniesJson: number;
  founderEmailsDiscovered: number;
}> {
  let hnCommentsScanned = 0;
  let newBoardsAddedToCompaniesJson = 0;
  const discoveredBoards: Array<{ ats: string; slug: string; name: string }> = [];
  const founderLeads: HnDiscoveredLead[] = [];

  try {
    const searchRes = await fetch(
      'https://hn.algolia.com/api/v1/search_by_date?tags=story,ask_hn&query=Ask+HN:+Who+is+hiring&hitsPerPage=3'
    ).catch(() => null);
    if (searchRes && searchRes.ok) {
      const searchJson = (await searchRes.json().catch(() => null)) as any;
      const latestStoryId = searchJson?.hits?.[0]?.objectID;
      if (latestStoryId) {
        const threadRes = await fetch(`https://hn.algolia.com/api/v1/items/${latestStoryId}`).catch(() => null);
        if (threadRes && threadRes.ok) {
          const threadJson = (await threadRes.json().catch(() => null)) as any;
          const children = Array.isArray(threadJson?.children) ? threadJson.children : [];
          hnCommentsScanned = children.length;

          for (const comment of children) {
            const text = String(comment?.text || '');
            if (!text) continue;

            // 1. Extract any embedded Greenhouse, Ashby, Lever, SmartRecruiters, Workday links
            const links = extractAtsLinksFromHtml(text);
            for (const l of links) {
              discoveredBoards.push({
                ats: l.ats,
                slug: l.boardSlug,
                name: l.boardSlug,
              });
            }

            // 2. Extract any direct founder / hiring manager emails posted in the comment
            const plainText = text.replace(/<[^>]+>/g, ' ');
            const firstLine = plainText.split(/[|\n]/)[0]?.trim().slice(0, 50) || 'HN Startup';
            const emailMatches = plainText.matchAll(/\b([a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))\b/g);
            for (const m of emailMatches) {
              if (!m[1] || !m[2]) continue;
              const email = m[1].toLowerCase();
              const domain = m[2].toLowerCase();
              if (isSafeOutreachEmailSyntax(email) && !/gmail\.com|yahoo\.com|hotmail\.com|outlook\.com|protonmail\.com|icloud\.com/i.test(domain)) {
                founderLeads.push({
                  companyHint: firstLine,
                  email,
                  domain,
                  atsLinks: links.map((l) => l.boardUrl),
                });
              }
            }
          }
        }
      }
    }
  } catch {}

  // Merge newly discovered boards into companies.json
  if (discoveredBoards.length > 0 && fs.existsSync('companies.json')) {
    try {
      const raw = JSON.parse(fs.readFileSync('companies.json', 'utf8'));
      const isWrapper = !Array.isArray(raw) && Array.isArray(raw?.companies);
      const list: any[] = isWrapper ? raw.companies : raw;
      const sample = list[0] || { name: 'Example', ats: 'greenhouse', slug: 'example' };
      const seen = new Set(
        list.map((c) => `${String(c.ats || c.provider || '').toLowerCase()}:${String(c.slug || c.board || '').toLowerCase()}`)
      );

      for (const b of discoveredBoards) {
        const key = `${b.ats.toLowerCase()}:${b.slug.toLowerCase()}`;
        if (seen.has(key) || /^(?:stripe|avoca|ssctech|paypal)$/i.test(b.slug)) continue;
        seen.add(key);
        const entry: Record<string, unknown> = {};
        if ('name' in sample) entry.name = b.name;
        else entry.company = b.name;
        if ('ats' in sample) entry.ats = b.ats;
        else entry.provider = b.ats;
        if ('slug' in sample) entry.slug = b.slug;
        else entry.board = b.slug;
        list.push(entry);
        newBoardsAddedToCompaniesJson++;
      }

      if (newBoardsAddedToCompaniesJson > 0) {
        fs.writeFileSync('companies.json', JSON.stringify(isWrapper ? { ...raw, companies: list } : list, null, 2));
      }
    } catch {}
  }

  // Save HN Founder / HM leads for Outreach
  if (founderLeads.length > 0) {
    const outPath = path.resolve('state/outreach/hn-who-is-hiring-leads.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
      outPath,
      JSON.stringify({ updatedAt: new Date().toISOString(), count: founderLeads.length, leads: founderLeads }, null, 2)
    );
  }

  return {
    hnCommentsScanned,
    newBoardsAddedToCompaniesJson,
    founderEmailsDiscovered: founderLeads.length,
  };
}

const isDirectCli = process.argv[1] && (
  fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase() ||
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
);

if (isDirectCli) {
  runLiveHnAndNewsDiscoverySweep().then((r) => console.log('Live HN & News Discovery Sweep:', r));
}
