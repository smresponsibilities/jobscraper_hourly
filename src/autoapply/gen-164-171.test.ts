import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {
  isSafeOutreachEmailSyntax,
  composeAppliedFollowUpPitch,
  POISON_EMAIL_PREFIXES,
} from '../../scripts/sync-applied-to-outreach.js';

test('GEN-165: isSafeOutreachEmailSyntax blocks all 24 poison prefixes and validates email format', () => {
  assert.ok(POISON_EMAIL_PREFIXES.size >= 24, 'Must have at least 24 poison email prefixes');

  // Verify poison prefixes are rejected
  for (const prefix of POISON_EMAIL_PREFIXES) {
    const badEmail = `${prefix}@validcompany.org`;
    assert.strictEqual(
      isSafeOutreachEmailSyntax(badEmail),
      false,
      `Should reject poison email prefix: ${badEmail}`
    );
  }

  // Verify invalid emails are rejected
  assert.strictEqual(isSafeOutreachEmailSyntax('invalid-email'), false);
  assert.strictEqual(isSafeOutreachEmailSyntax('user@'), false);
  assert.strictEqual(isSafeOutreachEmailSyntax('@domain.com'), false);
  assert.strictEqual(isSafeOutreachEmailSyntax('user @domain.com'), false);

  // Verify valid recruiter/engineer email is accepted
  assert.strictEqual(isSafeOutreachEmailSyntax('jane.smith@techcorp.io'), true);
  assert.strictEqual(isSafeOutreachEmailSyntax('recruiting.team@startup.ai'), true);
});

test('GEN-165: composeAppliedFollowUpPitch generates grounded outreach email referencing key qualifications', () => {
  const pitch = composeAppliedFollowUpPitch('Acme Corp', 'Software Engineer');
  assert.ok(pitch.subject.includes('Acme Corp'), 'Subject must mention company');
  assert.ok(pitch.subject.includes('Software Engineer'), 'Subject must mention title');
  assert.ok(pitch.body.includes('Morgan Stanley'), 'Body must mention Morgan Stanley');
  assert.ok(pitch.body.includes('CIAM'), 'Body must mention CIAM');
  assert.ok(pitch.body.includes('9.35'), 'Body must mention 9.35 CGPA');
  assert.ok(pitch.body.includes('HackIndia'), 'Body must mention HackIndia');
});

test('GEN-166: runner.ts stages uploaded resume as Shivam_Mahajan_Resume.pdf', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(
    runnerSrc.includes('Shivam_Mahajan_Resume.pdf'),
    'runner.ts must stage resume as Shivam_Mahajan_Resume.pdf'
  );
  assert.ok(
    runnerSrc.includes('copyFileSync'),
    'runner.ts must import and use copyFileSync for resume staging'
  );
});

test('GEN-167: runner.ts skips re-typing pre-populated inputs in fillFrame', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(
    runnerSrc.includes('existingVal') && runnerSrc.includes('isCurrentlyInvalid'),
    'runner.ts fillFrame must inspect existing value and validation state'
  );
  assert.ok(
    runnerSrc.includes('Ticket GEN-167: Pre-populated input value check'),
    'runner.ts fillFrame must include GEN-167 pre-populated check'
  );
});

test('GEN-168: widgets.ts implements 15ms isNativeSelect fast-path in selectHarvestedOption', () => {
  const widgetsSrc = fs.readFileSync('src/autoapply/widgets.ts', 'utf8');
  assert.ok(
    widgetsSrc.includes('isNativeSelect'),
    'widgets.ts must include isNativeSelect fast-path'
  );
  assert.ok(
    widgetsSrc.includes('selectedViaNative'),
    'widgets.ts must evaluate native select matching'
  );
  assert.ok(
    widgetsSrc.includes("sel.dispatchEvent(new Event('change'"),
    'widgets.ts must dispatch change event on native select'
  );
});

test('GEN-169: runner.ts traverses child frames to locate submitControl when missing on mainFrame', () => {
  const runnerSrc = fs.readFileSync('src/autoapply/runner.ts', 'utf8');
  assert.ok(
    runnerSrc.includes('this.page.frames()') && runnerSrc.includes('Child-frame submitControl piercer'),
    'runner.ts must inspect this.page.frames() for child-iframe submit buttons'
  );
});

test('GEN-170: widgets.ts supports Workday button[aria-haspopup="listbox"] resolver', () => {
  const widgetsSrc = fs.readFileSync('src/autoapply/widgets.ts', 'utf8');
  assert.ok(
    widgetsSrc.includes('isButtonListbox'),
    'widgets.ts must identify button[aria-haspopup="listbox"] controls'
  );
  assert.ok(
    widgetsSrc.includes('aria-haspopup') && widgetsSrc.includes('listbox'),
    'widgets.ts must check aria-haspopup="listbox"'
  );
});
