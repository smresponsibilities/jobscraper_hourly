#!/usr/bin/env node
/**
 * Unified CLI for reverse-engineered intelligence tools:
 * 1. Simplify ATS extractors & profile mapper
 * 2. Teal DOM pipeline, likeness scoring, and compensation extraction
 * 3. Jobscan ATS keyword hard match & density scoring
 * 4. Rezi ATS resume parsing, section standardization, and impact auditing
 */

import fs from 'fs';
import { extractAtsIdentity, getAtsSelectors } from './simplify/extractors.js';
import { classifyFormField, resolveProfileValue, CandidateProfile } from './simplify/profile-mapping.js';
import { evaluateJobLikeness } from './teal/job-likeness.js';
import { extractCompensation } from './teal/compensation.js';
import { scoreResumeAgainstJd } from './matching/ats-scorer.js';
import { auditResume } from './resume/ats-validator.js';
import { scoreResumeWorded } from './resume/resumeworded-engine.js';

function printHelp() {
  console.log(`
ATS Intelligence Suite (Simplify, Teal, Jobscan, Rezi, Resume Worded Engines)

Usage:
  npx tsx src/ats-tools.ts <command> [options]

Commands:
  clip <url>                             Extract ATS identity and DOM selectors (Simplify)
  likeness <html-file-or-string>         Evaluate Job Application Likeness (Teal)
  salary <text>                          Extract & score compensation (Teal)
  match --resume <file> --jd <file>      ATS hard match scoring (Jobscan / Simplify)
  audit --resume <file>                  ATS formatting & impact audit (Rezi)
  worded --resume <file>                 4-Pillar Score My Resume audit (Resume Worded)
`);
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp();
    process.exit(0);
  }

  switch (cmd) {
    case 'clip': {
      const url = args[1];
      if (!url) {
        console.error('Error: missing URL');
        process.exit(1);
      }
      const identity = extractAtsIdentity(url);
      if (!identity) {
        console.log('Unrecognized ATS platform for URL:', url);
        process.exit(0);
      }
      const selectors = getAtsSelectors(identity.ats);
      console.log(JSON.stringify({ identity, selectors }, null, 2));
      break;
    }

    case 'likeness': {
      const input = args[1];
      if (!input) {
        console.error('Error: missing html input or file path');
        process.exit(1);
      }
      const html = fs.existsSync(input) ? fs.readFileSync(input, 'utf8') : input;
      const res = evaluateJobLikeness(html);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'salary': {
      const text = args.slice(1).join(' ');
      if (!text) {
        console.error('Error: missing text');
        process.exit(1);
      }
      const res = extractCompensation(text);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'match': {
      const resumeIdx = args.indexOf('--resume');
      const jdIdx = args.indexOf('--jd');
      if (resumeIdx === -1 || jdIdx === -1 || !args[resumeIdx + 1] || !args[jdIdx + 1]) {
        console.error('Usage: match --resume <path> --jd <path>');
        process.exit(1);
      }
      const resumePath = args[resumeIdx + 1]!;
      const jdPath = args[jdIdx + 1]!;
      const resumeText = fs.readFileSync(resumePath, 'utf8');
      const jdText = fs.readFileSync(jdPath, 'utf8');
      const report = scoreResumeAgainstJd(resumeText, jdText);
      console.log(JSON.stringify(report, null, 2));
      break;
    }

    case 'audit': {
      const resumeIdx = args.indexOf('--resume');
      const path = resumeIdx !== -1 ? args[resumeIdx + 1] : args[1];
      if (!path) {
        console.error('Usage: audit --resume <path>');
        process.exit(1);
      }
      const resumeText = fs.readFileSync(path, 'utf8');
      const report = auditResume(resumeText);
      console.log(JSON.stringify(report, null, 2));
      break;
    }

    case 'worded': {
      const resumeIdx = args.indexOf('--resume');
      const path = resumeIdx !== -1 ? args[resumeIdx + 1] : args[1];
      if (!path) {
        console.error('Usage: worded --resume <path>');
        process.exit(1);
      }
      const resumeText = fs.readFileSync(path, 'utf8');
      const report = scoreResumeWorded(resumeText);
      console.log(JSON.stringify(report, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

main();
