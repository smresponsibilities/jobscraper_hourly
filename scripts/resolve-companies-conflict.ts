// scripts/resolve-companies-conflict.ts
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

const headJson = execSync('git show HEAD:companies.json', { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
const remoteJson = execSync('git show origin/main:companies.json', { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

const headCompanies: any[] = JSON.parse(headJson);
const remoteCompanies: any[] = JSON.parse(remoteJson);

console.log(`HEAD companies: ${headCompanies.length}`);
console.log(`Remote companies: ${remoteCompanies.length}`);

const key = (c: any) => `${c.ats || ''}:${(c.token || c.name || '').toLowerCase()}`;

const seen = new Map<string, any>();

// Add remote companies first
for (const c of remoteCompanies) {
  seen.set(key(c), c);
}

// Add local companies (merging/updating)
for (const c of headCompanies) {
  const k = key(c);
  if (!seen.has(k)) {
    seen.set(k, c);
  } else {
    // Preserve local fields if newer or specified
    seen.set(k, { ...seen.get(k), ...c });
  }
}

const merged = Array.from(seen.values());
console.log(`Merged total companies: ${merged.length}`);

fs.writeFileSync('companies.json', JSON.stringify(merged, null, 2) + '\n', 'utf8');
console.log('Successfully resolved companies.json merge conflict.');
