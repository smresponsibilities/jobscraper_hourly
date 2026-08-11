import type { Job } from './types.js';
import { EMAIL_DETAIL_LIMIT } from './config.js';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TECH_INDUSTRIES = new Set(['tech', 'fintech']);

function experienceLabel(job: Job): string {
  if (job.isIntern) return 'Internship';
  if (job.minYears === null) return 'Experience not stated';
  if (job.maxYears !== null) return `${job.minYears}–${job.maxYears} yrs`;
  return `${job.minYears}+ yrs`;
}

/**
 * Applying early measurably matters, so freshness goes on the card. Workday and
 * Amazon return relative strings ("Posted Today") rather than timestamps, so
 * anything unparseable is passed through as-is instead of being dropped.
 */
function freshness(job: Job): string | undefined {
  if (!job.postedAt) return undefined;
  const posted = new Date(job.postedAt).getTime();
  if (Number.isNaN(posted)) return job.postedAt.replace(/^posted\s*/i, '') || undefined;

  const hours = Math.floor((Date.now() - posted) / 3_600_000);
  if (hours < 1) return 'just posted';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

function card(job: Job): string {
  const meta = [job.location, experienceLabel(job), freshness(job), job.salary]
    .filter((value): value is string => Boolean(value))
    .map(escape);
  return `
    <tr><td style="padding:14px 0;border-bottom:1px solid #e8e8ea;">
      <a href="${escape(job.url)}" style="font-size:15px;font-weight:600;color:#0b57d0;text-decoration:none;">${escape(job.title)}</a>
      <div style="font-size:13px;color:#444;margin-top:3px;">${escape(job.company)}</div>
      <div style="font-size:12px;color:#777;margin-top:3px;">${meta.join(' &middot; ')}</div>
    </td></tr>`;
}

function compactLine(job: Job): string {
  return `
    <tr><td style="padding:5px 0;font-size:13px;color:#444;">
      <a href="${escape(job.url)}" style="color:#0b57d0;text-decoration:none;">${escape(job.title)}</a>
      &middot; ${escape(job.company)} &middot; <span style="color:#888;">${escape(job.location)}</span>
    </td></tr>`;
}

function section(title: string, jobs: Job[], detailBudget: number): string {
  if (jobs.length === 0) return '';
  const detailed = jobs.slice(0, detailBudget);
  const compact = jobs.slice(detailBudget);

  return `
    <tr><td style="padding-top:26px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#666;">
      ${escape(title)} (${jobs.length})
    </td></tr>
    <tr><td><table width="100%" cellpadding="0" cellspacing="0">${detailed.map(card).join('')}</table></td></tr>
    ${
      compact.length
        ? `<tr><td style="padding-top:12px;font-size:12px;color:#888;">${compact.length} more:</td></tr>
           <tr><td><table width="100%" cellpadding="0" cellspacing="0">${compact.map(compactLine).join('')}</table></td></tr>`
        : ''
    }`;
}

export function subject(jobs: Job[]): string {
  const tech = jobs.filter((j) => TECH_INDUSTRIES.has(j.industry)).length;
  const finance = jobs.length - tech;
  const parts = [tech && `${tech} tech`, finance && `${finance} finance`].filter(Boolean);
  return `${jobs.length} new role${jobs.length === 1 ? '' : 's'} · ${parts.join(', ')}`;
}

/**
 * Everything found is rendered. The first N get full cards and the remainder
 * become one-liners — truncating outright would lose them permanently, because
 * they're already written to seen.json and will never alert again.
 */
export function renderEmail(jobs: Job[]): string {
  const tech = jobs.filter((j) => TECH_INDUSTRIES.has(j.industry));
  const finance = jobs.filter((j) => !TECH_INDUSTRIES.has(j.industry));

  const techBudget = Math.max(1, Math.round((EMAIL_DETAIL_LIMIT * tech.length) / jobs.length));

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f6f7;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f7;padding:24px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border-radius:10px;padding:26px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="font-size:19px;font-weight:700;color:#111;">${jobs.length} new role${jobs.length === 1 ? '' : 's'}</td></tr>
        <tr><td style="font-size:13px;color:#777;padding-top:4px;">India &amp; remote &middot; up to 3 years &middot; internships included</td></tr>
        ${section('Tech · Data · ML', tech, techBudget)}
        ${section('Finance · Consulting · Quant', finance, EMAIL_DETAIL_LIMIT - techBudget)}
        <tr><td style="padding-top:26px;font-size:11px;color:#aaa;border-top:1px solid #eee;">
          jobscraper-next &middot; tune filters in <code>src/config.ts</code>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
