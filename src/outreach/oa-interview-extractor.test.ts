import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { composeInterviewSchedulingReplyDraft, extractOaAndInterviewSignalsFromEmail } from './oa-interview-extractor.js';
import { saveInterviewSchedulingDrafts } from './interview-drafts.js';
import { classifyEmailLifecycleStage, type InboxLifecycleEvent } from '../autoapply/inbox-lifecycle-tracker.js';

test('assessment and scheduling links outrank rejection and acknowledgement boilerplate', () => {
  const email = { subject: 'Thank you for applying', from: 'recruiter@example.test', bodyText: 'Complete within 2 days. Unfortunately some candidates are not selected.', bodyHtml: '<a href="https://www.hackerrank.com/test/abc?x=1&amp;y=2">Begin</a>' };
  const signal = extractOaAndInterviewSignalsFromEmail(email);
  assert.equal(signal.category, 'OA_ASSESSMENT');
  assert.equal(signal.urgency, 'CRITICAL');
  assert.equal(signal.deadlineHint, 'within 2 days');
  assert.deepEqual(signal.actionUrls, ['https://www.hackerrank.com/test/abc?x=1&y=2']);
  assert.equal(classifyEmailLifecycleStage({ fromAddress: email.from, subject: email.subject, bodyText: email.bodyText, bodyHtml: email.bodyHtml })?.stage, 'INTERVIEW_OR_OA_INVITE');
  assert.equal(extractOaAndInterviewSignalsFromEmail({ ...email, bodyHtml: '<a href="https://calendly.com/fixture/meeting">Schedule</a>' }).category, 'INTERVIEW_INVITE');
  assert.equal(extractOaAndInterviewSignalsFromEmail({ ...email, bodyHtml: '<a href="https://calendly.com.attacker.test/meeting">Bad</a>' }).category, 'REJECTION');
  assert.equal(extractOaAndInterviewSignalsFromEmail({ subject: 'Hello', from: 'assessments@codesignal.com', bodyText: '' }).platform, 'CodeSignal');
});

test('interview draft stays local, preserves edits and never claims a slot is booked', () => {
  const draft = composeInterviewSchedulingReplyDraft({ companyName: 'Example', jobTitle: 'Engineer', extractedSchedulingUrl: 'https://calendly.com/fixture' });
  assert.equal(draft.readyForHumanClick, true);
  assert.match(draft.bodyText, /I will use the scheduling link/);
  assert.doesNotMatch(draft.bodyText, /booked|confirmed a slot/i);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-drafts-test-'));
  const file = path.join(dir, 'drafts.json');
  try {
    const event: InboxLifecycleEvent = { messageId: 'fixture', date: '2026-01-01', fromAddress: 'recruiter@example.test', fromDomain: 'example.test', subject: 'Interview', stage: 'INTERVIEW_OR_OA_INVITE', signalCategory: 'INTERVIEW_INVITE', snippet: '', company: 'Example' };
    saveInterviewSchedulingDrafts([event], file);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].recipient, event.fromAddress);
    saved[0].bodyText = 'Human edit';
    fs.writeFileSync(file, JSON.stringify(saved));
    saveInterviewSchedulingDrafts([event], file);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].bodyText, 'Human edit');
    const before = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(`${file}.lock`, 'occupied');
    assert.throws(() => saveInterviewSchedulingDrafts([{ ...event, messageId: 'other' }], file));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    fs.unlinkSync(`${file}.lock`);
    fs.writeFileSync(file, 'not JSON');
    assert.throws(() => saveInterviewSchedulingDrafts([event], file));
    assert.equal(fs.readFileSync(file, 'utf8'), 'not JSON');
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});
