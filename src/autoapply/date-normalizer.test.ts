import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCandidateTimelineDate } from './date-normalizer.js';
import type { CandidateExtendedProfile } from './types.js';
const profile = { education: [{ startDate: '2022-08', endDate: '2026-08' }], experience: [{ startDate: '2025-08-12', endDate: '2026-08' }], professional: { noticePeriodDays: 0 } } as CandidateExtendedProfile;
test('timeline formatter preserves supplied precision', () => {
  assert.deepEqual(formatCandidateTimelineDate('edu_start', { profile }), { isoDate: '', mmYyyy: '08/2022', monthName: 'August', monthNumber: '08', year: '2022' });
  assert.equal(formatCandidateTimelineDate('work_start', { profile }).isoDate, '2025-08-12');
  assert.equal(formatCandidateTimelineDate('edu_start').isoDate, '');
  assert.equal(formatCandidateTimelineDate('available_start', { profile, now: new Date('2026-11-12T12:00:00Z') }).isoDate, '2026-11-13');
  assert.equal(formatCandidateTimelineDate('work_start', { profile: { ...profile, experience: [{ startDate: '2025-02-30' }] } as CandidateExtendedProfile }).isoDate, '');
});
