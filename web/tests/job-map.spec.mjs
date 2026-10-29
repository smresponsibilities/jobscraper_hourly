import { test, expect } from 'playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cities = [
  ['Bengaluru', 12.9716, 77.5946], ['Hyderabad', 17.385, 78.4867],
  ['Pune', 18.5204, 73.8567], ['Mumbai', 19.076, 72.8777], ['Chennai', 13.0827, 80.2707],
];
const now = new Date().toISOString();
const offices = [], jobs = [];
for (const [city, lat, lng] of cities) {
  for (let index = 0; index < (city === 'Bengaluru' ? 25 : 1); index++) {
    const company = `${city} Employer ${String(index).padStart(2, '0')}`;
    const id = `${city}:${index}`;
    offices.push({ id, company, city, latitude: lat + index * .0001, longitude: lng + index * .0001,
      officeName: `Campus ${String(index).padStart(2, '0')}`, locality: 'Business district', address: `${index} Campus Road`,
      approximate: false, source: `https://source.example.test/${id}`, retrievedAt: now });
    jobs.push({ id, title: index % 2 ? 'Data Analyst' : 'Software Engineer', company, industry: 'tech',
      location: city, url: `https://jobs.example.test/${encodeURIComponent(id)}`, minYears: 0, maxYears: 1,
      isIntern: false, firstSeen: now, lastSeen: now, workMode: 'onsite' });
  }
}
offices.push({ ...offices[0], id: 'no-jobs', company: 'Employer without current jobs' });
jobs.push({ ...jobs[0], id: 'senior-role', title: 'Senior Software Engineer', minYears: 8, maxYears: 10, url: 'https://jobs.example.test/senior-role' });

test.beforeEach(async ({ context }) => {
  await context.route('**/jobs.json', route => route.fulfill({ json: jobs }));
  await context.route('**/data/offices.json', route => route.fulfill({ json: { version: 1, generatedAt: now, offices } }));
});

test('map starts in the viewport, company cards paginate responsively, and selection closes by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/#map-city=Bengaluru');
  await expect(page.getByRole('status').filter({ hasText: '25 employers' })).toBeVisible();
  const bounds = await page.getByRole('region', { name: /^Company offices in Bengaluru/ }).boundingBox();
  expect(bounds?.y).toBe(0);
  expect(bounds?.height).toBe(1000);
  await page.getByRole('button', { name: 'Companies', exact: true }).click();
  const cards = page.locator('.office-employers > li');
  await expect(cards).toHaveCount(20);
  await page.getByRole('navigation', { name: 'Company pages' }).getByRole('button', { name: 'Next' }).click();
  await expect(cards).toHaveCount(5);
  await page.getByRole('navigation', { name: 'Company pages' }).getByRole('button', { name: 'Previous' }).click();
  await cards.first().getByRole('button').click();
  await expect(page.getByRole('link', { name: 'Location source' })).toBeVisible();
  await expect(page.locator('.job-map-results > .office-jobs a')).toHaveAttribute('href', jobs[0].url);
  await page.getByRole('button', { name: 'Close company details' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Close company details' })).toBeHidden();
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await page.screenshot({ path: join(tmpdir(), 'job-map-desktop-current.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Companies', exact: true }).click();
  await expect(cards).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(tmpdir(), 'job-map-mobile-current.png') });
});

test('shared job filters remain accessible in a modal and empty results keep the map usable', async ({ page }) => {
  await page.goto('/#map-city=Bengaluru');
  await expect(page.getByRole('status').filter({ hasText: '25 employers' })).toBeVisible();
  await page.getByRole('button', { name: /^Job filters/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Job filters' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Internships only', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /^Job filters/ })).toBeFocused();
  await expect(page.getByRole('button', { name: /^Job filters/ })).toHaveText(/1/);
  await expect(page.getByRole('region', { name: /^Company offices in Bengaluru/ })).toBeVisible();
  await page.getByRole('button', { name: 'Companies', exact: true }).click();
  await expect(page.getByText('No sourced employer locations match this city and these filters.')).toBeVisible();
  await page.getByRole('button', { name: /^Job filters/ }).click();
  await dialog.getByRole('button', { name: 'Internships only', exact: true }).click();
  await page.keyboard.press('Escape');
  const search = page.getByRole('searchbox', { name: 'Search companies, offices or jobs' });
  await search.fill('Campus 00');
  await expect(page.locator('.office-employers > li')).toHaveCount(1);
  await search.fill('');
  await page.getByRole('button', { name: 'Switch to light map' }).click();
  await expect(page.getByRole('button', { name: 'Switch to dark map' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to dark map' })).toBeVisible();
  await search.fill('Campus 00');
  await page.getByRole('button', { name: 'Job Radar, return to all jobs' }).click();
  await expect(page.getByRole('heading', { name: 'Job Radar', exact: true })).toBeVisible();
  await expect(page.getByText('Nothing matches those filters.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Map · 5 cities', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Map · 5 cities', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 employers' })).toBeVisible();
});

test('old office bookmarks explain missing jobs without inventing pins', async ({ page }) => {
  await page.goto('/#office=no-jobs');
  await expect(page.getByRole('status').filter({ hasText: 'No current jobs match Employer without current jobs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close company details' })).toBeHidden();
  await page.goto('/#office=removed-office');
  await expect(page.getByRole('status').filter({ hasText: 'This office is no longer in the directory' })).toBeVisible();
});

test('Back restores search and company view together, and invalid filter URLs cannot widen experience', async ({ page }) => {
  await page.goto('/?maxYears=NaN&mode=teleport&industries=invalid#map-city=Bengaluru');
  await expect(page.getByRole('status').filter({ hasText: '25 employers' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Job filters', exact: true })).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search companies, offices or jobs' });
  await search.fill('Campus 00');
  await page.getByRole('button', { name: 'Companies', exact: true }).click();
  await expect(page.locator('.office-employers > li')).toHaveCount(1);
  await page.locator('.office-employers button').first().click();
  await expect(page.getByRole('button', { name: 'Close company details' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Senior Software Engineer', exact: true })).toBeHidden();
  await search.fill('Campus 01');
  await expect(page.getByRole('button', { name: 'Close company details' })).toBeHidden();
  await page.goBack();
  await expect(search).toHaveValue('Campus 00');
  await expect(page.getByRole('button', { name: 'Companies', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.office-employers > li')).toHaveCount(1);
  await expect(page.locator('.office-employers button')).toContainText('Bengaluru Employer 00');
});

test('job-source failures retain retry and access to the rest of the app', async ({ page }) => {
  await page.route('**/jobs.json', route => route.fulfill({ status: 503, body: 'Temporarily unavailable' }));
  await page.goto('/#map-city=Bengaluru');
  await expect(page.getByRole('alert').filter({ hasText: 'Jobs could not load' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All jobs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Job Radar', exact: true })).toBeVisible();
});
