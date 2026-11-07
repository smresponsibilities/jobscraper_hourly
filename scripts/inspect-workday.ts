import { chromium } from 'patchright';

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--headless=new', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  try {
  const url = 'https://cat.wd5.myworkdayjobs.com/en-US/CaterpillarCareers/job/Chennai-Tamil-Nadu/Design-Engineer---Rock-Tools_R0000403362-1';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log('title:', await page.title());
  console.log('body text preview:', (await page.locator('body').innerText()).slice(0, 500));
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
