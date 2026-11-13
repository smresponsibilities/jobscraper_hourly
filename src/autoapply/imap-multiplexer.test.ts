import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractGreenhouse8CharOtpFromEmail, extractWorkdayActivationLinkFromEmail, withSingleFlightImapLock } from './imap-multiplexer.js';
import { ImapMailbox } from './mailbox.js';

test('IMAP lock serializes concurrent work and releases after failure', async () => {
  let active = 0, maximum = 0;
  const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => withSingleFlightImapLock(String(index), async () => {
    maximum = Math.max(maximum, ++active);
    try {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (index === 1) throw new Error('fixture');
      return index;
    } finally { active--; }
  })));
  assert.equal(maximum, 1);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
});

test('separate mailboxes release connections before another connects', async () => {
  let active = 0, maximum = 0;
  const boxes = Array.from({ length: 4 }, () => {
    const box = new ImapMailbox({ host: 'fixture.test', user: 'fixture', password: 'fixture' });
    (box as unknown as { client: unknown }).client = {
      connect: async () => { maximum = Math.max(maximum, ++active); },
      list: async () => { await new Promise(resolve => setTimeout(resolve, 10)); return []; },
      mailboxOpen: async () => {}, search: async () => [],
      logout: async () => { active--; }, close: () => {},
    };
    return box;
  });
  await Promise.all(boxes.map(box => box.messagesSince(new Date(), ['greenhouse.io'])));
  assert.equal(maximum, 1);
  assert.equal(active, 0);
  await Promise.all(boxes.map(box => box.close()));
});

test('OTP extraction rejects consumed and common words; activation links stay on Workday', () => {
  assert.equal(extractGreenhouse8CharOtpFromEmail('<strong>security</strong><b>A1b2C3d4</b>', new Set()), 'A1b2C3d4');
  assert.equal(extractGreenhouse8CharOtpFromEmail('Verification code: A1b2C3d4', new Set(['A1b2C3d4'])), null);
  const target = 'https://acme.wd5.myworkdayjobs.com/site/activate/token';
  assert.equal(extractWorkdayActivationLinkFromEmail(`https://redirect.example.test/?url=${encodeURIComponent(target)}`), target);
  assert.equal(extractWorkdayActivationLinkFromEmail('https://acme.wd5.myworkdayjobs.com.evil.test/site/activate/token'), null);
});
