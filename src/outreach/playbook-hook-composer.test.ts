import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composePersonaOutreachEmail } from './playbook-hook-composer.js';
test('drafts claim an application only when receipt verification is supplied', () => {
  const params = { recipientName: 'Fixture', recipientRole: 'ENGINEERING_LEAD' as const, companyName: 'Example', jobTitle: 'Engineer', ossSignal: { repoOrPkgName: 'example/repo', techStack: 'TypeScript' } };
  const draft = composePersonaOutreachEmail(params);
  assert.match(draft.bodyText, /interested/);
  assert.doesNotMatch(draft.bodyText, /I applied/);
  assert.match(draft.bodyText, /example\/repo/);
  assert.equal(draft.citedPortfolioUrl, 'https://shivammahajan.com/projects/');
  assert.match(composePersonaOutreachEmail({ ...params, applicationReceiptVerified: true }).bodyText, /I applied/);
  assert.doesNotMatch(composePersonaOutreachEmail({ ...params, recipientRole: 'RECRUITER' }).bodyText, /sponsorship|2,600/);
});
