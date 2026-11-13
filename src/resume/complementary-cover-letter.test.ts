import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'patchright';
import { generateComplementaryCoverLetterText, inspectPdfPageCount } from './deterministic-builder.js';
import { buildCoverLetterDocx, buildCoverLetterHtml } from './cover-letter-builder.js';

test('cover letter uses complementary project evidence and bounded keywords', () => {
  const params = { companyName: 'Example Company', jobTitle: 'Data Engineer', jdText: 'ClickHouse data engineering ETL TypeScript SQL pipeline', resumeSelectedProjectIds: ['ClickHouse OLAP Data Ingestion Tool'] };
  const letter = generateComplementaryCoverLetterText(params);
  assert(letter.wordCount >= 180 && letter.wordCount <= 280);
  assert.equal(letter.keywordDensityOk, true);
  assert.equal(letter.citedProjects.length, 2);
  assert(!letter.citedProjects.includes(params.resumeSelectedProjectIds[0]!));
  assert.match(letter.text, /Example Company/);
  assert.match(letter.text, /Data Engineer/);
  assert.match(letter.text, /5,000,000 events/);
  assert.doesNotMatch(letter.text, /5,000,000 daily/i);
  assert.match(letter.text, /https:\/\/shivammahajan\.com\/projects\//);
  const fallback = generateComplementaryCoverLetterText({ ...params, jdText: '' });
  assert(fallback.wordCount >= 180 && fallback.wordCount <= 280);
  assert.throws(() => generateComplementaryCoverLetterText({ ...params, companyName: '' }));
  assert.throws(() => generateComplementaryCoverLetterText({ ...params, jobTitle: 'Java Java Java Java Java' }), /keyword density/);
});

test('cover letter templates use configured contacts and escape job text', async () => {
  const email = process.env.AUTOAPPLY_EMAIL;
  const phone = process.env.AUTOAPPLY_PHONE;
  try {
    process.env.AUTOAPPLY_EMAIL = 'fixture@example.test';
    process.env.AUTOAPPLY_PHONE = '0000000000';
    const html = buildCoverLetterHtml({ company: 'Example <Company>', roleTitle: 'Engineer', jdText: 'React JavaScript' });
    assert.match(html, /fixture@example\.test/);
    assert.match(html, /0000000000/);
    assert.match(html, /Example &lt;Company&gt;/);
    assert.doesNotMatch(html, /5,000,000\+? daily/);
    const docx = await buildCoverLetterDocx({ company: 'Example', roleTitle: 'Engineer', jdText: 'React JavaScript' });
    assert.equal(docx.subarray(0, 2).toString(), 'PK');
  } finally {
    if (email === undefined) delete process.env.AUTOAPPLY_EMAIL; else process.env.AUTOAPPLY_EMAIL = email;
    if (phone === undefined) delete process.env.AUTOAPPLY_PHONE; else process.env.AUTOAPPLY_PHONE = phone;
  }
});

test('representative cover letter renders on one PDF page', async () => {
  const letter = generateComplementaryCoverLetterText({ companyName: 'Example Company', jobTitle: 'Software Engineer', jdText: 'React TypeScript WebSockets backend' });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const escaped = letter.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await page.setContent(`<style>body{font:11pt Arial;line-height:1.5;white-space:pre-wrap}</style><body>${escaped}</body>`);
    const pdf = await page.pdf({ format: 'A4', margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' } });
    assert.equal(inspectPdfPageCount(pdf), 1);
  } finally { await browser.close(); }
});
