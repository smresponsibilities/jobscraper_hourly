import type { CandidateExtendedProfile } from './types.js';

export type TimelineCategory = 'edu_start' | 'edu_end' | 'work_start' | 'work_end' | 'available_start' | 'today';
export interface TimelineParts { isoDate: string; mmYyyy: string; monthName: string; monthNumber: string; year: string }

/** Preserve date precision: a month-only fact never implies the first day. */
export function formatCandidateTimelineDate(category: TimelineCategory, constraint: { inputType?: string; placeholder?: string; maxDate?: string; profile?: CandidateExtendedProfile; now?: Date } = {}): TimelineParts {
  const empty: TimelineParts = { isoDate: '', mmYyyy: '', monthName: '', monthNumber: '', year: '' };
  const now = constraint.now || new Date();
  if (!Number.isFinite(now.getTime())) return empty;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const profile = constraint.profile;
  let raw = '';
  if (category === 'today') raw = today;
  else if (category === 'available_start' && profile?.professional.noticePeriodDays === 0) {
    const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); raw = date.toISOString().slice(0, 10);
  } else if (category === 'edu_start') raw = profile?.education[0]?.startDate || profile?.education[0]?.startYear || '';
  else if (category === 'edu_end') raw = profile?.education[0]?.endDate || profile?.education[0]?.graduationYear || '';
  else if (category === 'work_start') raw = profile?.experience[0]?.startDate || '';
  else if (category === 'work_end') raw = profile?.experience[0]?.endDate || '';
  const match = /^(\d{4})(?:-(0[1-9]|1[0-2]))?(?:-(0[1-9]|[12]\d|3[01]))?$/.exec(raw);
  if (!match) return empty;
  const [, year, month, day] = match;
  if (day && (!month || new Date(`${year}-${month}-${day}T00:00:00Z`).toISOString().slice(0, 10) !== raw)) return empty;
  if (constraint.maxDate === 'today' && day && raw > today) return empty;
  return { isoDate: day ? raw : '', mmYyyy: month ? `${month}/${year}` : '', monthName: month ? new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(`${year}-${month}-01T00:00:00Z`)) : '', monthNumber: month || '', year: year || '' };
}
