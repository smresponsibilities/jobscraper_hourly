import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  pickRoleTailoredProjectsSummary,
  canSendOutreachToTarget,
  loadOutreachLedger,
} from '../src/outreach/outreach-ledger.js';

export const POISON_EMAIL_PREFIXES = new Set([
  'security',
  'privacy',
  'legal',
  'abuse',
  'dmca',
  'compliance',
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'hostmaster',
  'webmaster',
  'billing',
  'sales',
  'support',
  'help',
  'press',
  'media',
  'investor',
  'ir',
  'unsubscribe',
  'bounce',
]);

export function isSafeOutreachEmailSyntax(email: string): boolean {
  const cleaned = String(email || '').trim().toLowerCase();
  const match = cleaned.match(/^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/);
  if (!match || !match[1] || !match[2]) return false;
  const localPart = match[1];
  const domain = match[2];
  const normalizedPrefix = localPart.split('+')[0] || '';
  if (POISON_EMAIL_PREFIXES.has(normalizedPrefix)) return false;
  if (/^(?:security|privacy|legal|abuse|noreply|no-reply|donotreply)/i.test(localPart)) return false;
  if (/(?:example\.com|test\.com|localhost|sentry\.io|greenhouse\.io|ashbyhq\.com|lever\.co|myworkdayjobs\.com)$/i.test(domain)) {
    return false;
  }
  return true;
}

export async function verifyDomainHasMx(domain: string): Promise<boolean> {
  try {
    const records = await dns.promises.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

export function composeAppliedFollowUpPitch(company: string, roleTitle: string): {
  subject: string;
  body: string;
} {
  const cleanCompany = company.trim() || 'your engineering team';
  const cleanRole = roleTitle.trim() || 'Software Engineer';
  const tailoredProjects = pickRoleTailoredProjectsSummary(cleanRole);
  return {
    subject: `Applied: ${cleanRole} at ${cleanCompany} — Shivam Mahajan (Morgan Stanley / 9.35 CGPA)`,
    body: [
      `Hi ${cleanCompany} Engineering & Recruiting Team,`,
      ``,
      `I just submitted my application for the ${cleanRole} role at ${cleanCompany} and wanted to share a brief summary of my background:`,
      ``,
      `• Morgan Stanley (Technology Apprentice, Bengaluru): Engineered Customer Identity & Access Management (CIAM) data warehouse pipelines using Apache Kafka, PySpark, Apache Spark, Hive, and Azure Snowflake (processing 5,000,000+ events with zero row-count tolerance, secured with mTLS/OAuth 2.0/RBAC) and built distributed Java Spring Boot REST APIs.`,
      `• Engineering Projects (https://shivammahajan.com/projects/): ${tailoredProjects}.`,
      `• Education & Consistency: B.E. CSE at Chitkara University (9.35 / 10.0 CGPA), 1,255+ consecutive days of code, and 2,600+ algorithmic problems solved.`,
      ``,
      `I am based in Bengaluru, can start immediately, and would love to chat if my background aligns with what you are building at ${cleanCompany}.`,
      ``,
      `Best regards,`,
      `Shivam Mahajan`,
      `Portfolio: https://shivammahajan.com`,
      `LinkedIn: https://www.linkedin.com/in/mahajanshivam`,
      `GitHub: https://github.com/smresponsibilities`,
    ].join('\n'),
  };
}

export function syncAppliedJobsToOutreachTargets(dbPath?: string): number {
  const resolvedDbPath = dbPath || (fs.existsSync('state/autoapply/portal-review/queue.sqlite')
    ? 'state/autoapply/portal-review/queue.sqlite'
    : 'data/queue.sqlite');

  if (!fs.existsSync(resolvedDbPath)) return 0;

  const ledger = loadOutreachLedger();
  let db: DatabaseSync | null = null;
  const targets: any[] = [];
  try {
    db = new DatabaseSync(resolvedDbPath, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 15000;');

    const hasAppsTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").all() as any[]).length > 0;
    const hasJobsTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").all() as any[]).length > 0;

    if (hasAppsTable) {
      const rows = db.prepare("SELECT id, normalized_url, payload FROM applications WHERE status = 'applied' ORDER BY rowid DESC").all() as any[];
      for (const r of rows) {
        try {
          const p = JSON.parse(r.payload);
          const comp = p.company || 'Company';
          const title = p.title || 'Software Engineer';
          const pitch = composeAppliedFollowUpPitch(comp, title);
          const eligibility = canSendOutreachToTarget('', comp, ledger);
          targets.push({
            id: r.id,
            company: comp,
            title,
            jobUrl: p.jobUrl || r.normalized_url,
            appliedAt: p.appliedAt || new Date().toISOString(),
            subject: pitch.subject,
            body: pitch.body,
            canSend: eligibility.allowed,
            cooldownReason: eligibility.reason,
          });
        } catch {}
      }
    } else if (hasJobsTable) {
      const rows = db.prepare("SELECT company, title, url FROM jobs WHERE status = 'applied'").all() as any[];
      for (const r of rows) {
        const comp = r.company || 'Company';
        const title = r.title || 'Software Engineer';
        const pitch = composeAppliedFollowUpPitch(comp, title);
        const eligibility = canSendOutreachToTarget('', comp, ledger);
        targets.push({
          company: comp,
          title,
          jobUrl: r.url,
          appliedAt: new Date().toISOString(),
          subject: pitch.subject,
          body: pitch.body,
          canSend: eligibility.allowed,
          cooldownReason: eligibility.reason,
        });
      }
    }
  } catch (err: any) {
    if (!/database is locked/i.test(err?.message || '')) {
      console.warn('[OUTREACH SYNC NOTICE]', err?.message || err);
    }
  } finally {
    try { db?.close(); } catch {}
  }

  const outPath = path.resolve('state/autoapply/applied-outreach-targets.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ updatedAt: new Date().toISOString(), count: targets.length, targets }, null, 2), 'utf8');
  return targets.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  const count = syncAppliedJobsToOutreachTargets();
  console.log(`Synced ${count} verified applied jobs to state/autoapply/applied-outreach-targets.json`);
}
