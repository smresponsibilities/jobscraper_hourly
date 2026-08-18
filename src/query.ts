import { readFile } from 'node:fs/promises';
import type { CatalogEntry } from './catalog.js';
import { roleFamily } from './filter.js';

/**
 * A second front-end over the catalogue that already exists — no new backend,
 * no new matching logic, just a filter over `data/jobs.json` for local use.
 *
 *   npm run query -- --role swe --company razorpay
 */
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const role = flag('role');
const company = flag('company')?.toLowerCase();
const title = flag('title')?.toLowerCase();

async function main(): Promise<void> {
  const catalog: CatalogEntry[] = JSON.parse(await readFile('data/jobs.json', 'utf8'));

  const matches = catalog.filter((job) => {
    if (job.closedAt) return false;
    if (company && !job.company.toLowerCase().includes(company)) return false;
    if (title && !job.title.toLowerCase().includes(title)) return false;
    if (role && roleFamily(job.title, job.industry) !== role) return false;
    return true;
  });

  console.log(`${matches.length} open match${matches.length === 1 ? '' : 'es'}`);
  for (const job of matches) {
    console.log(`  ${job.company.padEnd(24)} ${job.title.padEnd(50)} ${job.url}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
