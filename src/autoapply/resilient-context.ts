import { type Browser, type BrowserContext } from 'patchright';
import * as fs from 'node:fs';
import { newInjectedContext } from 'fingerprint-injector';

export interface ResilientContextOptions {
  storageStatePath?: string;
  forceTier?: 1 | 2 | 3;
  locale?: string;
  timezoneId?: string;
}

export function getResilientContextTier(context: BrowserContext | null | undefined): number | undefined {
  if (!context) return undefined;
  return (context as any).__resilientTier;
}

export async function createTier1Context(
  browser: Browser,
  storageStatePath?: string,
  options?: ResilientContextOptions
): Promise<BrowserContext> {
  const context = (await newInjectedContext(browser as any, {
    fingerprintOptions: {
      devices: ['desktop'],
      operatingSystems: ['windows'],
      locales: ['en-IN', 'en-US'],
    },
    newContextOptions: {
      storageState: storageStatePath && fs.existsSync(storageStatePath) ? storageStatePath : undefined,
      locale: options?.locale ?? 'en-IN',
      timezoneId: options?.timezoneId ?? 'Asia/Calcutta',
      viewport: null,
    },
  })) as unknown as BrowserContext;
  (context as any).__resilientTier = 1;
  return context;
}

export async function createTier2Context(
  browser: Browser,
  storageStatePath?: string,
  options?: ResilientContextOptions
): Promise<BrowserContext> {
  const context = await browser.newContext({
    storageState: storageStatePath && fs.existsSync(storageStatePath) ? storageStatePath : undefined,
    locale: options?.locale ?? 'en-IN',
    timezoneId: options?.timezoneId ?? 'Asia/Calcutta',
    viewport: null,
  });

  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-IN', 'en-US', 'en'],
        configurable: true,
      });
      Object.defineProperty(navigator, 'language', {
        get: () => 'en-IN',
        configurable: true,
      });
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
      if ('userAgentData' in navigator) {
        Object.defineProperty(navigator, 'userAgentData', {
          get: () => ({
            brands: [
              { brand: 'Chromium', version: '130' },
              { brand: 'Google Chrome', version: '130' },
              { brand: 'Not?A_Brand', version: '99' },
            ],
            mobile: false,
            platform: 'Windows',
            getHighEntropyValues: async () => ({
              platform: 'Windows',
              platformVersion: '15.0.0',
              architecture: 'x86',
              model: '',
              bitness: '64',
            }),
          }),
          configurable: true,
        });
      }
    } catch {}
  });

  (context as any).__resilientTier = 2;
  return context;
}

export async function createTier3Context(
  browser: Browser,
  storageStatePath?: string,
  options?: ResilientContextOptions
): Promise<BrowserContext> {
  const context = await browser.newContext({
    storageState: storageStatePath && fs.existsSync(storageStatePath) ? storageStatePath : undefined,
    locale: options?.locale ?? 'en-IN',
    timezoneId: options?.timezoneId ?? 'Asia/Calcutta',
    viewport: null,
  });

  (context as any).__resilientTier = 3;
  return context;
}

export async function createResilientBrowserContext(
  browser: Browser,
  storageStatePathOrOptions?: string | ResilientContextOptions,
  forceTierArg?: 1 | 2 | 3
): Promise<BrowserContext> {
  let storageStatePath: string | undefined;
  let forceTier: 1 | 2 | 3 | undefined = forceTierArg;
  let options: ResilientContextOptions | undefined;

  if (typeof storageStatePathOrOptions === 'string') {
    storageStatePath = storageStatePathOrOptions;
  } else if (storageStatePathOrOptions && typeof storageStatePathOrOptions === 'object') {
    options = storageStatePathOrOptions;
    storageStatePath = options.storageStatePath;
    forceTier = options.forceTier ?? forceTier;
  }

  if (forceTier === 1) {
    return createTier1Context(browser, storageStatePath, options);
  }
  if (forceTier === 2) {
    return createTier2Context(browser, storageStatePath, options);
  }
  if (forceTier === 3) {
    return createTier3Context(browser, storageStatePath, options);
  }

  // Automatic fallback cascade: Tier 1 -> Tier 2 -> Tier 3
  try {
    return await createTier1Context(browser, storageStatePath, options);
  } catch {
    try {
      return await createTier2Context(browser, storageStatePath, options);
    } catch {
      return await createTier3Context(browser, storageStatePath, options);
    }
  }
}
