import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confirmationFromMail, MailClaims, mailNeedsRequisitionId } from './mail-evidence.js';
import type { ApplicationMail } from './mailbox.js';
import type { AutoaplyJobItem } from './types.js';

test('same-title jobs at the same tenant require a requisition ID in confirmation mail', () => {
  const first = { id: 'one', externalJobId: 'greenhouse:fixture:1', jobUrl: 'https://boards.greenhouse.io/fixture/jobs/1', title: 'Software Engineer', status: 'applied' } as AutoaplyJobItem;
  const second = { ...first, id: 'two', externalJobId: 'greenhouse:fixture:2', jobUrl: 'https://job-boards.greenhouse.io/fixture/jobs/2', status: 'queued' as const };
  assert.equal(mailNeedsRequisitionId(first, [first, second]), true);
  assert.equal(mailNeedsRequisitionId(first, [first, { ...second, status: 'skipped' }]), false);
  assert.equal(mailNeedsRequisitionId(first, [first, { ...second, externalJobId: 'greenhouse:other:2' }]), false);
});

test('role-specific authenticated confirmation and durable message ownership prevent cross-job receipts', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'mail-claims-'));
  const file = path.join(directory, 'claims.sqlite');
  let claims = new MailClaims(file);
  const request = { provider: 'ashby', recipient: 'fixture@example.test', applicationUrl: 'https://jobs.ashbyhq.com/fixture/id', since: new Date('2026-10-30T01:00:00Z'), company: 'Fixture', title: 'Software Engineer', claim: (id: string) => claims.claim(id, 'job-one') };
  const mail: ApplicationMail = { id: '<confirmation@ashbyhq.com>', authenticated: true, from: ['noreply@ashbyhq.com'], to: ['fixture@example.test'], receivedAt: '2026-10-30T01:01:00Z', subject: 'Thank you for applying', text: 'Fixture received your application for Software Engineer.' };
  try {
    assert.equal(confirmationFromMail(mail, request)?.emailConfirmationId, mail.id);
    assert.equal(confirmationFromMail({ ...mail, authenticated: false }, request), undefined);
    assert.equal(confirmationFromMail({ ...mail, to: ['other@example.test'] }, request), undefined);
    assert.equal(confirmationFromMail(mail, { ...request, title: 'Product Designer' }), undefined);
    assert.equal(confirmationFromMail({ ...mail, text: 'Fixture received your application.' }, request), undefined);
    assert.equal(confirmationFromMail({ ...mail, text: 'Fixture received your application for R-1234.' }, { ...request, title: 'Unrelated Role', requisitionId: 'R-123' }), undefined);
    assert.equal(confirmationFromMail({ ...mail, text: 'Fixture received your application for R-123.' }, { ...request, title: 'Unrelated Role', requisitionId: 'R-123' })?.emailConfirmationId, mail.id);
    assert.equal(confirmationFromMail({ ...mail, text: 'Metadata received your application for Software Engineer.' }, { ...request, company: 'Meta' }), undefined);
    assert.equal(confirmationFromMail(mail, { ...request, requisitionId: 'R-123', requireRequisitionId: true }), undefined);
    assert.equal(confirmationFromMail({ ...mail, text: 'Fixture received your application for Software Engineer, R-123.' }, { ...request, requisitionId: 'R-123', requireRequisitionId: true })?.emailConfirmationId, mail.id);
    claims.close(); claims = new MailClaims(file);
    assert(claims.claim(mail.id, 'job-one'));
    assert.equal(claims.claim(mail.id, 'job-two'), false);
  } finally { claims.close(); rmSync(directory, { recursive: true, force: true }); }
});
