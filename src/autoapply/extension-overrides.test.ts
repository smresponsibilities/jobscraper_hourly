import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { recordExtensionHumanOverride } from './extension-answers.js';

test('override writes preserve prior entries and refuse a concurrent writer', () => {
  const previous = process.cwd();
  const root = mkdtempSync(path.join(os.tmpdir(), 'extension-override-'));
  try {
    process.chdir(root);
    assert.equal(recordExtensionHumanOverride('Fixture question', 'First').saved, true);
    assert.equal(recordExtensionHumanOverride('Other question', 'Second').saved, true);
    const file = path.join(root, 'state/autoapply/portal-review/extension-overrides.json');
    const before = readFileSync(file, 'utf8');
    assert.equal(JSON.parse(before).length, 2);
    writeFileSync(`${file}.lock`, 'occupied', { flag: 'wx' });
    assert.equal(recordExtensionHumanOverride('Third question', 'Third').saved, false);
    assert.equal(readFileSync(file, 'utf8'), before);
  } finally { process.chdir(previous); rmSync(root, { recursive: true, force: true }); }
});
