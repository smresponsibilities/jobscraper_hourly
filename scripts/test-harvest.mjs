import fs from 'node:fs';

const raw = fs.readFileSync('companies.json', 'utf8');
const companies = JSON.parse(raw);
const counts = {};
for (const c of companies) {
  counts[c.ats] = (counts[c.ats] || 0) + 1;
}
console.log('COMPANIES BY ATS:', counts);
console.log('TOTAL COMPANIES:', companies.length);
