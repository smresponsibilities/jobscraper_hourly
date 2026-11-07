import * as fs from 'node:fs';
import * as path from 'node:path';

export interface JobRunHistoryEntry {
  jobId: string;
  company: string;
  title: string;
  provider: string;
  lane: string;
  url: string;
  status: 'applied' | 'failed' | 'paused_for_review' | 'skipped' | 'queued';
  reason: string;
  fieldsFilled: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  receiptVerified?: boolean;
}

export const HISTORY_FILE = path.resolve('state/autoapply/portal-review/run-history.jsonl');

let lastAppendedJobId = '';
let lastAppendedTime = 0;

/**
 * Sanitizes any corrupted entries with durationMs > 360,000 in run-history.jsonl
 */
export function sanitizeRunHistoryFile(filePath = HISTORY_FILE): number {
  if (!fs.existsSync(filePath)) return 0;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let sanitizedCount = 0;
    const lines = content.split(/\r?\n/);
    const newLines = lines.map(line => {
      if (!line.trim()) return line;
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed.durationMs === 'number' && parsed.durationMs > 360_000) {
          parsed.durationMs = 360_000;
          sanitizedCount++;
          return JSON.stringify(parsed);
        }
      } catch {}
      return line;
    });
    if (sanitizedCount > 0) {
      fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
    }
    return sanitizedCount;
  } catch {
    return 0;
  }
}

// Auto-run sanitation on file load
try {
  sanitizeRunHistoryFile();
} catch {}

export function appendJobRunHistory(entry: JobRunHistoryEntry): void {
  // Ticket GEN-70: Deduplicate rapid consecutive calls for the same job
  const now = Date.now();
  if (entry.jobId && entry.jobId === lastAppendedJobId && now - lastAppendedTime < 5000) {
    return;
  }
  lastAppendedJobId = entry.jobId;
  lastAppendedTime = now;

  // Ticket GEN-75: Clamp durationMs to max 360,000 ms (6 min)
  entry.durationMs = Math.min(360_000, Math.max(0, entry.durationMs || 0));

  // Ticket GEN-70: Never mark jobs applied if fieldsFilled === 0 or reason indicates failure/timeout
  if (entry.status === 'applied') {
    if ((entry.fieldsFilled || 0) === 0 || /timed out|runner closed|failed|error|exception/i.test(entry.reason || '')) {
      entry.status = 'failed';
    }
  }

  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

export function readJobRunHistory(maxLines = 2000): JobRunHistoryEntry[] {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const stat = fs.statSync(HISTORY_FILE);
    if (stat.size === 0) return [];

    // Fast tail-read: read at most 512KB from the end of the file
    const bytesToRead = Math.min(stat.size, 512 * 1024);
    const buffer = Buffer.alloc(bytesToRead);
    const fd = fs.openSync(HISTORY_FILE, 'r');
    fs.readSync(fd, buffer, 0, bytesToRead, stat.size - bytesToRead);
    fs.closeSync(fd);

    const text = buffer.toString('utf8');
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const validLines = bytesToRead < stat.size ? lines.slice(1) : lines;

    return validLines
      .slice(-maxLines)
      .map(l => {
        try {
          const item = JSON.parse(l) as JobRunHistoryEntry;
          if (item && item.durationMs > 360_000) {
            item.durationMs = 360_000;
          }
          return item;
        } catch {
          return null;
        }
      })
      .filter((x): x is JobRunHistoryEntry => x !== null)
      .reverse();
  } catch {
    return [];
  }
}
