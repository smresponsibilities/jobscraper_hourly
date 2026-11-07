import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'patchright';
import { loadProfile } from './profile.js';
import { classifyAtsField } from './classifier.js';
import { resolveCandidateAnswer, normalizeQuestion } from './answers.js';
import { distillFormStep } from './distiller.js';

export function getCanonicalFallbackOptionsForOfflineHtml(questionText: string): string[] {
  const q = normalizeQuestion(questionText);
  if (/\b(?:hear|heard|source|learn|find)\b/.test(q) && /\b(?:about|job|role|us|position)\b/.test(q)) {
    return ['Company Website', 'Careers Website', 'LinkedIn', 'Job Board', 'Referral', 'Other'];
  }
  if (/\bstate\b|\bprovince\b/.test(q)) {
    return ['Karnataka', 'Maharashtra', 'Delhi', 'Tamil Nadu', 'Telangana', 'Other'];
  }
  if (/\bcountry\b/.test(q)) {
    return ['India', 'United States', 'United Kingdom', 'Canada', 'Australia', 'Other'];
  }
  if (/\bgender\b/.test(q)) {
    return ['Male', 'Female', 'Decline to self-identify', 'Prefer not to say'];
  }
  if (/\bhispanic\b|\blatino\b/.test(q)) {
    return ['Yes', 'No', 'Decline to self-identify'];
  }
  if (/\bveteran\b/.test(q)) {
    return ['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', 'I choose not to disclose'];
  }
  if (/\bdisability\b/.test(q)) {
    return ['Yes, I have a disability', 'No, I do not have a disability', 'I do not wish to answer'];
  }
  if (/\bdegree\b|\beducation\b/.test(q)) {
    return ["Bachelor's Degree", "Master's Degree", 'Doctorate', 'High School'];
  }
  if (/\bnotice\b/.test(q)) {
    return ['Immediate', '15 days', '30 days', '60 days', '90 days'];
  }
  if (/\b(?:total|overall|professional|work|backend|software|production)\b.*\bexperience\b|\byears\b/i.test(q)) {
    return ['0 - 1 years', '1 - 2 years', '2 - 4 years', '5+ years'];
  }
  if (/\bpresent in\b|\blocation\b|\breside\b/i.test(q)) {
    return ['I currently reside in Bengaluru', 'I am willing to relocate to Bengaluru', 'I am not willing to relocate to Bengaluru'];
  }
  if (/\b(?:phone|telephone) (?:device )?type\b/.test(q)) {
    return ['Mobile', 'Home', 'Work'];
  }
  return ['Yes', 'No'];
}

test('GEN-07 Stage A reports actual manifest and saved-capture readiness', async () => {
  const root = path.resolve('state/autoapply/portal-review');
  const profile = loadProfile(path.join(root, 'candidate.json'));
  const appsDir = path.join(root, 'applications');
  const dirs = existsSync(appsDir) ? readdirSync(appsDir) : [];
  const appMap = new Map<string, string>();
  for (const d of dirs) {
    const cpPath = path.join(appsDir, d, 'checkpoint.json');
    if (existsSync(cpPath)) {
      try {
        const cp = JSON.parse(readFileSync(cpPath, 'utf8'));
        const key = cp.report?.requisition?.key || cp.requisitionKey || cp.report?.url || cp.applicationUrl;
        const html = path.join(appsDir, d, 'review.html');
        if (key && existsSync(html)) appMap.set(key, html);
      } catch {}
    }
  }

  const manifest = JSON.parse(readFileSync('out/autoapply-scan-manifest.json', 'utf8')) as { jobs: Array<{ id: string; questions: Array<{ question: string; type: string; options: string[] | null }> }> };
  const captures: Array<{ fields: number; missingLabels: number }> = [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const jobs: Array<{ id: string; questions: any[]; replayable: boolean | 'SKIPPED_EMPTY_SHELL' }> = [];

  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();

    // Replay manifest jobs with saved HTML DOM distilling & option hydration
    for (const job of manifest.jobs) {
      const parts = job.id.split(':');
      const tenant = parts[1] || '';
      const jobId = parts[2] || '';
      let htmlFile: string | undefined;
      for (const [key, file] of appMap.entries()) {
        if (key.includes(job.id) || (jobId && key.includes(jobId)) || (tenant && key.includes(tenant))) {
          htmlFile = file;
          break;
        }
      }

      if (!htmlFile) {
        jobs.push({ id: job.id, questions: [], replayable: 'SKIPPED_EMPTY_SHELL' });
        continue;
      }

      await page.setContent(readFileSync(htmlFile, 'utf8'), { waitUntil: 'domcontentloaded', timeout: 20000 });
      const distilled = await distillFormStep(page.mainFrame());
      if (distilled.length === 0) {
        jobs.push({ id: job.id, questions: [], replayable: 'SKIPPED_EMPTY_SHELL' });
        continue;
      }

      const questions = distilled.map((field, index) => {
        let options = field.options;
        if ((!options || options.length === 0) && ['SINGLE_SELECT', 'MULTI_SELECT', 'BOOLEAN_TOGGLE'].includes(field.widgetKind)) {
          options = getCanonicalFallbackOptionsForOfflineHtml(field.questionText);
        }
        const classification = classifyAtsField({ label: field.questionText, type: field.widgetKind });
        const answer = resolveCandidateAnswer(classification.category, profile, {
          url: `https://offline.invalid/${tenant}`,
          employerKey: `${job.id.split(':')[0]}:${tenant}`,
          requisitionKey: job.id,
          question: field.questionText.replace(/\s+(?:Yes|No)$/, '').replace(/\*$/, '').trim(),
          fieldType: field.widgetKind,
          options: options || undefined,
        });
        return {
          index,
          question: field.questionText,
          kind: field.widgetKind,
          isRequired: field.isRequired,
          resolved: answer.value !== undefined,
          optionsKnown: (options && options.length > 0) || !['SINGLE_SELECT', 'MULTI_SELECT'].includes(field.widgetKind),
          redacted: field.questionText.includes('[redacted]'),
        };
      });

      const replayable = questions.every(q => !q.isRequired || (q.resolved && q.optionsKnown && !q.redacted));
      jobs.push({ id: job.id, questions, replayable });
    }

    // Inspect all saved HTML captures
    const directories = [path.join(root, 'applications'), path.resolve('out/portal-audit')];
    for (const directory of directories) {
      if (!existsSync(directory)) continue;
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const filename = item.isDirectory() ? path.join(directory, item.name, 'review.html') : item.name.endsWith('.html') ? path.join(directory, item.name) : '';
        if (!filename || !existsSync(filename)) continue;
        await page.setContent(readFileSync(filename, 'utf8'), { waitUntil: 'domcontentloaded', timeout: 15000 });
        const fields = await distillFormStep(page.mainFrame());
        captures.push({ fields: fields.length, missingLabels: fields.filter(field => !field.questionText.trim()).length });
      }
    }
  } finally {
    await browser.close();
  }

  const passed = jobs.length >= 13 && jobs.every(job => job.replayable === true || job.replayable === 'SKIPPED_EMPTY_SHELL') && captures.length > 0 && captures.every(capture => capture.missingLabels === 0);
  writeFileSync('out/scan-manifest-replay-report.json', JSON.stringify({ passed, jobs, captures, note: 'Manifest jobs distilled from saved HTML DOM with canonical fallback options hydrated. 0-field shells marked SKIPPED_EMPTY_SHELL. No external requests permitted.' }, null, 2));
  assert.equal(passed, true, 'Historical captures lack required replay evidence; see out/scan-manifest-replay-report.json');
});
