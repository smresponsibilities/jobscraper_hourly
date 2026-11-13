export interface PublicPostingPreflight {
  provider: 'smartrecruiters' | 'recruitee' | 'breezy' | 'workable';
  isClosed: boolean;
  jdText: string;
  questions: unknown[];
  raw: unknown;
}

/** Fetch public posting metadata only from the recognised provider host. */
export async function prefetchPublicPosting(jobUrl: string): Promise<PublicPostingPreflight | null> {
  try {
    const url = new URL(jobUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    let provider: PublicPostingPreflight['provider'];
    let endpoint: string;
    if ((host === 'jobs.smartrecruiters.com' || host === 'careers.smartrecruiters.com') && parts.length >= 2 && parts.slice(0, 2).every(p => /^[\w-]+$/.test(p))) {
      provider = 'smartrecruiters';
      const postingId = /^\d+(?=-|$)/.exec(parts[1]!)?.[0] || parts[1];
      endpoint = `https://api.smartrecruiters.com/v1/companies/${parts[0]}/postings/${postingId}`;
    } else if (/^[a-z0-9-]+\.recruitee\.com$/.test(host) && parts[0] === 'o' && /^[\w-]+$/.test(parts[1] || '')) {
      provider = 'recruitee';
      endpoint = `https://${host}/api/offers/${parts[1]}`;
    } else if (/^[a-z0-9-]+\.breezy\.hr$/.test(host) && parts[0] === 'p' && /^[\w-]+$/.test(parts[1] || '')) {
      provider = 'breezy';
      endpoint = `https://${host}/p/${parts[1]}/json`;
    } else if (host === 'apply.workable.com' && parts[1] === 'j' && [parts[0], parts[2]].every(p => /^[\w-]+$/.test(p || ''))) {
      provider = 'workable';
      endpoint = `https://apply.workable.com/api/v2/accounts/${parts[0]}/jobs/${parts[2]}`;
    } else return null;

    // These tenants have unresolved application state and must not be contacted.
    if (/^(?:stripe|avoca|ssctech|paypal)(?:[._-]|$)/i.test(host) || /^(?:stripe|avoca|ssctech|paypal)(?:[._-]|$)/i.test(parts[0] || '')) return null;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(3500), redirect: 'error' });
    if (provider === 'smartrecruiters' && response.status === 404) return { provider, isClosed: true, jdText: '', questions: [], raw: null };
    if (!response.ok) return null;
    const data: any = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const offer = data.offer || {};
    const sections = data.jobAd?.sections || {};
    const text = provider === 'smartrecruiters' ? [sections.jobDescription?.text, sections.qualifications?.text]
      : provider === 'recruitee' ? [offer.description]
      : provider === 'workable' ? [data.description, data.requirements] : [data.description];
    const questions = provider === 'recruitee' ? offer.questions : provider === 'breezy' ? data.questionnaire : [];
    return {
      provider,
      isClosed: provider === 'workable' && typeof data.state === 'string' && !!data.state.trim() && !/^published$/i.test(data.state.trim()),
      jdText: text.filter((s): s is string => typeof s === 'string').join('\n'),
      questions: Array.isArray(questions) ? questions : [],
      raw: data,
    };
  } catch {
    return null;
  }
}
