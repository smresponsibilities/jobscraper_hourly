import { readFileSync, statSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { AutoaplyJobItem, BotRunReport } from '../src/autoapply/types.js';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--state' || args[2] !== '--job') throw new Error('Usage: --state <directory> --job <job-id>');
const root = path.resolve(args[1]!);
const worker = JSON.parse(readFileSync(path.join(root, 'worker.json'), 'utf8'));
const origin = new URL(worker.dashboardUrl);
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password || origin.pathname !== '/') throw new Error('Step control requires a loopback review dashboard');
const database = new DatabaseSync(path.join(root, 'queue.sqlite'), { readOnly: true });
let job: AutoaplyJobItem;
try {
  const row = database.prepare('SELECT payload FROM applications WHERE candidate_id=? AND id=?').get(worker.candidateId, args[3] || '') as { payload: string } | undefined;
  if (!row) throw new Error('Review job does not belong to this candidate');
  job = JSON.parse(row.payload);
} finally { database.close(); }
const session = path.join(root, 'applications', createHash('sha256').update(job.canonicalKey || job.jobUrl).digest('hex').slice(0, 20));
const handoff = path.join(session, 'handoff.json');
const previous = existsSync(handoff) ? statSync(handoff).mtimeMs : 0;
const htmlResponse = await fetch(origin, { signal: AbortSignal.timeout(10000) });
if (!htmlResponse.ok) throw new Error('Review dashboard is unavailable');
const token = /const token=("[a-f0-9]{48}")/.exec(await htmlResponse.text())?.[1];
if (!token) throw new Error('Review dashboard did not provide its action token');
const response = await fetch(new URL('/api/step', origin), { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', 'X-Review-Token': JSON.parse(token), Origin: origin.origin }, body: JSON.stringify({ id: job.id }) });
if (!response.ok) throw new Error(`Step request rejected: HTTP ${response.status}`);
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  if (existsSync(handoff) && statSync(handoff).mtimeMs > previous) {
    const saved = JSON.parse(readFileSync(path.join(session, 'checkpoint.json'), 'utf8')) as { report: BotRunReport; currentUrl: string };
    if (saved.report.endTime) {
      console.log(JSON.stringify({ company: job.company, status: saved.report.status, reason: saved.report.reason, path: new URL(saved.currentUrl).pathname, submissionAttempted: !!saved.report.submissionAttempted, questions: saved.report.actions.filter(action => action.status === 'failed').map(action => action.question), snapshot: path.join(session, 'review.html') }, null, 2));
      process.exitCode = saved.report.submissionAttempted ? 1 : 0;
      break;
    }
  }
  await delay(250);
}
if (Date.now() >= deadline) throw new Error('Step outcome is still pending; inspect the existing worker before requesting another step');
