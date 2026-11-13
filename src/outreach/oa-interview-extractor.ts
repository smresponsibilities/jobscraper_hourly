export type InboxSignalCategory = 'OA_ASSESSMENT' | 'INTERVIEW_INVITE' | 'RECRUITER_HUMAN_REPLY' | 'REJECTION' | 'APPLICATION_ACK' | 'OTHER';

const assessmentHosts: Record<string, string> = {
  'hackerrank.com': 'HackerRank', 'codesignal.com': 'CodeSignal', 'codility.com': 'Codility',
  'testgorilla.com': 'TestGorilla', 'mettl.com': 'Mettl', 'karat.com': 'Karat',
  'qualified.io': 'Qualified', 'glider.ai': 'Glider', 'imocha.io': 'iMocha',
};
const schedulingHosts: Record<string, string> = {
  'calendly.com': 'Calendly', 'goodtime.io': 'GoodTime', 'modernloop.io': 'ModernLoop', 'cronofy.com': 'Cronofy',
};

function domainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function platformForUrl(url: URL): { category: 'OA_ASSESSMENT' | 'INTERVIEW_INVITE'; platform: string } | null {
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  for (const [domain, platform] of Object.entries(assessmentHosts)) if (domainMatches(host, domain)) return { category: 'OA_ASSESSMENT', platform };
  for (const [domain, platform] of Object.entries(schedulingHosts)) if (domainMatches(host, domain)) return { category: 'INTERVIEW_INVITE', platform };
  if (domainMatches(host, 'ashbyhq.com') && /\/scheduled-interview(?:\/|$)/i.test(url.pathname)) return { category: 'INTERVIEW_INVITE', platform: 'Ashby' };
  if (domainMatches(host, 'greenhouse.io') && /\/schedule(?:\/|$)/i.test(url.pathname)) return { category: 'INTERVIEW_INVITE', platform: 'Greenhouse' };
  if (host === 'teams.microsoft.com' && /^\/l\/meetup-join(?:\/|$)/i.test(url.pathname)) return { category: 'INTERVIEW_INVITE', platform: 'Microsoft Teams' };
  if (domainMatches(host, 'zoom.us') && /^\/j\//i.test(url.pathname)) return { category: 'INTERVIEW_INVITE', platform: 'Zoom' };
  if (host === 'meet.google.com' && url.pathname.length > 1) return { category: 'INTERVIEW_INVITE', platform: 'Google Meet' };
  return null;
}

export function extractOaAndInterviewSignalsFromEmail(email: { subject: string; from: string; bodyText: string; bodyHtml?: string; receivedAt?: string }): {
  category: InboxSignalCategory; actionUrls: string[]; platform: string | null; deadlineHint: string | null; urgency: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
} {
  const body = `${email.subject || ''}\n${email.bodyText || ''}\n${email.bodyHtml || ''}`.replace(/&amp;/gi, '&');
  const matches: Array<{ url: string; category: 'OA_ASSESSMENT' | 'INTERVIEW_INVITE'; platform: string }> = [];
  for (const match of body.matchAll(/https:\/\/[^\s<>"']+/gi)) {
    try {
      const url = new URL(match[0].replace(/[),.;]+$/, ''));
      const platform = platformForUrl(url);
      if (platform && !matches.some(item => item.url === url.href)) matches.push({ url: url.href, ...platform });
    } catch { /* Ignore malformed links. */ }
  }
  const sender = /@([a-z0-9.-]+)/i.exec(email.from || '')?.[1]?.toLowerCase() || '';
  const senderPlatform = Object.entries(assessmentHosts).find(([domain]) => domainMatches(sender, domain));
  const action = matches[0] || (senderPlatform ? { category: 'OA_ASSESSMENT' as const, platform: senderPlatform[1] } : null);
  const plain = `${email.subject || ''} ${email.bodyText || ''}`;
  const deadlineHint = /\b(?:within|by|before|expires?\s+in)\s+(?:\d+\s*(?:hours?|days?)|[A-Z][a-z]{2,8}\s+\d{1,2}(?:,\s*\d{4})?)/i.exec(plain)?.[0] || null;
  let category: InboxSignalCategory = action?.category || 'OTHER';
  if (!action) {
    if (/\b(?:unfortunately|not moving forward|not selected|will not be proceeding|pursue other candidates)\b/i.test(plain)) category = 'REJECTION';
    else if (/\b(?:thank you for applying|application received|received your application|application confirmation)\b/i.test(plain)) category = 'APPLICATION_ACK';
    else if (/\b(?:interview invitation|invitation to interview|schedule an interview|interview availability)\b/i.test(plain)) category = 'INTERVIEW_INVITE';
    else if (/^\s*re:/i.test(email.subject || '') && !/no-?reply|notifications?/i.test(email.from || '')) category = 'RECRUITER_HUMAN_REPLY';
  }
  return { category, actionUrls: matches.map(match => match.url), platform: action?.platform || null, deadlineHint, urgency: category === 'OA_ASSESSMENT' || category === 'INTERVIEW_INVITE' ? 'CRITICAL' : category === 'RECRUITER_HUMAN_REPLY' ? 'HIGH' : category === 'OTHER' ? 'LOW' : 'NORMAL' };
}

export function composeInterviewSchedulingReplyDraft(params: { recruiterName?: string; companyName: string; jobTitle: string; extractedSchedulingUrl?: string }): { subject: string; bodyText: string; readyForHumanClick: boolean } {
  const name = params.recruiterName?.trim() || 'Hiring Team';
  const company = params.companyName.trim() || 'your team';
  const role = params.jobTitle.trim() || 'the role';
  const email = process.env.AUTOAPPLY_EMAIL || process.env.IMAP_USER || '[email]';
  const phone = process.env.AUTOAPPLY_PHONE || process.env.PHONE || '[phone]';
  const scheduling = params.extractedSchedulingUrl ? '\nI will use the scheduling link to select a suitable time.\n' : '';
  return {
    subject: `Re: Interview for ${role}`,
    bodyText: `Hello ${name},\n\nThank you for considering me for ${role} at ${company}. I am available to arrange an interview and can coordinate across IST, UTC, US Eastern and European time zones.${scheduling}\nPlease let me know what works for your team.\n\nBest,\nShivam Mahajan\n${email}\n${phone}\nhttps://shivammahajan.com`,
    readyForHumanClick: true,
  };
}
