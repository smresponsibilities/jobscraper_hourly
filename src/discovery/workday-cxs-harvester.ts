export function buildWorkdayCxsSearchRequest(tenantUrl: string, searchText?: string): { endpointUrl: string; body: Record<string, unknown> } | null {
  try {
    const url = new URL(tenantUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const match = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i.exec(url.hostname);
    if (!match || /^(?:stripe|avoca|ssctech|paypal)(?:[-.]|$)/i.test(match[1]!)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (/^[a-z]{2}[-_][a-z]{2}$/i.test(parts[0] || '')) parts.shift();
    const site = parts[0];
    if (!site || !/^[a-z0-9._~-]+$/i.test(site) || /^(?:\.|\.\.|wday)$/i.test(site)) return null;
    return {
      endpointUrl: `https://${url.hostname}/wday/cxs/${match[1]}/${site}/jobs`,
      body: { appliedFacets: {}, limit: 20, offset: 0, searchText: searchText || 'Software Engineer India' },
    };
  } catch { return null; }
}

/** Relative labels are estimates; an open-ended 30+ label has no exact date. */
export function parseWorkdayPostedOnToIso(postedOnText: string, nowMs = Date.now()): string | null {
  if (!Number.isFinite(nowMs)) return null;
  const text = String(postedOnText || '').trim().toLowerCase().replace(/^posted\s+/, '');
  let days: number;
  if (text === 'today') days = 0;
  else if (text === 'yesterday') days = 1;
  else {
    const match = /^(\d+)\s+days?\s+ago$/.exec(text);
    if (!match) return null;
    days = Number(match[1]);
  }
  if (!Number.isSafeInteger(days) || days < 0 || days > 3650) return null;
  const date = new Date(nowMs - days * 86_400_000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
