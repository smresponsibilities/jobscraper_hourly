import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImapMailbox, MailboxAuthenticationError, verificationFromMail, type ApplicationMail } from './mailbox.js';

const request = { provider: 'greenhouse', recipient: 'fixture@example.test', since: new Date('2026-10-30T09:00:00Z'), applicationUrl: 'https://job-boards.greenhouse.io/fixture/jobs/1', company: 'Fixture' };
const message: ApplicationMail = { id: 'fixture-code', from: ['no-reply@greenhouse.io'], to: ['fixture@example.test'], receivedAt: '2026-10-30T09:00:05Z', subject: 'Fixture security verification', text: 'Your verification code is: AB12CD34', authenticated: true };

test('IMAP scans inbox, archive and junk read-only and deduplicates message IDs', async () => {
  const mailbox = new ImapMailbox({ host: 'fixture.test', user: 'fixture', password: 'synthetic' });
  const opened: string[] = [];
  const raw = Buffer.from('From: no-reply@greenhouse.io\r\nTo: fixture@example.test\r\nMessage-ID: <shared@fixture.test>\r\nSubject: Fixture\r\n\r\nSynthetic fixture');
  (mailbox as unknown as { client: unknown }).client = {
    connect: async () => {},
    list: async () => [{ path: '[Gmail]/All Mail', specialUse: '\\All' }, { path: '[Gmail]/Spam', specialUse: '\\Junk' }, { path: 'Unrelated' }],
    mailboxOpen: async (folder: string, options: { readOnly: boolean }) => { assert.equal(options.readOnly, true); opened.push(folder); },
    search: async () => [1],
    fetch: async function* () { yield { uid: 1, source: raw, internalDate: new Date('2026-10-30T09:00:05Z') }; },
    logout: async () => {},
  };
  const found = await mailbox.messagesSince(request.since, ['greenhouse.io']);
  assert.deepEqual(opened, ['INBOX', '[Gmail]/All Mail', '[Gmail]/Spam']);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.authenticated, false);
  await mailbox.close();
});

test('IMAP reads all matching messages in bounded batches', async () => {
  const mailbox = new ImapMailbox({ host: 'fixture.test', user: 'fixture', password: 'synthetic' });
  const batches: number[] = [];
  (mailbox as unknown as { client: unknown }).client = {
    connect: async () => {}, list: async () => [], mailboxOpen: async () => {},
    search: async () => Array.from({ length: 101 }, (_, index) => index + 1),
    fetch: async function* (ids: number[]) {
      batches.push(ids.length);
      for (const uid of ids) yield { uid, source: Buffer.from(`From: no-reply@greenhouse.io\r\nTo: fixture@example.test\r\nMessage-ID: <${uid}@fixture.test>\r\n\r\nSynthetic fixture`), internalDate: new Date('2026-10-30T09:00:05Z') };
    },
    logout: async () => {},
  };
  const found = await mailbox.messagesSince(request.since, ['greenhouse.io']);
  assert.deepEqual(batches, [50, 50, 1]);
  assert.equal(found.length, 101);
  assert(found.some(mail => mail.id === '<1@fixture.test>'));
  await mailbox.close();
});

test('IMAP authentication fails once without leaking server diagnostics', async () => {
  const mailbox = new ImapMailbox({ host: 'fixture.test', user: 'fixture', password: 'synthetic' });
  let attempts = 0;
  (mailbox as unknown as { client: unknown }).client = {
    connect: async () => { attempts++; throw Object.assign(new Error('private-server-secret'), { authenticationFailed: true }); },
    logout: async () => {},
  };
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(mailbox.messagesSince(request.since, ['greenhouse.io']), error => error instanceof MailboxAuthenticationError && !String(error).includes('private-server-secret'));
  assert.equal(attempts, 1);
  await mailbox.close();
});

test('verification accepts only authenticated, allowlisted, correctly addressed fresh messages', () => {
  assert.deepEqual(verificationFromMail(message, request), { messageId: 'fixture-code', code: 'AB12CD34' });
  assert.equal(verificationFromMail({ ...message, authenticated: false }, request), undefined);
  assert.equal(verificationFromMail({ ...message, from: ['no-reply@greenhouse.io.evil.test'] }, request), undefined);
  assert.equal(verificationFromMail({ ...message, to: ['other@example.test'] }, request), undefined);
  assert.equal(verificationFromMail({ ...message, receivedAt: '2026-10-30T08:59:59Z' }, request), undefined);
  assert.equal(verificationFromMail({ ...message, receivedAt: 'not-a-date' }, request), undefined);
});

test('activation links require the application host and an explicit verification path', () => {
  const verification = { ...request, provider: 'workday', applicationUrl: 'https://fixture.wd1.myworkdayjobs.com/External/job/Engineer_R1' };
  const mail = { ...message, from: ['no-reply@myworkday.com'], subject: 'Activate your account', text: 'Activate your account: https://fixture.wd1.myworkdayjobs.com/External/verify?token=fixture' };
  assert.equal(verificationFromMail(mail, verification)?.activationUrl, 'https://fixture.wd1.myworkdayjobs.com/External/verify?token=fixture');
  assert.equal(verificationFromMail({ ...mail, text: 'Activate: https://evil.test/verify?token=fixture' }, verification), undefined);
  assert.equal(verificationFromMail({ ...mail, text: 'Activate: https://fixture.wd1.myworkdayjobs.com/External/job/Engineer_R1' }, verification), undefined);
});

test('Workday OTP sender is accepted only with authentication and tenant-bound activation', () => {
  const verification = { ...request, provider: 'workday', applicationUrl: 'https://fixture.wd1.myworkdayjobs.com/External/job/Engineer_R1' };
  const mail = { ...message, from: ['no-reply@otp.workday.com'], subject: 'Fixture account verification', text: 'Activate Fixture account https://fixture.wd1.myworkdayjobs.com/External/verify?token=fixture' };
  assert(verificationFromMail(mail, verification)?.activationUrl);
  assert.equal(verificationFromMail({ ...mail, authenticated: false }, verification), undefined);
  assert.equal(verificationFromMail({ ...mail, from: ['no-reply@otp.workday.com.evil.test'] }, verification), undefined);
});

test('generic Workday activation is correlated by exact tenant link without a company-name body', () => {
  const verification = { ...request, provider: 'workday', company: 'ABB', applicationUrl: 'https://abb.wd3.myworkdayjobs.com/Careers/job/Engineer_R1' };
  const mail = { ...message, from: ['no-reply@otp.workday.com'], subject: 'Verify your account', text: 'Please verify your email.', html: '<a href="https://abb.wd3.myworkdayjobs.com/Careers/verify?token=fixture">Verify</a>' };
  assert.equal(verificationFromMail(mail, verification)?.activationUrl, 'https://abb.wd3.myworkdayjobs.com/Careers/verify?token=fixture');
  assert.equal(verificationFromMail({ ...mail, html: '<a href="https://other.wd3.myworkdayjobs.com/Careers/verify?token=fixture">Verify</a>' }, verification), undefined);
  assert.equal(verificationFromMail({ ...mail, html: '', text: 'Your verification code is: AB12CD34' }, verification), undefined);
  assert.equal(verificationFromMail({ ...mail, from: ['no-reply@greenhouse.io'], html: '<a href="https://job-boards.greenhouse.io/other/verify?token=fixture">Verify</a>' }, { ...request, company: 'ABB' }), undefined);
});
