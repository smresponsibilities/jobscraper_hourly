import assert from 'node:assert/strict';
import { test } from 'node:test';
import dns from 'node:dns';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkDomainMxDeliverability, sendVerifiedOutreachEmail, ZeroBounceBlockedError } from './zero-bounce-verifier.js';

test('MX cache blocks null and missing MX, handles transient errors, and gates every recipient', async () => {
  const previous = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mx-gate-test-'));
  const original = dns.promises.resolveMx;
  const originalNow = Date.now;
  const calls: string[] = [];
  try {
    process.chdir(dir);
    dns.promises.resolveMx = (async (domain: string) => {
      calls.push(domain);
      if (domain === 'null.fixture.test') return [{ exchange: '.', priority: 0 }];
      if (domain === 'empty.fixture.test') throw Object.assign(new Error('no records'), { code: 'ENODATA' });
      if (domain === 'temporary.fixture.test') throw Object.assign(new Error('timeout'), { code: 'ETIMEOUT' });
      return [{ exchange: 'mail.fixture.test', priority: 10 }];
    }) as typeof dns.promises.resolveMx;
    assert.equal((await checkDomainMxDeliverability('a@null.fixture.test')).isNullMx, true);
    assert.equal((await checkDomainMxDeliverability('empty.fixture.test')).reason, 'DNS_NO_MX');
    assert.equal((await checkDomainMxDeliverability('temporary.fixture.test')).reason, 'DNS_LOOKUP_FAILED');
    await checkDomainMxDeliverability('temporary.fixture.test');
    assert.equal(calls.filter(domain => domain === 'temporary.fixture.test').length, 2);
    const valid = await Promise.all(Array.from({ length: 4 }, () => checkDomainMxDeliverability('valid.fixture.test')));
    assert(valid.every(result => result.hasValidMx));
    await checkDomainMxDeliverability('valid.fixture.test');
    assert.equal(calls.filter(domain => domain === 'valid.fixture.test').length, 1);
    const clock = Date.now();
    Date.now = () => clock + 7 * 24 * 60 * 60 * 1000 + 1;
    await checkDomainMxDeliverability('valid.fixture.test');
    assert.equal(calls.filter(domain => domain === 'valid.fixture.test').length, 2);
    Date.now = originalNow;
    assert(fs.existsSync(path.join(dir, 'state/outreach/domain-mx-cache.json')));
    let sent = 0;
    const transporter = { sendMail: async () => { sent++; return { messageId: 'fixture' }; } };
    const payload = { transporter, to: 'person@valid.fixture.test', mailOptions: { to: 'person@valid.fixture.test' }, provenanceTier: 'TIER_A_VERBATIM_OBSERVED' as const, evidenceUrl: 'https://example.test/evidence' };
    await sendVerifiedOutreachEmail(payload);
    await assert.rejects(sendVerifiedOutreachEmail({ ...payload, to: 'person@null.fixture.test', mailOptions: { to: 'person@null.fixture.test' } }), ZeroBounceBlockedError);
    await assert.rejects(sendVerifiedOutreachEmail({ ...payload, mailOptions: { to: 'other@valid.fixture.test' } }), ZeroBounceBlockedError);
    await assert.rejects(sendVerifiedOutreachEmail({ ...payload, mailOptions: { ...payload.mailOptions, bcc: 'extra@valid.fixture.test' } }), ZeroBounceBlockedError);
    assert.equal(sent, 1);
  } finally {
    dns.promises.resolveMx = original;
    Date.now = originalNow;
    process.chdir(previous);
    const cache = path.join(dir, 'state/outreach/domain-mx-cache.json');
    if (fs.existsSync(cache)) fs.unlinkSync(cache);
    fs.rmdirSync(path.join(dir, 'state/outreach'));
    fs.rmdirSync(path.join(dir, 'state'));
    fs.rmdirSync(dir);
  }
});
