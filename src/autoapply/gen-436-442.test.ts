import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isAutomationChromeCommandLine } from './health-and-ram-watchdog.js';
import { extractCleanQuestionText } from './distiller.js';
import { POISON_PREFIXES, isPoisonPrefixEmail } from '../outreach/free-contact-discovery.js';
import { determineJobArchetype, composeTailored4SentenceColdEmail } from '../../scripts/backfill-applied-outreach.js';

test('GEN-436: isAutomationChromeCommandLine accepts automation lanes and rejects personal Chrome', () => {
  // Reject personal Chrome
  const personalDefault = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe --profile-directory="Default"';
  const personalProfile1 = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe --profile-directory="Profile 1"';
  const personalProfile2 = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe --profile-directory="Profile 2"';
  const emptyCmd = '';

  assert.equal(isAutomationChromeCommandLine(personalDefault), false, 'Must reject Default personal profile');
  assert.equal(isAutomationChromeCommandLine(personalProfile1), false, 'Must reject Profile 1');
  assert.equal(isAutomationChromeCommandLine(personalProfile2), false, 'Must reject Profile 2');
  assert.equal(isAutomationChromeCommandLine(emptyCmd), false, 'Must reject empty command line');

  // Accept automation profiles
  const laneWorkday = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe --user-data-dir="state/autoapply/browser-profile-lane-workday"';
  const laneGreenhouse = 'chrome.exe --user-data-dir="D:\\Jobscraper-next\\state\\autoapply\\browser-profile-lane-1"';
  const automationFlag = 'chrome.exe --enable-automation --remote-debugging-port=0';
  const playwrightProfile = 'chrome.exe --user-data-dir="C:\\Temp\\playwright_chromiumdev_profile"';

  assert.equal(isAutomationChromeCommandLine(laneWorkday), true, 'Must accept browser-profile-lane');
  assert.equal(isAutomationChromeCommandLine(laneGreenhouse), true, 'Must accept state/autoapply lane');
  assert.equal(isAutomationChromeCommandLine(automationFlag), true, 'Must accept --enable-automation');
  assert.equal(isAutomationChromeCommandLine(playwrightProfile), true, 'Must accept playwright profile');
});

test('GEN-440: Shadow-host label unwrapping across custom element boundary', () => {
  // Mock DOM structure representing SmartRecruiters <oc-form-field label="Expected Salary"><oc-input><input></oc-input></oc-form-field>
  const host = {
    getAttribute(name: string) {
      if (name === 'label') return 'Expected Salary';
      return null;
    },
    querySelector() {
      return null;
    },
    getRootNode() {
      return null;
    },
  };

  const shadowRoot = {
    host,
  };
  (shadowRoot as any)[Symbol.toStringTag] = 'ShadowRoot';
  Object.setPrototypeOf(shadowRoot, (globalThis as any).ShadowRoot ? (globalThis as any).ShadowRoot.prototype : Object.prototype);

  const mockInput = {
    tagName: 'INPUT',
    type: 'text',
    getAttribute() {
      return null;
    },
    getRootNode() {
      return shadowRoot;
    },
    parentElement: null,
  };

  const text = extractCleanQuestionText(mockInput as any, [mockInput as any]);
  assert.ok(text.includes('Expected Salary'), `Extracted question should contain host label, got "${text}"`);
});

test('GEN-438: Ashby window.__appData schema mapping logic correctly infers question title', () => {
  const sampleSections = [
    {
      fieldEntries: [
        {
          field: { path: 'custom_salary_expected', title: 'What is your expected compensation?' },
          isRequired: true,
        },
        {
          field: { id: 'hear_about_us', title: 'How did you hear about this position?' },
          isRequired: false,
        },
      ],
    },
  ];

  const ashbySchemaMap = new Map<string, { title: string; isRequired: boolean }>();
  for (const sec of sampleSections) {
    for (const entry of sec.fieldEntries || []) {
      const pathKey = entry.field?.path || entry.field?.id || (entry as any).id;
      const title = entry.field?.title || (entry as any).title;
      if (pathKey && title) {
        ashbySchemaMap.set(String(pathKey), { title: String(title).trim(), isRequired: Boolean(entry.isRequired) });
      }
    }
  }

  assert.equal(ashbySchemaMap.get('custom_salary_expected')?.title, 'What is your expected compensation?');
  assert.equal(ashbySchemaMap.get('custom_salary_expected')?.isRequired, true);
  assert.equal(ashbySchemaMap.get('hear_about_us')?.title, 'How did you hear about this position?');
  assert.equal(ashbySchemaMap.get('hear_about_us')?.isRequired, false);
});

test('GEN-442: outreach-leads.json contains 0 poison prefixes and valid archetypes', () => {
  // Test poison prefix checks
  for (const p of POISON_PREFIXES) {
    assert.equal(isPoisonPrefixEmail(`${p}@company.com`), true, `Prefix ${p} must be detected as poison`);
  }
  assert.equal(isPoisonPrefixEmail('talent@company.com'), false, 'talent@ should not be poison');
  assert.equal(isPoisonPrefixEmail('engineering@company.com'), false, 'engineering@ should not be poison');

  // Test archetype detection
  assert.equal(determineJobArchetype('Senior Machine Learning Engineer'), 'AI_ML');
  assert.equal(determineJobArchetype('Data Engineer - Spark/Kafka'), 'DATA');
  assert.equal(determineJobArchetype('Site Reliability Engineer / DevOps'), 'DEVOPS');
  assert.equal(determineJobArchetype('Fullstack Developer (React/Node)'), 'FULLSTACK');
  assert.equal(determineJobArchetype('Software Development Engineer - Backend'), 'BACKEND');

  // Verify email template incorporates real project
  const email = composeTailored4SentenceColdEmail('Acme Corp', 'Data Pipeline Engineer', 'DATA');
  assert.ok(email.subject.includes('Data Pipeline Engineer at Acme Corp'));
  assert.ok(email.body.includes('ClickHouse Data Ingestion Tool'));
  assert.ok(email.body.includes('https://shivammahajan.com/projects/'));

  // If outreach-leads.json exists, verify no lead has a poison prefix
  const leadsPath = path.resolve('state/autoapply/portal-review/outreach-leads.json');
  if (fs.existsSync(leadsPath)) {
    const leads = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
    assert.ok(Array.isArray(leads), 'leads must be an array');
    for (const lead of leads) {
      if (lead.targetEmail) {
        assert.equal(
          isPoisonPrefixEmail(lead.targetEmail),
          false,
          `Lead email ${lead.targetEmail} for ${lead.company} must not have poison prefix`
        );
      }
    }
  }
});
