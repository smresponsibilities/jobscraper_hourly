import type { Page } from 'patchright';

/** Derive Candidate Home only from the original tenant's Workday URL. */
export function workdayCandidateHomeUrl(applicationUrl: string): string | undefined {
  const url = new URL(applicationUrl);
  if (url.protocol !== 'https:' || !/\.myworkdayjobs\.com$/i.test(url.hostname)) return;
  const parts = url.pathname.split('/').filter(Boolean);
  const locale = /^[a-z]{2}-[a-z]{2}$/i.test(parts[0] || '') ? parts.shift() : undefined;
  const site = parts[0];
  if (!site || parts[1] !== 'job' || !/^[a-z0-9_-]+$/i.test(site)) return;
  return `${url.origin}/${locale ? `${locale}/` : ''}${site}/userHome`;
}

/** Expand Workday's application section only when it contains its header alone. */
export async function expandWorkdayApplications(page: Page): Promise<void> {
  const toggle = page.locator('[data-automation-id="applicationsSectionHeading"] [role="button"]').filter({ visible: true });
  if (await toggle.count() !== 1) return;
  const collapsed = await toggle.evaluate(element => {
    const section = element.closest('[data-automation-id="applicationsSectionHeading"]');
    return !!section && section.children.length === 1;
  });
  if (!collapsed) return;
  await toggle.click();
  await page.waitForFunction(() => {
    const section = document.querySelector('[data-automation-id="applicationsSectionHeading"]');
    return !!section && section.children.length > 1;
  }, undefined, { timeout: 10000 }).catch(() => {});
}

/** A matching ID and submitted status must appear together in a visible application row. */
export async function findWorkdayApplication(page: Page, homeUrl: string, requisitionId: string): Promise<boolean> {
  const expected = new URL(homeUrl);
  const current = new URL(page.url());
  const expectedPath = expected.pathname.replace(/\/$/, '').toLowerCase();
  const currentPath = current.pathname.replace(/\/$/, '').toLowerCase();
  if (current.origin !== expected.origin || ![expectedPath, expectedPath.replace(/\/userhome$/, '/candidatehome')].includes(currentPath)) return false;
  if (!await page.getByRole('heading', { name: /^(?:my applications|application history)$/i }).filter({ visible: true }).count()) return false;
  const rowSelector = '[data-automation-id="applicationCard"],[data-automation-id="applicationRow"],[data-automation-id="applicationItem"],[role="row"],article,li';
  const rows = page.locator(rowSelector).filter({ visible: true });
  const matches = await rows.evaluateAll((elements, { id, selector }) => elements.filter(element => {
    // A section containing multiple rows cannot bind one job's ID to another job's status.
    if (Array.from(element.querySelectorAll(selector)).some(child => child.getClientRects().length > 0)) return false;
    const text = ((element as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
    const identifiers = [text, ...Array.from(element.querySelectorAll('a[href]')).filter(link => link.getClientRects().length > 0).map(link => link.getAttribute('href') || '')];
    const exactId = identifiers.some(value => value.split(/[^a-z0-9-]+/i).some(part => part.toLowerCase() === id.toLowerCase()));
    return exactId && !/\b(?:unsubmitted|draft|(?:not|never|awaiting)\s+(?:yet\s+)?(?:submitted|under review|application received))\b/i.test(text)
      && /\b(?:submitted|under review|application received)\b/i.test(text);
  }).length, { id: requisitionId, selector: rowSelector });
  return matches === 1;
}

/** An explicit, stable empty state is evidence of the account's current list only. */
export async function workdayApplicationsEmpty(page: Page, homeUrl: string): Promise<boolean> {
  const expected = new URL(homeUrl);
  const current = new URL(page.url());
  if (current.origin !== expected.origin || current.pathname.replace(/\/$/, '').toLowerCase() !== expected.pathname.replace(/\/$/, '').toLowerCase()) return false;
  const empty = page.locator('[data-automation-id="applicationsSectionHeading"] [data-automation-id="noApplications"]').filter({ visible: true });
  const loading = page.locator('[data-automation-id="loadingSpinner"],[data-automation-id="wd-LoadingPanel"],[aria-busy="true"]').filter({ visible: true });
  const confirmed = async () => {
    const current = new URL(page.url());
    return current.origin === expected.origin && current.pathname.replace(/\/$/, '').toLowerCase() === expected.pathname.replace(/\/$/, '').toLowerCase()
      && await empty.count() === 1 && await loading.count() === 0 && /\bno applications\b/i.test(await empty.innerText());
  };
  if (!await confirmed()) return false;
  await page.waitForTimeout(2000);
  return await confirmed();
}
