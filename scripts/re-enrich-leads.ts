import * as fs from 'node:fs';
import * as path from 'node:path';
import { findFreeCompanyLeads, generateColdOutreachDraft } from '../src/leads/free-email-finder.js';
import { loadProfile } from '../src/autoapply/profile.js';

async function main() {
  const filePath = path.resolve('state/autoapply/portal-review/outreach-leads.json');
  const profile = loadProfile(path.resolve('state/autoapply/portal-review/candidate.json'));
  if (!fs.existsSync(filePath)) {
    console.log('No outreach-leads.json found.');
    return;
  }
  const list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`Re-enriching ${list.length} leads in ${filePath}...`);
  const updated = [];
  for (const item of list) {
    console.log(`- Enriching: ${item.company} (${item.roleTitle})`);
    const lead = await findFreeCompanyLeads({
      company: item.company,
    });
    const draft = generateColdOutreachDraft(item.company, item.roleTitle, lead, profile);
    console.log(`  -> Cleaned contact: ${draft.targetEmail} (source: ${draft.source})`);
    updated.push(draft);
  }
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf8');
  console.log('Successfully re-enriched all outreach leads!');
}

main().catch(err => {
  console.error('Failed to re-enrich leads:', err);
  process.exit(1);
});
