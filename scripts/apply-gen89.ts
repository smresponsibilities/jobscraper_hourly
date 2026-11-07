// scripts/apply-gen89.ts
import * as fs from 'node:fs';

// 1. Update src/autoapply/self-learning.ts
let selfLearning = fs.readFileSync('src/autoapply/self-learning.ts', 'utf8');
const slTarget = "const q = rawQuestion.replace(/[\\u2731*]/g, '').replace(/\\s+/g, ' ').trim().toLowerCase();";
const slAddition = `
  // Ticket GEN-89: Single-Option Dropdown / Radio Auto-Select (e.g. YipitData PDF Resume Acknowledgment)
  if (options && options.length > 0) {
    const cleanOptions = options.filter(o => o && o.trim() && !/^(?:select|choose|--|placeholder)/i.test(o.trim()));
    if (cleanOptions.length === 1) {
      return cleanOptions[0]!;
    }
  }

  // Ticket GEN-89: Social Profile Links (Facebook, Twitter/X, Instagram, Threads, TikTok)
  if (/\\b(facebook|twitter|x\\s*\\(twitter\\)|instagram|threads|tiktok)\\b/i.test(q)) {
    return 'https://github.com/smresponsibilities';
  }

  // Ticket GEN-89: GitLab RBAC / Authorization Concepts
  if (/\\b(authorization concepts|rbac|access control|authentication|oauth|mtls|iam|ciam|fine-grained permissions)\\b/i.test(q)) {
    if (options && options.length > 0) {
      return options.find(o => /^(yes|true)$/i.test(o.trim())) || options.find(o => /yes/i.test(o)) || options[0]!;
    }
    return 'Yes, extensive hands-on experience implementing Role-Based Access Control (RBAC), OAuth2/OIDC, and fine-grained permissions across microservices and data pipelines.';
  }

  // Ticket GEN-89: Flextrade FIX Protocol & Domain Protocols
  if (/\\b(fix protocol|financial information exchange)\\b/i.test(q)) {
    if (options && options.length > 0) {
      return options.find(o => /^(no|false)$/i.test(o.trim())) || options.find(o => /no/i.test(o)) || 'No';
    }
    return 'No';
  }

  // Ticket GEN-89: ERP / Accounting Systems
  if (/\\b(accounting|erp|systems|software|financial data)\\b/i.test(q)) {
    if (options && options.length > 0) {
      return options.find(o => /none|none of the above|n\\/a|other|sql/i.test(o)) || options[options.length - 1]!;
    }
    return 'SQL, PostgreSQL';
  }`;

if (!selfLearning.includes('Ticket GEN-89: Single-Option Dropdown')) {
  selfLearning = selfLearning.replace(slTarget, slTarget + slAddition);
  fs.writeFileSync('src/autoapply/self-learning.ts', selfLearning, 'utf8');
  console.log('Updated src/autoapply/self-learning.ts');
}

// 2. Update src/autoapply/runner.ts
let runner = fs.readFileSync('src/autoapply/runner.ts', 'utf8');

// A) Social profile links skip/fill in runner.ts around line 1290
const runnerPrefixTarget = "        // Ticket GEN-84: Map Greenhouse split phone country prefix controls to \"+91\" / \"India (+91)\"";
const runnerSocialAddition = `        // Ticket GEN-89: Social Profile Links (Facebook, Twitter, etc.)
        if (/\\b(facebook|twitter|x\\s*\\(twitter\\)|instagram|threads|tiktok)\\b/i.test(descriptor)) {
          if (!info.required) {
            action.status = 'skipped';
            continue;
          } else {
            value = info.type === 'url' || /url|link/i.test(descriptor) ? 'https://github.com/smresponsibilities' : 'N/A';
          }
        }

`;

if (!runner.includes('Ticket GEN-89: Social Profile Links')) {
  runner = runner.replace(runnerPrefixTarget, runnerSocialAddition + runnerPrefixTarget);
  console.log('Added social profile links handler to runner.ts');
}

// B) Single-option auto-select in runner.ts in select
const selectTarget = "            let best = matchChoices(choices);";
const selectAddition = `            let best = matchChoices(choices);
            // Ticket GEN-89: Auto-select single valid non-placeholder option
            const cleanChoices = choices.filter(c => c.value && !/^(select|choose|--|none|placeholder)/i.test(c.value) && !/^(select|choose|--)/i.test(c.label.trim()));
            if (!best && cleanChoices.length === 1) {
              best = cleanChoices[0]!;
            }`;

if (!runner.includes('Ticket GEN-89: Auto-select single valid non-placeholder option')) {
  runner = runner.replace(selectTarget, selectAddition);
  console.log('Added single-option select handler to runner.ts');
}

// C) Checkbox fallback in runner.ts self-heal
const checkboxTarget = "                if (/none|n\\/a|not applicable|other|neither|no experience/i.test(labelText)) {";
const checkboxReplacement = "                if (/none|none of the above|n\\/a|not applicable|other|neither|no experience|sql/i.test(labelText)) {";
if (runner.includes(checkboxTarget)) {
  runner = runner.replace(checkboxTarget, checkboxReplacement);
  console.log('Updated checkbox self-heal pattern in runner.ts');
}

fs.writeFileSync('src/autoapply/runner.ts', runner, 'utf8');

console.log('GEN-89 edits applied cleanly.');
