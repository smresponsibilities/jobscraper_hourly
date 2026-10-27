/**
 * Auto-Apply CLI Entrypoint.
 * Usage: tsx src/autoapply/cli.ts --url <job_url> [--mode stealth|copilot] [--dry-run]
 */

import { AutoApplyRunner } from './runner.js';
import type { CandidateExtendedProfile, RunnerMode } from './types.js';

// Default candidate profile (customizable or read from local config)
const DEFAULT_PROFILE: CandidateExtendedProfile = {
  personal: {
    firstName: 'Candidate',
    lastName: 'User',
    email: 'candidate@example.com',
    phone: '+91 9876543210',
    phoneCountryCode: '+91',
    city: 'Bengaluru',
    state: 'Karnataka',
    country: 'India',
    linkedinUrl: 'https://linkedin.com/in/candidate',
    githubUrl: 'https://github.com/candidate',
  },
  education: [
    {
      school: 'IIT Madras',
      degree: 'B.Tech',
      fieldOfStudy: 'Computer Science',
      gpa: '8.8/10',
      graduationYear: '2026',
    },
  ],
  experience: [],
  professional: {
    totalYearsExperience: 1,
    currentTitle: 'Software Engineer Intern',
    noticePeriodDays: 0,
    expectedSalary: 1500000,
    willingToRelocate: true,
    workPreference: 'hybrid',
  },
  workAuthorization: {
    authorizedInCountry: true,
    requiresSponsorshipNowOrFuture: false,
    formerEmployee: false,
    hasNonCompete: false,
    hasSecurityClearance: false,
    felonyConviction: false,
  },
  eeo: {
    gender: 'Prefer not to say',
    raceOrEthnicity: 'Asian',
    isHispanicLatino: false,
    veteranStatus: 'I am not a protected veteran',
    disabilityStatus: 'No, I do not have a disability',
  },
};

async function main() {
  const args = process.argv.slice(2);
  let url = '';
  let mode: RunnerMode = 'copilot';
  let dryRun = false;
  let headed = false;
  let profile = DEFAULT_PROFILE;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    if (arg === '--url' && nextArg) {
      url = nextArg;
      i++;
    } else if (arg && (arg.startsWith('http://') || arg.startsWith('https://') || arg.startsWith('file://'))) {
      url = arg;
    } else if (arg === '--mode' && nextArg) {
      mode = nextArg as RunnerMode;
      i++;
    } else if (arg === '--profile' && nextArg) {
      const profPath = nextArg;
      i++;
      try {
        const fs = await import('node:fs');
        profile = JSON.parse(fs.readFileSync(profPath, 'utf8'));
      } catch (err: any) {
        console.warn(`Could not load profile from ${profPath}: ${err.message}. Using default.`);
      }
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--headed') {
      headed = true;
    }
  }

  if (!url) {
    console.log('Jobscraper Auto-Apply Bot Runner');
    console.log('Reverse-engineered from FastApply, JobWizard, Jobright, AIHawk & Autoaply');
    console.log('\nUsage:');
    console.log('  npm run auto-apply -- --url <job_application_url> [options]');
    console.log('\nOptions:');
    console.log('  --mode <copilot|stealth>  Execution mode (default: copilot)');
    console.log('  --dry-run                 Inspect fields without mutating DOM');
    console.log('  --headed                  Launch visible browser window');
    process.exit(0);
  }

  console.log(`Starting Auto-Apply Runner in ${mode.toUpperCase()} mode...`);
  console.log(`Target: ${url}\n`);

  const runner = new AutoApplyRunner();
  const report = await runner.run({
    url,
    profile,
    mode,
    dryRun,
    headless: !headed,
  });

  console.log('\n================ Execution Report ================');
  console.log(`Status: ${report.status}`);
  console.log(`ATS: ${report.ats}`);
  console.log(`Steps Traversed: ${report.stepsTraversed}`);
  console.log(`Fields Found: ${report.fieldsFound}`);
  console.log(`Fields Filled: ${report.fieldsFilled}`);
  console.log(`Unmapped Fields: ${report.unmappedFields}`);
  console.log('==================================================');
}

main().catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
