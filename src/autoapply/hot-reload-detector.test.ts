import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BatchBoundaryHotReloadDetector } from './hot-reload-detector.js';

test('detects content changes at a boundary and ignores touches or missing artifacts', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'reload-detector-'));
  const file = path.join(directory, 'runner.js');
  try {
    writeFileSync(file, 'old build');
    const detector = new BatchBoundaryHotReloadDetector([file]);
    utimesSync(file, new Date(), new Date(Date.now() + 10000));
    assert.equal(detector.hasBuildChangedOnDisk().changed, false);
    unlinkSync(file);
    assert.equal(detector.hasBuildChangedOnDisk().changed, false);
    writeFileSync(file, 'new build');
    const result = detector.hasBuildChangedOnDisk();
    assert.equal(result.changed, true);
    assert.equal(result.changedFile, file);
    assert.equal(result.oldHash, createHash('sha256').update('old build').digest('hex'));
    assert.equal(result.newHash, createHash('sha256').update(readFileSync(file)).digest('hex'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
