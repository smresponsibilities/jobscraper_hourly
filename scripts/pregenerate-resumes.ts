// scripts/pregenerate-resumes.ts
import { generateDualAtsResume, type ResumeArchetype } from '../src/resume/deterministic-builder.js';

async function main() {
  const archetypes: ResumeArchetype[] = ['BACKEND', 'DATA', 'DEVOPS', 'FULLSTACK'];
  for (const arch of archetypes) {
    const res = await generateDualAtsResume(arch);
    console.log(`[GEN-42] Pre-generated ${arch}: docx=${res.docxPath}, pdf=${res.pdfPath}, clean=${res.verifiedClean}, maxFreq=${res.maxTermFrequency}`);
  }
}

main().catch(err => {
  console.error('Failed to pregenerate resumes:', err);
  process.exit(1);
});
