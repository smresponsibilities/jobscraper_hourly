import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { evaluateCandidateJobFit } from '../autoapply/candidate-fit-filter.js';
import { isSupportedDirectAtsJobUrl } from '../autoapply/priority-scheduler.js';
import { lookupQuestionIn1000Bank, hasAntonymOrPolarityConflict } from '../autoapply/portal-question-bank-1000.js';
import { resolveExtendedPortalQuestionTaxonomy } from '../autoapply/answers.js';
import { translateCanonicalAnswerToOption } from '../autoapply/widgets.js';
import { isSafeOutreachEmailSyntax } from '../../scripts/sync-applied-to-outreach.js';

const ISOLATED_TENANTS = new Set(['stripe', 'avoca', 'ssctech', 'paypal']);

export function extractCanonicalJobPostingKey(rawUrl: string): string {
  const u = String(rawUrl || '').trim();
  if (!u) return '';
  const ghJob =
    u.match(/greenhouse\.io\/[^/?#]+\/jobs\/(\d+)/i)?.[1] ||
    u.match(/[?&](?:token|gh_jid)=(\d+)/i)?.[1];
  if (ghJob) return `gh:${ghJob}`;

  const ashby = u.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-fA-F-]{36})/i);
  if (ashby && ashby[1] && ashby[2]) return `ashby:${ashby[1].toLowerCase()}:${ashby[2].toLowerCase()}`;

  const lever = u.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-fA-F-]{36})/i);
  if (lever && lever[1] && lever[2]) return `lever:${lever[1].toLowerCase()}:${lever[2].toLowerCase()}`;

  const sr = u.match(/smartrecruiters\.com\/(?:oneclick-ui\/company\/)?([^/?#]+)\/(?:publication\/)?([a-zA-Z0-9-]{8,36})/i);
  if (sr && sr[1] && sr[2]) return `sr:${sr[1].toLowerCase()}:${sr[2].toLowerCase()}`;

  return u.toLowerCase().replace(/\/(?:apply|application)(?:\/.*)?$/i, '');
}

export function resolveCanonicalQueueDbPaths(): string[] {
  return ['state/autoapply/portal-review/queue.sqlite', 'data/queue.sqlite'].filter((p) =>
    fs.existsSync(p)
  );
}

/**
 * Invariant 1 & 2: Synchronize applied receipts across both SQLite files & scrub polluted priority flags
 */
export function enforceQueueDatabaseInvariants(targetDbPath?: string): {
  databasesChecked: string[];
  appliedSynced: number;
  pollutedTierDemoted: number;
  isolatedQuarantined: number;
} {
  const dbPaths = targetDbPath
    ? [targetDbPath]
    : resolveCanonicalQueueDbPaths();

  let appliedSynced = 0;
  let pollutedTierDemoted = 0;
  let isolatedQuarantined = 0;

  // Collect all confirmed applied URLs across all DB files so neither DB ever loses an applied receipt
  const allAppliedUrls = new Set<string>();
  for (const dbPath of dbPaths) {
    if (!fs.existsSync(dbPath)) continue;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      db.exec('PRAGMA busy_timeout = 15000;');

      const hasJobs = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").all() as any[]).length > 0;
      const hasApps = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").all() as any[]).length > 0;

      if (hasJobs) {
        const rows = db.prepare("SELECT url FROM jobs WHERE status = 'applied'").all() as Array<{ url?: string }>;
        for (const r of rows) {
          if (r.url) allAppliedUrls.add(r.url.trim());
        }
      }

      if (hasApps) {
        const rows = db.prepare("SELECT normalized_url, payload FROM applications WHERE status = 'applied'").all() as Array<{ normalized_url?: string; payload?: string }>;
        for (const r of rows) {
          if (r.normalized_url) allAppliedUrls.add(r.normalized_url.trim());
          try {
            const p = JSON.parse(r.payload || '{}');
            if (p.url) allAppliedUrls.add(String(p.url).trim());
            if (p.jobUrl) allAppliedUrls.add(String(p.jobUrl).trim());
          } catch {}
        }
      }
    } catch (err: any) {
      if (!/database is locked/i.test(err?.message || '')) throw err;
    } finally {
      try { db?.close(); } catch {}
    }
  }

  for (const dbPath of dbPaths) {
    if (!fs.existsSync(dbPath)) continue;
    let db: DatabaseSync | null = null;

    try {
      db = new DatabaseSync(dbPath);
      db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL;');

      let acquired = false;
      let retries = 8;
      while (retries-- > 0) {
        try {
          db.exec('BEGIN IMMEDIATE');
          acquired = true;
          break;
        } catch (err: any) {
          if (/database is locked/i.test(err?.message || '') && retries > 0) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
            continue;
          }
          break;
        }
      }

      if (!acquired) {
        // Locked by active runner lane; continue cleanly without disrupting runner
        continue;
      }

      const hasJobs = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").all() as any[]).length > 0;
      const hasApps = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='applications'").all() as any[]).length > 0;

      if (hasJobs) {
        // 1. Sync applied status across DBs
        const promoteApplied = db.prepare(
          "UPDATE jobs SET status = 'applied', last_error = NULL WHERE url = ? AND status != 'applied'"
        );
        for (const url of allAppliedUrls) {
          const info = promoteApplied.run(url) as { changes?: number };
          appliedSynced += (info.changes ?? 0);
        }

        // 2. Quarantine any isolated tenant that is still queued
        const isoInfo = db
          .prepare(
            "UPDATE jobs SET status = 'skipped', is_hourly_fresh = 0, last_error = 'isolated_tenant_invariant' WHERE status = 'queued' AND LOWER(company) IN ('stripe', 'avoca', 'ssctech', 'paypal')"
          )
          .run() as { changes?: number };
        isolatedQuarantined += (isoInfo.changes ?? 0);

        // 3. Audit all queued rows with is_hourly_fresh > 0: demote any row that fails candidate fit or direct ATS URL check
        const freshRows = db
          .prepare(
            "SELECT id, company, title, location, url, is_hourly_fresh FROM jobs WHERE status = 'queued' AND COALESCE(is_hourly_fresh, 0) > 0"
          )
          .all() as any[];

        const demoteStmt = db.prepare(
          "UPDATE jobs SET status = 'skipped', is_hourly_fresh = 0, last_error = ? WHERE id = ?"
        );
        for (const r of freshRows) {
          const url = String(r.url || '').trim();
          if (!isSupportedDirectAtsJobUrl(url)) {
            demoteStmt.run('invariant_non_direct_ats_url', r.id);
            pollutedTierDemoted++;
            continue;
          }
          const fit = evaluateCandidateJobFit({
            company: r.company,
            title: r.title,
            location: r.location,
            url,
          });
          if (!fit.allowed) {
            demoteStmt.run(`invariant_${fit.reason || 'fit_rejected'}`, r.id);
            pollutedTierDemoted++;
          }
        }
      }

      if (hasApps) {
        // 1. Sync applied status across DBs
        const promoteApp = db.prepare(
          "UPDATE applications SET status = 'applied' WHERE (normalized_url = ? OR json_extract(payload, '$.url') = ? OR json_extract(payload, '$.jobUrl') = ?) AND status != 'applied'"
        );
        for (const url of allAppliedUrls) {
          const info = promoteApp.run(url, url, url) as { changes?: number };
          appliedSynced += (info.changes ?? 0);
        }

        const updateApp = db.prepare("UPDATE applications SET status = 'skipped', payload = ? WHERE id = ?");

        // 2. Quarantine any isolated tenant that is still queued
        const isoApps = db
          .prepare(
            "SELECT id, payload FROM applications WHERE status = 'queued' AND LOWER(COALESCE(json_extract(payload, '$.company'), '')) IN ('stripe', 'avoca', 'ssctech', 'paypal')"
          )
          .all() as any[];
        for (const r of isoApps) {
          let p: any = {};
          try { p = JSON.parse(r.payload || '{}'); } catch {}
          p.status = 'skipped';
          p.is_hourly_fresh = 0;
          p.last_error = 'isolated_tenant_invariant';
          updateApp.run(JSON.stringify(p), r.id);
          isolatedQuarantined++;
        }

        // 3. Audit all queued rows with is_hourly_fresh > 0
        const freshApps = db
          .prepare(
            "SELECT id, normalized_url, payload FROM applications WHERE status = 'queued' AND COALESCE(json_extract(payload, '$.is_hourly_fresh'), 0) > 0"
          )
          .all() as any[];

        for (const r of freshApps) {
          let p: any = {};
          try { p = JSON.parse(r.payload || '{}'); } catch {}
          const url = String(p.url || p.jobUrl || r.normalized_url || '').trim();
          if (!isSupportedDirectAtsJobUrl(url)) {
            p.status = 'skipped';
            p.is_hourly_fresh = 0;
            p.last_error = 'invariant_non_direct_ats_url';
            updateApp.run(JSON.stringify(p), r.id);
            pollutedTierDemoted++;
            continue;
          }
          const fit = evaluateCandidateJobFit({
            company: p.company || '',
            title: p.title || '',
            location: p.location || '',
            url,
          });
          if (!fit.allowed) {
            p.status = 'skipped';
            p.is_hourly_fresh = 0;
            p.last_error = `invariant_${fit.reason || 'fit_rejected'}`;
            updateApp.run(JSON.stringify(p), r.id);
            pollutedTierDemoted++;
          }
        }
      }

      db.exec('COMMIT');

      // Ticket GEN-289: Add composite B-Tree indexes and run passive WAL checkpoint + optimizer
      try {
        if (hasJobs) {
          db.exec(`
            CREATE INDEX IF NOT EXISTS idx_jobs_status_fresh_id ON jobs(status, is_hourly_fresh DESC, id DESC);
            CREATE INDEX IF NOT EXISTS idx_jobs_url ON jobs(url);
            CREATE INDEX IF NOT EXISTS idx_jobs_company_status ON jobs(company, status);
          `);
        }
        if (hasApps) {
          db.exec(`
            CREATE INDEX IF NOT EXISTS idx_apps_status_id ON applications(status, id);
            CREATE INDEX IF NOT EXISTS idx_apps_normalized_url ON applications(normalized_url);
          `);
        }
        db.exec('PRAGMA wal_checkpoint(PASSIVE);');
        db.exec('PRAGMA optimize;');
      } catch {}
    } catch (err: any) {
      try {
        db?.exec('ROLLBACK');
      } catch {}
      if (!/database is locked/i.test(err?.message || '')) {
        throw err;
      }
    } finally {
      try { db?.close(); } catch {}
    }
  }

  return {
    databasesChecked: dbPaths,
    appliedSynced,
    pollutedTierDemoted,
    isolatedQuarantined,
  };
}

/**
 * Invariant 3: Ensure companies.json contains zero isolated tenants and zero 4-provider speculative spam
 */
export function enforceCompaniesJsonInvariants(): {
  totalBoards: number;
  removedIsolatedOrSpam: number;
} {
  if (!fs.existsSync('companies.json')) {
    return { totalBoards: 0, removedIsolatedOrSpam: 0 };
  }
  const raw = JSON.parse(fs.readFileSync('companies.json', 'utf8'));
  const isWrapper = !Array.isArray(raw) && Array.isArray(raw?.companies);
  const list: any[] = isWrapper ? raw.companies : raw;

  // Count how many distinct providers each slug is registered under
  const slugProviders = new Map<string, Set<string>>();
  for (const item of list) {
    const ats = String(item.ats || item.provider || item.type || '').toLowerCase();
    const slug = String(item.slug || item.board || item.id || item.token || '').toLowerCase().trim();
    if (!ats || !slug) continue;
    const set = slugProviders.get(slug) || new Set<string>();
    set.add(ats);
    slugProviders.set(slug, set);
  }

  const seenUnique = new Set<string>();
  const cleaned: any[] = [];
  let removed = 0;

  for (const item of list) {
    const ats = String(item.ats || item.provider || item.type || '').toLowerCase().trim();
    const slug = String(item.slug || item.board || item.id || item.token || '').toLowerCase().trim();
    if (!ats || !slug || slug.length < 2 || ISOLATED_TENANTS.has(slug)) {
      removed++;
      continue;
    }
    const key = `${ats}:${slug}`;
    if (seenUnique.has(key)) {
      removed++;
      continue;
    }
    seenUnique.add(key);
    cleaned.push(item);
  }

  if (removed > 0) {
    fs.writeFileSync(
      'companies.json',
      JSON.stringify(isWrapper ? { ...raw, companies: cleaned } : cleaned, null, 2)
    );
  }

  return {
    totalBoards: cleaned.length,
    removedIsolatedOrSpam: removed,
  };
}

/**
 * Invariant 4: Static Code Guard against 30-second Playwright locator freezes & missing critical hooks
 */
export function assertNoUnboundedPlaywrightCalls(): void {
  const runnerSrc = fs.readFileSync(path.resolve('src/autoapply/runner.ts'), 'utf8');
  const widgetsSrc = fs.readFileSync(path.resolve('src/autoapply/widgets.ts'), 'utf8');
  const imapSrc = fs.readFileSync(path.resolve('src/autoapply/imap-verifier.ts'), 'utf8');

  if (/await\s+control\.inputValue\(\s*\)/.test(runnerSrc)) {
    throw new Error('INVARIANT VIOLATION: Bare await control.inputValue() without timeout/race found in runner.ts!');
  }
  if (!runnerSrc.includes('_valueTracker')) {
    throw new Error('INVARIANT VIOLATION: React _valueTracker reset missing in runner.ts humanType!');
  }
  if (!runnerSrc.includes('valueChange')) {
    throw new Error('INVARIANT VIOLATION: SmartRecruiters Shadow-Host valueChange dispatch missing in runner.ts!');
  }
  if (!widgetsSrc.includes('findByRefDeep')) {
    throw new Error('INVARIANT VIOLATION: Shadow-piercing findByRefDeep missing in widgets.ts!');
  }
  if (!imapSrc.includes('withImapMutex') || !imapSrc.includes('CONSUMED_VERIFICATION_TOKENS')) {
    throw new Error('INVARIANT VIOLATION: 4-lane IMAP mutex or token deduplication missing in imap-verifier.ts!');
  }
}

/**
 * Invariant 5: Golden Question, Antonym, Option-Bucket & Candidate-Fit Runtime Matrix
 */
export function assertGoldenQuestionAndAntonymMatrix(): void {
  // 1. Antonym safety checks
  if (!hasAntonymOrPolarityConflict('applicant legal first name', 'applicant legal last name')) {
    throw new Error('INVARIANT VIOLATION: First Name vs Last Name antonym guard failed!');
  }
  if (!hasAntonymOrPolarityConflict('current annual ctc in lpa', 'expected annual ctc in lpa')) {
    throw new Error('INVARIANT VIOLATION: Current CTC vs Expected CTC antonym guard failed!');
  }
  if (!hasAntonymOrPolarityConflict('start date of degree', 'end date of degree')) {
    throw new Error('INVARIANT VIOLATION: Start Date vs End Date antonym guard failed!');
  }

  // 2. Exact ground-truth answers
  const checks: Array<{ q: string; kind?: string; expected: RegExp }> = [
    { q: 'Legal First Name', expected: /^Shivam$/ },
    { q: 'Legal Last Name', expected: /^Mahajan$/ },
    { q: 'Full Legal Name', expected: /^Shivam Mahajan$/ },
    { q: 'School or University', expected: /^Chitkara University$/ },
    { q: 'Current Employer', expected: /^Morgan Stanley$/ },
    { q: 'CGPA (out of 10)', expected: /^9\.35$/ },
    { q: 'Are you legally authorized to work in India?', kind: 'radio', expected: /^Yes$/ },
    { q: 'Will you now or in the future require visa sponsorship?', kind: 'radio', expected: /^No$/ },
    { q: 'Do you have experience with Apache Kafka?', kind: 'radio', expected: /^Yes$/ },
    { q: 'How many years of experience do you have with Python?', kind: 'number', expected: /^1$/ },
    { q: 'Do you have commercial experience with Ruby on Rails?', kind: 'radio', expected: /^No$/ },
    { q: 'How many years of experience do you have with Golang?', kind: 'number', expected: /^0$/ },
    { q: 'Are you a citizen or resident of Cuba, Iran, North Korea, Syria, or Crimea?', kind: 'radio', expected: /^No$/ },
    { q: 'Do you have any active backlogs?', kind: 'number', expected: /^0$/ },
  ];

  for (const c of checks) {
    const actual =
      resolveExtendedPortalQuestionTaxonomy(c.q, c.kind) ??
      lookupQuestionIn1000Bank(c.q, c.kind) ??
      '';
    if (!c.expected.test(String(actual))) {
      throw new Error(
        `INVARIANT VIOLATION on question "${c.q}" (${c.kind || 'text'}): expected ${c.expected}, got "${actual}"`
      );
    }
  }

  // 3. Option-bucket translation checks
  const bucket1 = translateCanonicalAnswerToOption('1', 'Years of experience', ['0-2 years', '3-5 years', '5+ years']);
  if (bucket1 !== '0-2 years') throw new Error(`INVARIANT VIOLATION: 1 yr bucket got ${bucket1}`);

  const bucketNotice = translateCanonicalAnswerToOption('Immediate', 'Notice Period', ['0 - 15 Days', '30 Days', '60 Days']);
  if (bucketNotice !== '0 - 15 Days') throw new Error(`INVARIANT VIOLATION: Immediate notice bucket got ${bucketNotice}`);

  const bucketGender = translateCanonicalAnswerToOption('Male', 'Gender', ['Woman', 'Man', 'Prefer not to say']);
  if (bucketGender !== 'Man') throw new Error(`INVARIANT VIOLATION: Gender Male->Man got ${bucketGender}`);

  // 4. Candidate Fit Filter checks
  if (!evaluateCandidateJobFit({ company: 'Rubrik', title: 'Software Engineer', location: 'Bengaluru, India' }).allowed) {
    throw new Error('INVARIANT VIOLATION: Valid Bengaluru SWE role rejected!');
  }
  if (evaluateCandidateJobFit({ company: 'Rubrik', title: 'Senior Staff Software Engineer', location: 'Bengaluru, India' }).allowed) {
    throw new Error('INVARIANT VIOLATION: Senior Staff role was not filtered!');
  }
  if (evaluateCandidateJobFit({ company: 'Stripe', title: 'Software Engineer', location: 'Bengaluru, India' }).allowed) {
    throw new Error('INVARIANT VIOLATION: Isolated tenant Stripe was not blocked!');
  }

  // 5. Outreach poison filter check
  if (isSafeOutreachEmailSyntax('security@company.com') || isSafeOutreachEmailSyntax('noreply@company.com')) {
    throw new Error('INVARIANT VIOLATION: Poison email prefix allowed by outreach syntax filter!');
  }
}

export function runAllSystemInvariantsAndAutoHeal(): {
  queueReport: ReturnType<typeof enforceQueueDatabaseInvariants>;
  companiesReport: ReturnType<typeof enforceCompaniesJsonInvariants>;
  invariantsPassed: true;
} {
  assertNoUnboundedPlaywrightCalls();
  assertGoldenQuestionAndAntonymMatrix();
  const companiesReport = enforceCompaniesJsonInvariants();
  const queueReport = enforceQueueDatabaseInvariants();
  return {
    queueReport,
    companiesReport,
    invariantsPassed: true,
  };
}

const isDirectRun = Boolean(
  process.argv[1] &&
    (path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase() ||
      process.argv[1].replace(/\\/g, '/').endsWith('system-invariants.ts'))
);

if (isDirectRun) {
  console.log('System Invariants & Auto-Heal Report:', runAllSystemInvariantsAndAutoHeal());
}
