import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AutoaplyQueueManager } from './autoaply.js';
import { canonicalRequisition } from './identity.js';
import { preflightJob, type IntakeJob, type PreflightResult } from './preflight.js';
import type { CandidateExtendedProfile } from './types.js';

export const HOURLY_CATALOGUE_URL = 'https://raw.githubusercontent.com/smresponsibilities/jobscraper_hourly/data/jobs.json';

interface CatalogueSnapshot {
  version: 1;
  source: string;
  etag?: string;
  fetchedAt: string;
  sha256: string;
  jobs: IntakeJob[];
}

/** Owns the published-catalogue → preflight → durable-queue boundary. */
export class CatalogueIntake {
  constructor(private options: {
    source: string;
    stateDir: string;
    queue: AutoaplyQueueManager;
    profile: () => CandidateExtendedProfile;
    fetcher?: typeof fetch;
    approvedUrls?: readonly string[];
  }) {
    const source = new URL(options.source);
    if (source.protocol !== 'https:' && !(source.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname))) throw new Error('Catalogue requires HTTPS or a loopback test endpoint');
    mkdirSync(options.stateDir, { recursive: true });
  }

  async poll(signal?: AbortSignal): Promise<{ fetched: boolean; imported: number; skipped: number; retry: number }> {
    const filename = path.join(this.options.stateDir, 'catalogue-snapshot.json');
    let snapshot: CatalogueSnapshot | undefined;
    if (existsSync(filename)) {
      snapshot = JSON.parse(readFileSync(filename, 'utf8'));
      if (snapshot?.version !== 1 || snapshot.source !== this.options.source || !Array.isArray(snapshot.jobs)) throw new Error('Invalid cached catalogue snapshot');
    }
    const fetcher = this.options.fetcher || fetch;
    const response = await fetcher(this.options.source, { headers: snapshot?.etag ? { 'If-None-Match': snapshot.etag } : {}, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    const fetched = response.status !== 304;
    if (fetched) {
      if (!response.ok) throw new Error(`Catalogue source returned HTTP ${response.status}`);
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 50000000) throw new Error('Catalogue exceeds the supported size');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('Catalogue must be a JSON array');
      // Some published postings have no application link. They cannot be queued.
      const jobs: IntakeJob[] = parsed.filter(entry => !(entry && typeof entry === 'object' && 'url' in entry && entry.url === '')).map((entry: unknown) => {
        if (!entry || typeof entry !== 'object') throw new Error('Invalid catalogue entry');
        const row = entry as Record<string, unknown>;
        if (typeof row.id !== 'string' || typeof row.url !== 'string' || typeof row.company !== 'string' || typeof row.title !== 'string' || !URL.canParse(row.url) || !['http:', 'https:'].includes(new URL(row.url).protocol)) throw new Error('Catalogue entries require valid id, url, company and title');
        for (const key of ['location', 'postedAt', 'lastSeen', 'closedAt', 'text']) if (row[key] != null && typeof row[key] !== 'string') throw new Error(`Invalid catalogue ${key}`);
        if (row.minYears !== undefined && row.minYears !== null && (typeof row.minYears !== 'number' || !Number.isFinite(row.minYears) || row.minYears < 0)) throw new Error('Invalid catalogue minYears');
        return { id: row.id, url: row.url, company: row.company, title: row.title, location: (row.location ?? undefined) as string | undefined, postedAt: (row.postedAt ?? undefined) as string | undefined, lastSeen: (row.lastSeen ?? undefined) as string | undefined, closedAt: (row.closedAt ?? undefined) as string | undefined, text: (row.text ?? undefined) as string | undefined, minYears: row.minYears as number | null | undefined };
      });
      snapshot = { version: 1, source: this.options.source, fetchedAt: new Date().toISOString(), etag: response.headers.get('etag') || undefined, sha256: createHash('sha256').update(raw).digest('hex'), jobs };
      const temporary = `${filename}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify(snapshot), { mode: 0o600 });
      renameSync(temporary, filename);
    }
    if (!snapshot) throw new Error('Catalogue returned 304 without a cached snapshot');
    const latest = snapshot.jobs.reduce((maximum, job) => Number.isFinite(Date.parse(job.lastSeen || '')) ? Math.max(maximum, Date.parse(job.lastSeen!)) : maximum, -Infinity);
    const latestPollAt = Number.isFinite(latest) ? new Date(latest).toISOString() : undefined;
    const totals = { fetched, imported: 0, skipped: 0, retry: 0 };
    // Small bounded concurrency avoids turning intake into an employer API flood.
    const unique = new Map<string, IntakeJob>();
    const approved = this.options.approvedUrls ? new Set(this.options.approvedUrls) : undefined;
    for (const job of snapshot.jobs) {
      if (approved && !approved.has(job.url!)) continue;
      const key = canonicalRequisition(job.url!, job.id)?.key || job.url!;
      const previous = unique.get(key);
      if (!previous || Date.parse(job.lastSeen || '') >= Date.parse(previous.lastSeen || '')) unique.set(key, job);
    }
    const pending = [...unique.values()];
    const profile = this.options.profile();
    const decisions: Array<{ id?: string; decision: PreflightResult }> = [];
    const existing = new Map(this.options.queue.list().map(job => [job.canonicalKey || canonicalRequisition(job.jobUrl, job.externalJobId)?.key || job.jobUrl, job]));
    const fitCutoff = Date.now() - 24 * 60 * 60 * 1000;
    const fitRefresh = new Set([...unique.keys()].map(key => existing.get(key)).filter(job => job?.status === 'queued' && !job.description?.trim() && (!Number.isFinite(Date.parse(job.fitCheckedAt || '')) || Date.parse(job.fitCheckedAt!) < fitCutoff)).sort((a, b) => (Date.parse(a!.fitCheckedAt || '') || 0) - (Date.parse(b!.fitCheckedAt || '') || 0)).slice(0, 24).map(job => job!.id));
    const processRow = async () => {
      while (pending.length && !signal?.aborted) {
        const job = pending.shift()!;
        const key = canonicalRequisition(job.url!, job.id)?.key || job.url!;
        const known = existing.get(key);
        if (known && fitRefresh.has(known.id)) {
          const decision = await preflightJob(job, profile, { latestPollAt, fetcher, signal });
          const updated = this.options.queue.recordFitProbe(known.id, decision.checkedAt, decision.status === 'eligible' ? decision.description : undefined, decision.status === 'skipped' ? decision.reason : undefined);
          decisions.push({ id: job.id, decision });
          if (decision.status === 'retry') totals.retry++;
          if (decision.status === 'skipped' && updated) totals.skipped++;
          continue;
        }
        if (known && (known.status !== 'skipped' || !['closed_in_catalogue', 'closed_at_source', 'stale_catalogue_entry', 'experience_recheck_pending', 'unconfirmed_india_remote', 'requisition_identity_mismatch'].includes(known.error || ''))) continue;
        const decision = await preflightJob(job, profile, { latestPollAt, fetcher, signal });
        decisions.push({ id: job.id, decision });
        if (decision.status === 'retry') { totals.retry++; continue; }
        if (decision.status === 'skipped' && (!job.url || !URL.canParse(job.url) || decision.reason === 'invalid_application_url')) {
          totals.skipped++;
          continue;
        }
        const queued = this.options.queue.enqueue({ externalJobId: job.id!, jobUrl: job.url!, company: job.company, title: job.title, location: job.location, postedAt: job.postedAt || '', description: decision.description });
        if (decision.status === 'skipped') {
          this.options.queue.skip(queued.id, decision.reason);
          totals.skipped++;
        } else {
          this.options.queue.reopenAtSource(queued.id);
          if (!known) totals.imported++;
        }
      }
    };
    await Promise.all([processRow(), processRow(), processRow()]);
    const temporary = path.join(this.options.stateDir, `intake-report.${randomUUID()}.tmp`);
    const observedAt = new Date().toISOString();
    writeFileSync(temporary, JSON.stringify({ observedAt, source: snapshot.source, catalogueHash: snapshot.sha256, latestPollAt, totals, decisions }, null, 2), { mode: 0o600 });
    renameSync(temporary, path.join(this.options.stateDir, 'intake-report.json'));
    const reasons: Record<string, number> = {};
    for (const { decision } of decisions) reasons[decision.reason] = (reasons[decision.reason] || 0) + 1;
    appendFileSync(path.join(this.options.stateDir, 'intake-history.jsonl'), `${JSON.stringify({ observedAt, catalogueHash: snapshot.sha256, totals, reasons })}\n`, { mode: 0o600 });
    return totals;
  }
}
