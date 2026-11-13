import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

interface ArtifactSnapshot { hash: string; mtimeMs: number }

function snapshot(file: string): ArtifactSnapshot | undefined {
  try {
    const before = statSync(file);
    const contents = readFileSync(file);
    const after = statSync(file);
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || contents.length !== after.size) return undefined;
    return { hash: createHash('sha256').update(contents).digest('hex'), mtimeMs: after.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Compare complete artifacts against the process's boot snapshot. */
export class BatchBoundaryHotReloadDetector {
  private readonly files: string[];
  private readonly initial = new Map<string, ArtifactSnapshot>();

  constructor(files = [path.resolve('out/dist/src/autoapply/runner.js'), path.resolve('src/autoapply/runner.ts')]) {
    this.files = files.map(file => path.resolve(file));
    for (const file of this.files) {
      const value = snapshot(file);
      if (value) this.initial.set(file, value);
    }
  }

  hasBuildChangedOnDisk(): { changed: boolean; changedFile: string | null; oldHash: string; newHash: string } {
    for (const file of this.files) {
      const current = snapshot(file);
      if (!current) continue;
      const previous = this.initial.get(file);
      if (!previous) { this.initial.set(file, current); continue; }
      if (current.hash !== previous.hash) return { changed: true, changedFile: file, oldHash: previous.hash, newHash: current.hash };
    }
    return { changed: false, changedFile: null, oldHash: '', newHash: '' };
  }
}
