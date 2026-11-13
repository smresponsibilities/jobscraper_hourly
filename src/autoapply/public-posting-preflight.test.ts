import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefetchPublicPosting } from './public-posting-preflight.js';

test('public preflight normalizes provider metadata and fails closed', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/postings/missing')) return new Response(null, { status: 404 });
      if (url.includes('smartrecruiters')) return Response.json({ jobAd: { sections: { qualifications: { text: 'Qualifications' }, jobDescription: { text: 'Description' } } } });
      if (url.includes('recruitee')) return Response.json({ offer: { description: 'Recruitee description', questions: ['Question'] } });
      if (url.includes('breezy')) return Response.json({ description: 'Breezy description', questionnaire: ['Question'] });
      if (url.includes('workable')) return Response.json({ state: 'closed', description: 'Description', requirements: 'Requirements' });
      return new Response(null, { status: 500 });
    }) as typeof fetch;
    const smart = await prefetchPublicPosting('https://jobs.smartrecruiters.com/acme/123');
    assert.equal(smart?.jdText, 'Description\nQualifications');
    await prefetchPublicPosting('https://jobs.smartrecruiters.com/acme/123-software-engineer');
    assert.equal(calls.at(-1), 'https://api.smartrecruiters.com/v1/companies/acme/postings/123');
    assert.equal((await prefetchPublicPosting('https://jobs.smartrecruiters.com/acme/missing'))?.isClosed, true);
    assert.deepEqual((await prefetchPublicPosting('https://acme.recruitee.com/o/engineer'))?.questions, ['Question']);
    assert.deepEqual((await prefetchPublicPosting('https://acme.breezy.hr/p/engineer'))?.questions, ['Question']);
    const workable = await prefetchPublicPosting('https://apply.workable.com/acme/j/ABC');
    assert.equal(workable?.isClosed, true);
    assert.equal(workable?.jdText, 'Description\nRequirements');
    const before = calls.length;
    assert.equal(await prefetchPublicPosting('https://stripe.recruitee.com/o/engineer'), null);
    assert.equal(await prefetchPublicPosting('https://stripe-careers.recruitee.com/o/engineer'), null);
    assert.equal(await prefetchPublicPosting('https://jobs.smartrecruiters.com.evil.test/acme/123'), null);
    assert.equal(await prefetchPublicPosting('http://acme.breezy.hr/p/engineer'), null);
    assert.equal(await prefetchPublicPosting('https://user:pass@acme.breezy.hr/p/engineer'), null);
    assert.equal(await prefetchPublicPosting('https://acme.breezy.hr:8443/p/engineer'), null);
    assert.equal(calls.length, before);
    assert.ok(calls.includes('https://apply.workable.com/api/v2/accounts/acme/jobs/ABC'));
    globalThis.fetch = (async () => Response.json({ state: 'draft' })) as typeof fetch;
    assert.equal((await prefetchPublicPosting('https://apply.workable.com/acme/j/ABC'))?.isClosed, true);
    globalThis.fetch = (async () => { throw new Error('timeout'); }) as typeof fetch;
    assert.equal(await prefetchPublicPosting('https://acme.breezy.hr/p/timeout'), null);
  } finally {
    globalThis.fetch = original;
  }
});
