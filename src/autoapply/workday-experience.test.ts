import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from 'patchright';
import { AutoApplyRunner } from './runner.js';
import type { CandidateExtendedProfile } from './types.js';

function row(kind: string, index: string) {
  const text = kind === 'workExperience'
    ? `<label>Job Title<input id="${kind}-${index}--jobTitle" required></label><label>Company<input id="${kind}-${index}--company" required></label>`
    : `<label>School<input id="${kind}-${index}--school" required></label><label>Degree<input id="${kind}-${index}--degree" required></label>`;
  const dates = ['startDate', 'endDate'].map(date => `<div data-fkit-id="${kind}-${index}--${date}"><label>${date === 'startDate' ? 'From' : 'To'} Date</label><input id="${kind}-${index}--${date}-month" data-automation-id="dateSectionMonth-input" role=spinbutton required><input id="${kind}-${index}--${date}-year" data-automation-id="dateSectionYear-input" role=spinbutton required></div>`).join('');
  return `<div id="${kind}-${index}">${text}${dates}</div>`;
}

const html = `<form><h1>My Experience</h1><div id=workExperienceSection role=group aria-label="Work Experience"><button type=button onclick="add('workExperience')">Add</button></div><div id=educationSection role=group aria-label="Education"><button type=button onclick="add('education')">Add</button></div><div role=group aria-labelledby=resume-heading><h4 id=resume-heading>Resume/CV</h4><div data-automation-id=attachments-FileUpload>Drop files here<input id=opaque-upload type=file data-automation-id=file-upload-input-ref style="display:none"></div></div><button>Submit application</button></form><script>const templates=${JSON.stringify({ workExperience: row('workExperience', 'ROW'), education: row('education', 'ROW') })};const counts={workExperience:6,education:5};function add(kind){document.getElementById(kind+'Section').insertAdjacentHTML('beforeend',templates[kind].replaceAll('ROW',String(++counts[kind])));}</script>`;

async function fixture(profile: CandidateExtendedProfile, check: (page: Page, report: Awaited<ReturnType<AutoApplyRunner['run']>>) => Promise<void>) {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, headless: false });
    await check((runner as unknown as { page: Page }).page, report);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

const base = { personal: { firstName: 'Synthetic', email: 'fixture@example.test', country: 'India' }, professional: {}, workAuthorization: {}, eeo: {} };

test('Workday education Add scrolls clear of a fixed footer before native click', async () => {
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<div style="height:1000px"></div><div role=group aria-label=Education><button type=button onclick="this.insertAdjacentHTML(\'beforebegin\',\'<label>School<input id=education-8--school required></label>\')">Add</button></div><div style="height:1000px"></div><button>Submit application</button><footer style="position:fixed;bottom:0;left:0;width:100%;height:180px;background:white;z-index:10">Fixed footer</footer>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  const runner = new AutoApplyRunner();
  try {
    await runner.initBrowser(true);
    const profile = { ...base, education: [{ school: 'Fixture University' }], experience: [] } as unknown as CandidateExtendedProfile;
    const report = await runner.run({ url: `http://127.0.0.1:${address.port}/`, profile, headless: false });
    assert.match(report.reason || '', /Ready for submission review/);
    assert.equal(await (runner as unknown as { page: Page }).page.locator('[id="education-8--school"]').inputValue(), 'Fixture University');
    assert.equal(!!report.submissionAttempted, false);
  } finally { await runner.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Workday adds indexed rows, fills split dates without cross-record leakage and uploads hidden Resume/CV', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'workday-resume-'));
  const resume = path.join(directory, 'fixture.pdf'); writeFileSync(resume, 'Synthetic resume bytes');
  const profile = { ...base, documents: { resume }, experience: [
    { company: 'First Employer', title: 'Engineer', startDate: '2025-08', endDate: '2026-08', current: false },
    { company: 'Second Employer', title: 'Intern', startDate: '2024-06', endDate: '2024-12', current: false },
  ], education: [
    { school: 'First School', degree: 'BE', fieldOfStudy: 'Computer Science', startDate: '2022-08', endDate: '2026-08' },
    { school: 'Second School', degree: 'Diploma', fieldOfStudy: 'Computing', startDate: '2020-07', endDate: '2022-05' },
  ] } as unknown as CandidateExtendedProfile;
  await fixture(profile, async (page, report) => {
    assert.match(report.reason!, /Ready for submission review/, JSON.stringify(report.actions.filter(action => action.status === 'failed')));
    for (const [id, expected] of Object.entries({ 'workExperience-7--company': 'First Employer', 'workExperience-8--company': 'Second Employer', 'workExperience-7--startDate-month': '08', 'workExperience-7--endDate-year': '2026', 'workExperience-8--startDate-month': '06', 'workExperience-8--endDate-month': '12', 'education-6--school': 'First School', 'education-7--school': 'Second School', 'education-6--startDate-year': '2022', 'education-6--endDate-month': '08', 'education-7--startDate-month': '07', 'education-7--endDate-year': '2022' })) assert.equal(await page.locator('[id=' + JSON.stringify(id) + ']').inputValue(), expected, id);
    assert.equal(await page.locator('#opaque-upload').evaluate(async element => (element as HTMLInputElement).files?.[0]?.text()), 'Synthetic resume bytes');
  });
});

test('Workday split-date months remain unknown when the profile supplies only years', async () => {
  const profile = { ...base, experience: [], education: [{ school: 'Fixture School', degree: 'BE', fieldOfStudy: 'Computing', startYear: '2022', graduationYear: '2026' }] } as unknown as CandidateExtendedProfile;
  await fixture(profile, async (page, report) => {
    assert.equal(report.reviewKind, 'answers');
    assert.equal(await page.locator('[id="education-6--startDate-month"]').inputValue(), '');
    assert.equal(await page.locator('[id="education-6--startDate-year"]').inputValue(), '2022');
    assert.equal(await page.locator('[id="education-6--endDate-year"]').inputValue(), '2026');
  });
});
