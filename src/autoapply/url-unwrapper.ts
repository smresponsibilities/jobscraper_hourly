// src/autoapply/url-unwrapper.ts
import * as dns from 'node:dns/promises';

export function unwrapDirectAtsApplicationUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);

    // 1. Unwrap ANY corporate wrapper URL containing ?gh_jid=<TOKEN> directly to Greenhouse's fast embed form!
    const ghJid = u.searchParams.get('gh_jid');
    if (ghJid && /^\d+$/.test(ghJid.trim()) && !u.hostname.includes('greenhouse.io')) {
      return `https://boards.greenhouse.io/embed/job_app?token=${ghJid.trim()}`;
    }

    // 2. Ensure Ashby job URLs jump straight to the /application tab instead of hanging on the JD overview tab!
    if (u.hostname === 'jobs.ashbyhq.com') {
      const cleanPath = u.pathname.replace(/\/+$/, '');
      const parts = cleanPath.split('/').filter(Boolean);
      // Matches /{tenant}/{jobUuid} where jobUuid is a UUID (>= 20 chars with hyphens)
      if (parts.length === 2 && /^[0-9a-f-]{20,}$/i.test(parts[1]!)) {
        u.pathname = `/${parts[0]}/${parts[1]}/application`;
        return u.toString();
      }
    }

    return rawUrl;
  } catch {
    return rawUrl;
  }
}

export function isOfflineDinoPage(headingOrText: string): boolean {
  if (!headingOrText) return false;
  return /this site can['’]?t be reached|press space to play|err_internet_disconnected|err_name_not_resolved|no internet/i.test(headingOrText);
}

export async function waitForInternetRecoveryIfOffline(maxWaitMs = 300_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      await dns.lookup('boards.greenhouse.io');
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  return false;
}
