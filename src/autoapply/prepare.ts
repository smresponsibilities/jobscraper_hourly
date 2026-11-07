import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CandidateExtendedProfile } from './types.js';

export interface ApplicationBrief { title: string; company: string; text: string }

export function matchingProfileSkills(skills: readonly string[], description: string): string[] {
  return [...new Set(skills)].filter(skill => skill.trim() && new RegExp(`(^|[^\\p{L}\\p{N}])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(description));
}

export function prepareText(profile: CandidateExtendedProfile, job: ApplicationBrief) {
  if (!job || typeof job.title !== 'string' || !job.title.trim() || typeof job.company !== 'string' || !job.company.trim() || typeof job.text !== 'string' || !job.text.trim()) {
    throw new Error('Application brief requires title, company and job description text');
  }
  const description = job.text.toLowerCase();
  const relevant = matchingProfileSkills(profile.skills || [], description);
  const missing = (profile.skills || []).filter(skill => !relevant.includes(skill));
  const name = profile.personal.fullName || [profile.personal.firstName, profile.personal.lastName].filter(Boolean).join(' ');
  const experience = [...profile.experience].sort((a, b) => {
    const score = (entry: typeof a) => relevant.filter(skill => `${entry.title} ${entry.description || ''}`.toLowerCase().includes(skill.toLowerCase())).length;
    return score(b) - score(a);
  });
  const resume = [name, [profile.personal.email, profile.personal.phone, profile.personal.city, profile.personal.country].filter(Boolean).join(' | '),
    ...[profile.personal.linkedinUrl, profile.personal.githubUrl, profile.personal.portfolioUrl].filter(Boolean),
    '', 'Skills', [...relevant, ...missing].join(', '), '', 'Experience',
    ...experience.flatMap(entry => [
      [entry.title, entry.company, entry.location].filter(Boolean).join(' | '),
      [entry.startDate, entry.current ? 'Present' : entry.endDate].filter(Boolean).join(' - '), entry.description || '', '',
    ]), 'Education', ...profile.education.flatMap(entry => [entry.school, [entry.degree, entry.fieldOfStudy, entry.graduationYear].filter(Boolean).join(' | '), entry.gpa ? `GPA: ${entry.gpa}` : '', '']),
  ].join('\n');
  const coverLetter = [`Dear ${job.company} hiring team,`, '', `I am applying for the ${job.title} position.`,
    relevant.length ? `My listed skills relevant to this description include ${relevant.join(', ')}.` : '',
    ...experience.slice(0, 2).map(entry => [`My experience includes ${entry.title} at ${entry.company}.`, entry.description].filter(Boolean).join(' ')),
    '', 'I would welcome the opportunity to discuss my application.', '', name,
  ].filter((line, index, lines) => line || lines[index - 1]).join('\n');
  return { resume, coverLetter, matchingSkills: relevant, otherSkills: missing, explanation: 'Exact phrase overlap against candidate-listed skills. This is not an ATS compatibility score or a prediction of hiring success.' };
}

export async function prepareApplication(profile: CandidateExtendedProfile, brief: ApplicationBrief, output: string) {
  const text = prepareText(profile, brief);
  mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  mkdirSync(output);
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<html lang="en"><head><meta charset="utf-8"><title>Resume</title><style>body{font:11pt Arial;line-height:1.5}pre{white-space:pre-wrap;font:inherit}</style></head><body><pre>${escape(text.resume)}</pre></body></html>`);
    await page.pdf({ path: path.join(output, 'resume.pdf'), format: 'A4', margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' } });
  } finally { await browser.close(); }
  writeFileSync(path.join(output, 'cover-letter.txt'), text.coverLetter, { mode: 0o600 });
  writeFileSync(path.join(output, 'match.json'), JSON.stringify(text, null, 2), { mode: 0o600 });
  const prepared = { ...profile, coverLetterText: text.coverLetter, documents: { resume: path.resolve(output, 'resume.pdf'), coverLetter: path.resolve(output, 'cover-letter.txt') } };
  writeFileSync(path.join(output, 'profile.json'), JSON.stringify(prepared, null, 2), { mode: 0o600 });
  return { output: path.resolve(output), matchingSkills: text.matchingSkills, explanation: text.explanation };
}
