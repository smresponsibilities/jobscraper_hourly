import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pruneReviewSnapshots } from './retention.js';
import type { AutoaplyJobItem } from './types.js';

test('retention removes only old completed review HTML', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'review-retention-'));
  const now = Date.now();
  const make = (id: string, status: string, receipt: boolean, ageDays: number) => {
    const session = path.join(root, 'applications', id);
    mkdirSync(session, { recursive: true });
    const review = path.join(session, 'review.html');
    writeFileSync(review, 'fixture');
    utimesSync(review, new Date(now - ageDays * 86400000), new Date(now - ageDays * 86400000));
    return { id, status, ...(receipt ? { receipt: {} } : {}) } as unknown as AutoaplyJobItem;
  };
  const jobs = [make('old-applied', 'applied', true, 15), make('new-applied', 'applied', true, 1), make('old-paused', 'paused_for_review', false, 15), make('old-no-receipt', 'applied', false, 15)];
  assert.equal(pruneReviewSnapshots(root, jobs, job => path.join(root, 'applications', job.id), now), 1);
  assert(!existsSync(path.join(root, 'applications', 'old-applied', 'review.html')));
  for (const job of jobs.slice(1)) assert(existsSync(path.join(root, 'applications', job.id, 'review.html')));
});
