let tail: Promise<void> = Promise.resolve();

/** Serialize complete IMAP connection lifetimes, including cleanup. */
export async function withSingleFlightImapLock<T>(_taskId: string, fn: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try { return await fn(); } finally { release(); }
}

const COMMON_WORDS = /^(?:security|question|password|continue|complete|verifing|greenhouse|position|software|engineer|location|linkedin|required|optional|personal|graduate|platform|database|document|response|received|applying)$/i;

export function extractGreenhouse8CharOtpFromEmail(subjectAndBodyHtml: string, alreadyConsumedCodes: Set<string>): string | null {
  const text = subjectAndBodyHtml.replace(/&nbsp;|&#160;/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const candidates = [
    ...text.matchAll(/<(?:h[1-6]|strong|b|code|td|p|div|span)\b[^>]*>\s*([A-Za-z0-9]{8})\s*<\//gi),
    ...text.replace(/<[^>]*>/g, ' ').matchAll(/(?:code(?:\s+is)?|otp|security code|verification code)\s*[:=\-]\s*([A-Za-z0-9]{8})\b/gi),
  ];
  for (const match of candidates) {
    const candidate = match[1]!;
    if (!COMMON_WORDS.test(candidate) && !alreadyConsumedCodes.has(candidate)) return candidate;
  }
  return null;
}

/** Extract only a Workday-hosted activation URL; caller must still verify tenant. */
export function extractWorkdayActivationLinkFromEmail(bodyHtmlOrText: string): string | null {
  const raw = bodyHtmlOrText.replace(/&amp;/gi, '&');
  const visit = (value: string, depth: number): string | null => {
    if (depth > 2) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return null;
      if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(url.hostname) && /(?:^|\/)activate(?:\/|$)/i.test(url.pathname)) return url.href;
      for (const nested of url.searchParams.values()) {
        if (/^https:\/\//i.test(nested)) {
          const found = visit(nested, depth + 1);
          if (found) return found;
        }
      }
    } catch { /* Ignore malformed URLs. */ }
    return null;
  };
  for (const match of raw.matchAll(/https:\/\/[^\s<>"']+/gi)) {
    const found = visit(match[0].replace(/[),.;]+$/, ''), 0);
    if (found) return found;
  }
  return null;
}
