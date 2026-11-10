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
    if (u.hostname === 'jobs.ashbyhq.com' || u.hostname.endsWith('.ashbyhq.com')) {
      const cleanPath = u.pathname.replace(/\/+$/, '');
      const parts = cleanPath.split('/').filter(Boolean);
      // Matches /{tenant}/{jobUuid} where jobUuid is not already /application
      if (parts.length >= 2 && parts[parts.length - 1] !== 'application' && parts[parts.length - 1] !== 'embed') {
        u.pathname = `/${parts.slice(0, 2).join('/')}/application`;
        return u.toString();
      }
    }

    // 3. Ticket GEN-104: Ensure Lever job URLs jump straight to the /apply tab instead of hanging on the JD overview!
    if (u.hostname === 'jobs.lever.co' || u.hostname.endsWith('.lever.co')) {
      const cleanPath = u.pathname.replace(/\/+$/, '');
      const parts = cleanPath.split('/').filter(Boolean);
      // Matches /{tenant}/{jobUuid} without /apply
      if (parts.length >= 2 && parts[parts.length - 1] !== 'apply') {
        u.pathname = `/${parts.slice(0, 2).join('/')}/apply`;
        return u.toString();
      }
    }

    // 4. Ticket GEN-111: SmartRecruiters overview URL purity (never rewrite to /oneclick-ui/)
    if (u.hostname === 'jobs.smartrecruiters.com') {
      // Strip trailing /apply so it points to the overview page
      if (u.pathname.endsWith('/apply') || u.pathname.endsWith('/apply/')) {
        u.pathname = u.pathname.replace(/\/apply\/?$/i, '');
        return u.toString();
      }
      // If broken numeric /oneclick-ui/company/{company}/publication/{numericId}, rewrite back to /{company}/{numericId}
      const numMatch = u.pathname.match(/\/oneclick-ui\/company\/([^/]+)\/publication\/(\d{8,})/i);
      if (numMatch?.[1] && numMatch?.[2]) {
        u.pathname = `/${numMatch[1]}/${numMatch[2]}`;
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
