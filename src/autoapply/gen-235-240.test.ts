import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { printLiveScoreboardSnapshot } from '../../scripts/watch-live-scoreboard.js';

test('GEN-235: selectHarvestedOption in widgets.ts checks menuStillOpen and presses Escape', () => {
  const widgetsCode = fs.readFileSync('src/autoapply/widgets.ts', 'utf8');
  assert.ok(
    widgetsCode.includes('menuStillOpen'),
    'widgets.ts must check menuStillOpen'
  );
  assert.ok(
    widgetsCode.includes('keyboard.press(\'Escape\')') || widgetsCode.includes('keyboard.press("Escape")'),
    'widgets.ts must press Escape to close lingering portal menus'
  );
  assert.ok(
    widgetsCode.includes('[role="listbox"], .select__menu'),
    'widgets.ts must query floating listbox selectors'
  );
});

test('GEN-236: humanType in runner.ts handles isContentEditable & distiller.ts classifies rich-text', () => {
  const runnerCode = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  const distillerCode = fs.readFileSync('src/autoapply/distiller.ts', 'utf8');

  assert.ok(
    runnerCode.includes('isContentEditable') || runnerCode.includes('getAttribute(\'contenteditable\') === \'true\''),
    'runner.ts must check contenteditable in humanType'
  );
  assert.ok(
    runnerCode.includes('new InputEvent(\'input\'') || runnerCode.includes('new InputEvent("input"'),
    'runner.ts must dispatch InputEvent with insertText for contenteditable elements'
  );

  assert.ok(
    distillerCode.includes('[contenteditable="true"]'),
    'distiller.ts must include [contenteditable="true"] in controls selector'
  );
  assert.ok(
    distillerCode.includes('isRichText'),
    'distiller.ts must detect rich text controls and classify them'
  );
});

test('GEN-237: run-overnight-marathon.ts resets orphaned status = running rows on startup', () => {
  const marathonCode = fs.readFileSync('scripts/run-overnight-marathon.ts', 'utf8');
  assert.ok(
    marathonCode.includes("UPDATE jobs SET status = 'queued' WHERE status = 'running'"),
    'run-overnight-marathon.ts must reset orphaned running jobs'
  );
  assert.ok(
    marathonCode.includes("UPDATE applications SET status = 'queued' WHERE status = 'running'"),
    'run-overnight-marathon.ts must reset orphaned running applications'
  );
});

test('GEN-238: runner.ts checks accept for .docx-only file inputs', () => {
  const runnerCode = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(
    runnerCode.includes('prefersDocx') || runnerCode.includes('wordprocessingml'),
    'runner.ts must check for docx / wordprocessingml in accept attribute'
  );
  assert.ok(
    runnerCode.includes('.replace(/\\.pdf$/i, \'.docx\')') || runnerCode.includes(".replace(/\\.pdf$/i, '.docx')"),
    'runner.ts must check for .docx fallback sibling'
  );
});

test('GEN-239: scripts/watch-live-scoreboard.ts runs in readonly mode', () => {
  const scoreboardCode = fs.readFileSync('scripts/watch-live-scoreboard.ts', 'utf8');
  assert.ok(
    scoreboardCode.includes('DatabaseSync'),
    'watch-live-scoreboard.ts must use DatabaseSync'
  );
  assert.ok(
    scoreboardCode.includes('readOnly: true'),
    'watch-live-scoreboard.ts must open in readonly mode'
  );
  assert.equal(typeof printLiveScoreboardSnapshot, 'function');
  // Invoking printLiveScoreboardSnapshot directly must not throw
  assert.doesNotThrow(() => {
    printLiveScoreboardSnapshot();
  });
});
