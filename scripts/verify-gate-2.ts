// scripts/verify-gate-2.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateResumeHtml, verifyNoKeywordStuffing, type ResumeArchetype } from '../src/resume/deterministic-builder.js';

const archetypes: ResumeArchetype[] = ['BACKEND', 'DATA', 'DEVOPS', 'FULLSTACK'];
const dir = path.resolve('state/autoapply/resumes');
let allClean = true;

console.log('--- Verifying Files on Disk in state/autoapply/resumes/ ---');
for (const arch of archetypes) {
  const docx = path.join(dir, `Shivam_Mahajan_Resume_${arch}.docx`);
  const pdf = path.join(dir, `Shivam_Mahajan_Resume_${arch}.pdf`);
  const docxExists = fs.existsSync(docx);
  const pdfExists = fs.existsSync(pdf);
  const docxSize = docxExists ? fs.statSync(docx).size : 0;
  const pdfSize = pdfExists ? fs.statSync(pdf).size : 0;
  console.log(`${arch}: DOCX exists=${docxExists} (${docxSize} bytes), PDF exists=${pdfExists} (${pdfSize} bytes)`);
  if (!docxExists || !pdfExists || docxSize === 0 || pdfSize === 0) {
    allClean = false;
  }
}

console.log('\n--- Verifying verifyNoKeywordStuffing for All 4 Archetypes ---');
const profile = JSON.parse(fs.readFileSync('state/autoapply/portal-review/candidate.json', 'utf8'));
for (const arch of archetypes) {
  const html = generateResumeHtml(profile, arch);
  const check = verifyNoKeywordStuffing(html);
  console.log(`${arch} density check: clean=${check.clean}, maxFreq=${check.maxFreq} (< 0.025)`);
  if (!check.clean || check.maxFreq >= 0.025) {
    allClean = false;
  }
}

if (!allClean) {
  console.error('\nFAIL: Gate 2 check failed!');
  process.exit(1);
} else {
  console.log('\nSUCCESS: All 8 resume files exist and pass verifyNoKeywordStuffing (Gate 2 Passed 100%)');
}
