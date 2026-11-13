import type { Page } from 'patchright';

export function getMandatoryStealthLaunchArgs(): string[] {
  return ['--headless=new', '--disable-blink-features=AutomationControlled', '--force-webrtc-ip-handling-policy=default_public_interface_only', '--enforce-webrtc-ip-permission-check', '--lang=en-IN,en-US'];
}

/** Report observed browser values; this does not prove absence of all fingerprint leaks. */
export async function verifyPageStealthInvariants(page: Page): Promise<{ passed: boolean; webdriverFalse: boolean; userAgentClean: boolean; timezoneValid: boolean; languagesValid: boolean; issues: string[] }> {
  const observed = await page.evaluate(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let timezoneValid = false;
    try { timezoneValid = !!zone && !!new Intl.DateTimeFormat('en', { timeZone: zone }).format(); } catch { /* Invalid zone. */ }
    return { webdriverFalse: navigator.webdriver === false || navigator.webdriver === undefined, userAgentClean: !/HeadlessChrome/i.test(navigator.userAgent), timezoneValid, languagesValid: Array.isArray(navigator.languages) && navigator.languages.length > 0 };
  });
  const issues = Object.entries(observed).filter(([, valid]) => !valid).map(([key]) => key);
  return { passed: issues.length === 0, ...observed, issues };
}
