import { NextRequest, NextResponse } from 'next/server';

/**
 * Hosted click-API for the deployed outreach page (PHASES.md: "deployed cold
 * emailer"). Mirrors the localhost server's routes in src/outreach.ts — same
 * bookkeeping (touch counters, follow-up gaps, flags), different transport:
 * state lives in the repo's `state/contacted.json`, written through the
 * GitHub Contents API with a fine-grained token. Nothing here speaks SMTP.
 *
 * Requires Vercel env vars:
 *   OUTREACH_GH_TOKEN  — token with Contents read/write on OUTREACH_REPO
 *   OUTREACH_REPO      — "owner/repo" (falls back to NEXT_PUBLIC_REPO)
 */

const REPO = process.env.OUTREACH_REPO ?? process.env.NEXT_PUBLIC_REPO ?? '';
const BRANCH = process.env.OUTREACH_BRANCH ?? 'main';
/** Same cadence as TOUCH_GAPS in src/outreach.ts — keep in sync. */
const GAPS = [0, 4, 9, 16];

interface ContactState {
  company?: string;
  role?: string;
  touch: number;
  sentAt: string[];
  nextDueAt: string;
  subject?: string;
  replied?: boolean;
  skipped?: boolean;
  bounced?: boolean;
  bouncedAt?: string;
}
type OutreachState = Record<string, ContactState>;

interface DraftRef {
  gmailUrl: string;
  mailtoUrl: string;
}

async function gh(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.OUTREACH_GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
}

async function getJson<T>(path: string): Promise<{ data: T | null; sha: string | null }> {
  const res = await gh(`${path}?ref=${BRANCH}`);
  if (!res.ok) return { data: null, sha: null };
  const j = (await res.json()) as { content?: string; sha: string };
  const data = j.content ? (JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')) as T) : null;
  return { data, sha: j.sha };
}

async function putJson(path: string, data: unknown, sha: string | null): Promise<boolean> {
  const res = await gh(path, {
    method: 'PUT',
    body: JSON.stringify({
      message: `outreach: click update [skip ci]`,
      content: Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').toString('base64'),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  return res.ok;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ action: string; id?: string[] }> },
) {
  if (!REPO || !process.env.OUTREACH_GH_TOKEN) {
    return new Response('outreach API not configured (missing OUTREACH_GH_TOKEN / REPO)', { status: 500 });
  }
  const { action, id: idParts } = await params;
  const id = idParts?.[0];
  if (!id) return new Response('missing id', { status: 400 });

  const [{ data: drafts }, { data: state, sha }] = await Promise.all([
    getJson<{ [id: string]: DraftRef }>('/contents/web/public/outreach/batch.json'),
    getJson<OutreachState>('/contents/state/contacted.json'),
  ]);
  if (!state || !drafts) return new Response('batch or state unavailable — rebuild the batch first', { status: 409 });

  const now = new Date().toISOString();

  if (action === 'open' || action === 'mailapp') {
    const draft = drafts[id];
    if (!draft) return new Response('draft not in current batch', { status: 404 });
    const prev = state[id];
    const touch = Math.min((prev?.touch ?? 0) + 1, GAPS.length);
    state[id] = {
      ...prev,
      touch,
      sentAt: [...(prev?.sentAt ?? []), now],
      nextDueAt: new Date(Date.now() + (GAPS[touch - 1] ?? 16) * 86_400_000).toISOString(),
      company: prev?.company,
      role: prev?.role,
    };
    await putJson('/contents/state/contacted.json', state, sha);
    return NextResponse.redirect(action === 'open' ? draft.gmailUrl : draft.mailtoUrl, 302);
  }

  if (action === 'replied' || action === 'skip' || action === 'bounce') {
    const cur = state[id];
    if (!cur) return new Response('unknown contact', { status: 404 });
    if (action === 'bounce') Object.assign(cur, { bounced: true, skipped: true, bouncedAt: now });
    else cur[action === 'replied' ? 'replied' : 'skipped'] = true;
    await putJson('/contents/state/contacted.json', state, sha);
    return NextResponse.redirect(new URL('/outreach/today.html', req.url), 302);
  }

  return new Response('unknown action', { status: 400 });
}
