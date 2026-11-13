import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkdayCxsSearchRequest, parseWorkdayPostedOnToIso } from './workday-cxs-harvester.js';
import { parsePostedOn } from '../fetchers/workday.js';

test('Workday request builder validates tenant, locale and site boundaries', () => {
  const request = buildWorkdayCxsSearchRequest('https://acme.wd5.myworkdayjobs.com/en-US/External/job/India/Engineer');
  assert.equal(request?.endpointUrl, 'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs');
  assert.deepEqual(request?.body, { appliedFacets: {}, limit: 20, offset: 0, searchText: 'Software Engineer India' });
  assert.equal(buildWorkdayCxsSearchRequest('https://acme.wd1.myworkdayjobs.com/search', 'Data')?.body.searchText, 'Data');
  assert.equal(buildWorkdayCxsSearchRequest('https://stripe.wd5.myworkdayjobs.com/External'), null);
  assert.equal(buildWorkdayCxsSearchRequest('https://acme.wd5.myworkdayjobs.com.evil.test/External'), null);
  assert.equal(buildWorkdayCxsSearchRequest('http://acme.wd5.myworkdayjobs.com/External'), null);
  assert.equal(buildWorkdayCxsSearchRequest('https://acme.wd5.myworkdayjobs.com/en-US'), null);
});

test('relative dates preserve uncertainty and handle malformed inputs', () => {
  const now = Date.parse('2026-11-12T10:00:00Z');
  assert.equal(parseWorkdayPostedOnToIso('Posted Today', now), '2026-11-12T10:00:00.000Z');
  assert.equal(parseWorkdayPostedOnToIso('Posted Yesterday', now), '2026-11-11T10:00:00.000Z');
  assert.equal(parseWorkdayPostedOnToIso('Posted 3 Days Ago', now), '2026-11-09T10:00:00.000Z');
  assert.equal(parseWorkdayPostedOnToIso('Posted 30+ Days Ago', now), null);
  assert.equal(parsePostedOn('Posted 30+ Days Ago'), undefined);
  assert.equal(parseWorkdayPostedOnToIso('Posted 999999 Days Ago', now), null);
});
