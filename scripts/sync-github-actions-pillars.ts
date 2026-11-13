// scripts/sync-github-actions-pillars.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { canonicalRequisition } from '../src/autoapply/identity.js';
import { isStrictlyIsolatedTenant, isEligibleEngineeringRoleTitle } from '../src/autoapply/priority-scheduler.js';
import { employerPublishedAt, isEmployerHourlyFresh } from '../src/sources/realtime-ats-delta-fetcher.js';
import { filterAndDeduplicateDiscoveredJobs } from '../src/discovery/sync-github-discoveries.js';
import { computeRoleDedupSignature } from '../src/autoapply/role-dedup-shield.js';

export interface PillarSyncResult {
  fetched: boolean;
  officesSynced: boolean;
  companiesSynced: boolean;
  newJobsIngested: number;
}

/**
 * Safely fetches origin/main in the background without modifying or conflicting
 * with the local working directory, and synchronizes the 7 GitHub Actions workflows:
 * - Pillar 1: hunt.yml (fresh job snapshots)
 * - Pillar 2: outreach.yml (outreach leads queue)
 * - Pillar 3: discover.yml & Pillar 4: discover-news.yml (new company boards)
 * - Pillar 5: yc-daily.yml (YC discovery)
 * - Pillar 6: office-directory.yml (verified Bengaluru/India offices)
 * - Pillar 7: scrapling-check.yml (stealth checkpoints)
 */
export async function syncGitHubActionsPillars(
  sqlitePath = 'state/autoapply/portal-review/queue.sqlite'
): Promise<PillarSyncResult> {
  const result: PillarSyncResult = {
    fetched: false,
    officesSynced: false,
    companiesSynced: false,
    newJobsIngested: 0,
  };

  // 1. Safe non-conflicting background fetch
  try {
    execSync('git fetch origin +refs/heads/main:refs/remotes/origin/main +refs/heads/data:refs/remotes/origin/data', {
      timeout: 25000,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    result.fetched = true;
  } catch {
    // Network offline or git timeout — proceed with local cache
    return result;
  }

  // 2. Sync verified India/Bengaluru offices from office-directory.yml (web/public/data/offices.json)
  try {
    const remoteOfficesRaw = execSync('git show origin/main:web/public/data/offices.json', {
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    if (remoteOfficesRaw && remoteOfficesRaw.trim().startsWith('{')) {
      const localOfficesPath = path.resolve('web/public/data/offices.json');
      fs.mkdirSync(path.dirname(localOfficesPath), { recursive: true });
      fs.writeFileSync(localOfficesPath, remoteOfficesRaw, 'utf8');
      result.officesSynced = true;
    }
  } catch {}

  // 3. Sync newly discovered company boards from discover.yml / discover-news.yml
  try {
    const remoteCompaniesRaw = execSync('git show origin/main:companies.json', {
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    if (remoteCompaniesRaw && remoteCompaniesRaw.trim().startsWith('{')) {
      const localCompaniesPath = path.resolve('companies.json');
      const remoteData = JSON.parse(remoteCompaniesRaw);
      let localData: any = {};
      if (fs.existsSync(localCompaniesPath)) {
        try {
          localData = JSON.parse(fs.readFileSync(localCompaniesPath, 'utf8'));
        } catch {}
      }

      // Merge newly added companies from origin/main
      let merged = false;
      for (const key of Object.keys(remoteData)) {
        if (!localData[key]) {
          localData[key] = remoteData[key];
          merged = true;
        }
      }
      if (merged) {
        fs.writeFileSync(localCompaniesPath, JSON.stringify(localData, null, 2), 'utf8');
        result.companiesSynced = true;
      }
    }
  } catch {}

  // 4. Ingest newly hunted jobs from hunt.yml into queue.sqlite
  const resolvedDbPath = path.resolve(sqlitePath);
  if (fs.existsSync(resolvedDbPath)) {
    try {
      const db = new DatabaseSync(resolvedDbPath);
      try {
      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO applications (candidate_id, id, canonical_key, normalized_url, status, payload)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      // Read candidateId
      const firstRow = db.prepare('SELECT candidate_id FROM applications LIMIT 1').get() as any;
      const candidateId = firstRow?.candidate_id || 'default_candidate';

      // Check for remote data/jobs or daily postings files if available (origin/data:jobs.json or origin/main:data/normalized-jobs.json)
      let remotePostingsRaw: string | null = null;
      for (const gitRef of ['origin/data:jobs.json', 'origin/main:data/normalized-jobs.json']) {
        try {
          remotePostingsRaw = execSync(`git show ${gitRef}`, {
            timeout: 30000,
            maxBuffer: 50 * 1024 * 1024, // jobs.json can exceed 8 MB — default 1 MB causes ENOBUFS → silent 0-ingest
            stdio: ['ignore', 'pipe', 'ignore'],
            encoding: 'utf8',
          });
          if (remotePostingsRaw && remotePostingsRaw.trim()) break;
        } catch {
          remotePostingsRaw = null;
        }
      }

      if (remotePostingsRaw) {
        try {
          const jobs = JSON.parse(remotePostingsRaw);
          if (Array.isArray(jobs)) {
            const applied = new Map<string, number>();
            const appliedRows = db.prepare("SELECT payload FROM applications WHERE candidate_id=? AND status='applied'").all(candidateId) as Array<{ payload: string }>;
            for (const row of appliedRows) {
              const previous = JSON.parse(row.payload);
              const signature = computeRoleDedupSignature(previous.company || '', previous.title || '');
              if (!signature) continue;
              const stamp = Date.parse(previous.appliedAt || previous.receipt?.verifiedAt || '');
              const old = applied.get(signature);
              applied.set(signature, old === undefined ? stamp : !Number.isFinite(old) || !Number.isFinite(stamp) ? NaN : Math.max(old, stamp));
            }
            const discovered = jobs.filter(j => j && typeof j === 'object').map(j => ({
              url: j.url || j.jobUrl, company: j.company, title: j.title, location: j.location,
              jdText: j.text || j.description,
              publishedAt: employerPublishedAt({ publishedAt: j.publishedAt, postedAt: j.postedAt || j.firstSeen || j.lastSeen, first_published: j.first_published, published_at: j.published_at, published_on: j.published_on, published_date: j.published_date, releasedDate: j.releasedDate }),
            }));
            const publicationByUrl = new Map<string, string>();
            for (const raw of discovered) {
              if (typeof raw.url !== 'string' || !URL.canParse(raw.url) || !raw.publishedAt) continue;
              const url = new URL(raw.url).href;
              const previous = publicationByUrl.get(url);
              if (!previous || Date.parse(raw.publishedAt) > Date.parse(previous)) publicationByUrl.set(url, raw.publishedAt);
            }
            for (const j of filterAndDeduplicateDiscoveredJobs(discovered, applied)) {
              const url = j.url;
              const company = j.company || '';
              const title = j.title || '';
              if (!url || isStrictlyIsolatedTenant(company, url)) continue;
              if (!isEligibleEngineeringRoleTitle(title).eligible) continue;

              const req = canonicalRequisition(url);
              const canonicalKey = req ? req.key : url;
              const id = `hunt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              const nowIso = new Date().toISOString();
              const publishedAt = publicationByUrl.get(url);
              const payloadObj = {
                id,
                title,
                company,
                jobUrl: url,
                provider: j.provider,
                ats: j.provider,
                location: j.location,
                status: 'queued',
                postedAt: publishedAt || '',
                canonicalKey,
                isHourlyFresh: isEmployerHourlyFresh(publishedAt),
                discoveredAt: nowIso,
                hourlySource: 'github_hunt' as const,
              };
              const payload = JSON.stringify(payloadObj);

              const res = insertStmt.run(candidateId, id, canonicalKey, url, 'queued', payload);
              if (Number(res.changes || 0) > 0) {
                result.newJobsIngested++;
                try {
                  const hourlyFile = path.resolve('state/autoapply/portal-review/hourly-discoveries.jsonl');
                  fs.mkdirSync(path.dirname(hourlyFile), { recursive: true });
                  fs.appendFileSync(hourlyFile, JSON.stringify(payloadObj) + '\n', 'utf8');
                } catch {}
              }
            }
          }
        } catch {}
      }
      } finally { db.close(); }
    } catch {}
  }

  try {
    // Separate from the drain's Phase A marker; sharing one file let the pillar
    // sync reset the timestamp and make the next cycle skip Phase A.
    const syncStatusFile = path.resolve('state/autoapply/portal-review/last-pillar-sync.json');
    fs.mkdirSync(path.dirname(syncStatusFile), { recursive: true });
    fs.writeFileSync(
      syncStatusFile,
      JSON.stringify(
        {
          lastSyncAt: new Date().toISOString(),
          newJobsIngested: result.newJobsIngested,
          fetched: result.fetched,
          officesSynced: result.officesSynced,
          companiesSynced: result.companiesSynced,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {}

  return result;
}
