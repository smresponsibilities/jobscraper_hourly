import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 3600; // Cache for 1 hour

const APP_ID = '45BWZJ1SGC';
const FALLBACK_KEY =
  'NWQwZTA5MDY0MGZhYTg5ZDQ4MzhjNGMzMWM1YzA0YmM3ZjAxODIzYmMzNmRkMTA3N2RiYjAwNDRhM2UzODFhMGFuYWx5dGljc1RhZ3M9eWNkYyZyZXN0cmljdEluZGljZXM9WUNDb21wYW55X3Byb2R1Y3Rpb24lMkNZQ0NvbXBhbnlfQnlfTGF1bmNoX0RhdGVfcHJvZHVjdGlvbiZ0YWdGaWx0ZXJzPSU1QiUyMnljZGNfcHVibGljJTIyJTVEJnZhbGlkVW50aWw9MTc5MzIxMDUxOQ==';
const INDEX = 'YCCompany_production';
const HITS_PER_PAGE = 1000;

export interface YCCompany {
  name: string;
  website: string;
  batch: string;
  domain: string;
}

async function getAlgoliaKey(): Promise<string> {
  try {
    const res = await fetch('https://www.ycombinator.com/companies', {
      next: { revalidate: 3600 },
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return FALLBACK_KEY;
    const html = await res.text();
    const optsMatch = html.match(/AlgoliaOpts\s*=\s*(\{.+?\});/);
    if (optsMatch && optsMatch[1]) {
      try {
        const opts = JSON.parse(optsMatch[1]);
        if (typeof opts.key === 'string' && opts.key) return opts.key;
      } catch {
        // ignore and continue
      }
    }
    const keyMatch = html.match(/"key"\s*:\s*"([^"]+)"/);
    if (keyMatch && keyMatch[1]) return keyMatch[1];

    const match = html.match(/"([A-Za-z0-9+/=_-]{150,300})"/);
    if (match && match[1]) return match[1];
  } catch {
    // network or parse error, use fallback
  }
  return FALLBACK_KEY;
}

export async function GET() {
  try {
    const key = await getAlgoliaKey();
    const out: YCCompany[] = [];
    const seen = new Set<string>();

    for (let page = 0; ; page++) {
      const params = new URLSearchParams({
        query: '',
        hitsPerPage: String(HITS_PER_PAGE),
        page: String(page),
        facetFilters: JSON.stringify([['regions:India']]),
      });

      const res = await fetch(`https://${APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`, {
        method: 'POST',
        headers: {
          'x-algolia-application-id': APP_ID,
          'x-algolia-api-key': key,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ requests: [{ indexName: INDEX, params: params.toString() }] }),
        next: { revalidate: 3600 },
      });

      if (!res.ok) {
        throw new Error(`Algolia query failed: ${res.status}`);
      }

      const result = (
        (await res.json()) as {
          results: { hits: { name?: string; website?: string; batch?: string; status?: string }[]; nbPages: number }[];
        }
      ).results[0];
      if (!result) break;

      for (const hit of result.hits) {
        if (!hit.name || !hit.website || hit.status !== 'Active') continue;
        const domain = hit.website
          .replace(/^https?:\/\//i, '')
          .replace(/^www\./i, '')
          .split(/[/?#]/)[0]!
          .trim()
          .toLowerCase();
        if (!domain.includes('.') || seen.has(domain)) continue;
        seen.add(domain);
        out.push({ name: hit.name, website: `https://${domain}`, batch: hit.batch ?? '', domain });
      }

      if (page + 1 >= result.nbPages) break;
    }

    return NextResponse.json(out, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to fetch YC companies' }, { status: 500 });
  }
}
