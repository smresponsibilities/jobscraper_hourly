import fs from 'node:fs';
import path from 'node:path';
import { classifyAtsField } from '../src/autoapply/classifier.js';
import { resolveCandidateAnswer } from '../src/autoapply/answers.js';
import { loadProfile } from '../src/autoapply/profile.js';
import { synthesizeNewDeterministicRule, normalizeQuestionKey } from '../src/autoapply/self-learning.js';

const profile = loadProfile('state/autoapply/portal-review/candidate.json');
const ledgerPath = path.resolve('state/autoapply/portal-review/unknown-fields-ledger.json');

if (!fs.existsSync(ledgerPath)) {
  console.log('No ledger file found at', ledgerPath);
  process.exit(1);
}

const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const list = Array.isArray(ledger) ? ledger : Object.values(ledger);

let resolved = 0;
let unresolved = 0;
const stillUnresolved: any[] = [];
const synthesizedRules: any[] = [];

for (const item of list as any[]) {
  const rawQ = item.questionText || item.label || item.name || '';
  if (!rawQ) continue;
  const q = rawQ.replace(/\s+(?:Yes|No)$/, '').replace(/\*$/, '').trim();
  const options = item.options || [];
  const field = { label: q, name: q, type: item.type || 'text', options };
  const classification = classifyAtsField(field);
  const context = { url: 'https://boards.greenhouse.io/test/jobs/1', question: q, options, fieldType: item.type || 'text' };
  let ans: any = null;
  try {
    ans = resolveCandidateAnswer(classification.category, profile, context);
  } catch (err) {}

  if (ans && ans.value !== undefined && ans.value !== null && ans.value !== '') {
    resolved++;
  } else {
    // Attempt UCB1 / deterministic rule synthesis
    const rule = synthesizeNewDeterministicRule(q, profile);
    if (rule && rule.resolvedValue && rule.factKey) {
      resolved++;
      synthesizedRules.push(rule);
    } else {
      unresolved++;
      stillUnresolved.push({ q, cat: classification.category });
    }
  }
}

const total = resolved + unresolved;
const passRate = ((resolved / total) * 100).toFixed(1) + '%';
console.log(JSON.stringify({ resolved, unresolved, total, passRate, synthesizedCount: synthesizedRules.length }, null, 2));

// Assert resolution rate >= 98.0%
const rateNum = (resolved / total) * 100;
if (rateNum < 98.0) {
  console.error(`[FAIL] Resolution rate ${passRate} below required 98.0% (>= 230/234 threshold).`);
  console.log('Remaining unresolved:', stillUnresolved);
  process.exit(1);
}

// Assert 0 rules missing factKey
const invalidRules = synthesizedRules.filter(r => !r.factKey || r.factKey.startsWith('inferred.custom'));
if (invalidRules.length > 0) {
  console.error('[FAIL] Synthesized rules missing grounded factKey:', invalidRules);
  process.exit(1);
}

console.log('[TEST-GEN-533 PASS] Replay resolved', resolved, '/', total, `(${passRate}) with 100% grounded factKeys.`);
