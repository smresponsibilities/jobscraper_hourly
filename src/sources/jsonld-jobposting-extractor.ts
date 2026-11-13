import { toPlainText } from '../fetchers/util.js';

export interface SchemaOrgJobPosting { title: string; company: string; location: string; datePosted?: string; validThrough?: string; description: string; directApplyUrl: string; isRemote: boolean }

export function extractSchemaOrgJobPostingsFromHtml(html: string, pageUrl = ''): SchemaOrgJobPosting[] {
  const output: SchemaOrgJobPosting[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const entry of value) visit(entry); return; }
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, any>;
    if (obj['@graph']) visit(obj['@graph']);
    const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
    if (!types.some((type: unknown) => typeof type === 'string' && /(?:^|\/)JobPosting$/i.test(type))) return;
    const locations = Array.isArray(obj.jobLocation) ? obj.jobLocation : [obj.jobLocation];
    const location = locations.flatMap((item: any) => {
      const address = item?.address || {};
      return [address.addressLocality, address.addressRegion, typeof address.addressCountry === 'string' ? address.addressCountry : address.addressCountry?.name].filter((part): part is string => typeof part === 'string' && !!part.trim()).join(', ');
    }).filter(Boolean).join('; ');
    const clean = (v: unknown) => typeof v === 'string' ? toPlainText(v) : '';
    let directApplyUrl = typeof obj.url === 'string' ? obj.url : typeof obj.sameAs === 'string' ? obj.sameAs : pageUrl;
    try { const parsed = new URL(directApplyUrl, pageUrl || undefined); directApplyUrl = /^https?:$/.test(parsed.protocol) ? parsed.href : ''; } catch { directApplyUrl = ''; }
    output.push({ title: clean(obj.title), company: clean(obj.hiringOrganization?.name), location, datePosted: typeof obj.datePosted === 'string' ? obj.datePosted : undefined, validThrough: typeof obj.validThrough === 'string' ? obj.validThrough : undefined, description: clean(obj.description), directApplyUrl, isRemote: obj.jobLocationType === 'TELECOMMUTE' });
  };
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)(?:\s|$)/i.test(match[1]!.trim())) continue;
    try { visit(JSON.parse(match[2]!)); } catch { /* Ignore malformed independent blocks. */ }
  }
  return output;
}
