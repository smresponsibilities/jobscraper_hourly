import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prefetchAtsQuestionSchema } from './runner.js';

test('schema prefetch uses exact provider hosts and excludes isolated tenants', async () => {
  const previous = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return Response.json({ questions: [] });
    }) as typeof fetch;
    await prefetchAtsQuestionSchema('https://boards.greenhouse.io/example/jobs/123456789');
    assert.equal(calls[0], 'https://boards-api.greenhouse.io/v1/boards/example/jobs/123456789?questions=true');
    const before = calls.length;
    for (const url of [
      'https://jobs.ashbyhq.com/stripe/fixture',
      'https://jobs.ashbyhq.com.attacker.test/example/fixture',
      'https://user:pass@jobs.ashbyhq.com/example/fixture',
      'https://boards.greenhouse.io.attacker.test/example/jobs/123456789',
    ]) assert.equal(await prefetchAtsQuestionSchema(url), null);
    assert.equal(calls.length, before);
  } finally { globalThis.fetch = previous; }
});
