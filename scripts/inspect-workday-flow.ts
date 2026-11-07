import { chromium } from 'patchright';

async function main() {
  const args = ['--headless=new', '--window-size=1280,900', '--disable-blink-features=AutomationControlled'];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  try {
    await page.goto('https://equifax.wd5.myworkdayjobs.com/en-US/external/job/IND-Pune-Equifax-Analytics-PEC/Data-Scientist---Intermediate_J00179982', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    console.log('Main URL:', page.url());
    const applyBtn = page.getByRole('link', { name: /^apply$/i }).or(page.getByRole('button', { name: /^apply$/i })).first();
    console.log('Apply btn visible:', await applyBtn.isVisible().catch(() => false));
    if (await applyBtn.isVisible().catch(() => false)) {
      await applyBtn.click();
      await page.waitForTimeout(2000);
      console.log('After click 1 URL:', page.url());
      const manualBtn = page.getByRole('link', { name: /apply manually/i }).or(page.getByRole('button', { name: /apply manually/i })).first();
      console.log('Manual btn visible:', await manualBtn.isVisible().catch(() => false));
      if (await manualBtn.isVisible().catch(() => false)) {
        await manualBtn.click();
        await page.waitForTimeout(4000);
        console.log('After click 2 URL:', page.url());
        const headings = await page.locator('h1, h2, h3, [role="heading"]').allTextContents();
        console.log('Headings:', headings);
        const inputs = await page.locator('input, button, a').evaluateAll(els => els.map(e => ({ tag: e.tagName, type: (e as HTMLInputElement).type, text: e.textContent?.trim().slice(0, 40), dataAuto: e.getAttribute('data-automation-id') })));
        console.log('Controls count:', inputs.length);
        console.log('Controls sample:', JSON.stringify(inputs.filter(i => i.dataAuto || i.type === 'password' || i.type === 'email' || /sign|create|account|apply/i.test(i.text || '')), null, 2));
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
