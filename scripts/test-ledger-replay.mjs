import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { classifyAtsField } = require('../out/dist/src/autoapply/classifier.js');
const { resolveCandidateAnswer } = require('../out/dist/src/autoapply/answers.js');
const { loadProfile } = require('../out/dist/src/autoapply/profile.js');

const profile = loadProfile('state/autoapply/portal-review/candidate.json');
const ledgerPath = 'state/autoapply/portal-review/unknown-fields-ledger.json';

if (!fs.existsSync(ledgerPath)) {
  console.log('No ledger file found at', ledgerPath);
  process.exit(1);
}

const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const list = Array.isArray(ledger) ? ledger : Object.values(ledger);

let resolved = 0;
let unresolved = 0;
const stillUnresolved = [];

for (const item of list) {
  const rawQ = item.questionText || item.label || item.name || '';
  if (!rawQ) continue;
  const q = rawQ.replace(/\s+(?:Yes|No)$/, '').replace(/\*$/, '').trim();
  const options = item.options || [];
  const field = { label: q, name: q, type: item.type || 'text', options };
  const classification = classifyAtsField(field);
  const context = { url: 'https://boards.greenhouse.io/test/jobs/1', question: q, options, fieldType: item.type || 'text' };
  let ans = null;
  try {
    ans = resolveCandidateAnswer(classification.category, profile, context);
  } catch (err) {}
  if (ans && ans.value !== undefined && ans.value !== null && ans.value !== '') {
    resolved++;
  } else {
    unresolved++;
    stillUnresolved.push({ q, cat: classification.category });
  }
}

const total = resolved + unresolved;
const passRate = ((resolved / total) * 100).toFixed(1) + '%';
console.log(JSON.stringify({ resolved, unresolved, total, passRate }, null, 2));

if (stillUnresolved.length > 0) {
  console.log('Still unresolved count:', stillUnresolved.length);
  stillUnresolved.forEach((x, i) => console.log(` ${i + 1}. [${x.cat}] ${x.q}`));
}
