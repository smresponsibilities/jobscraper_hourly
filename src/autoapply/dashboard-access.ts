import { timingSafeEqual } from 'node:crypto';

/** Restrict the dashboard to loopback and reject browser requests from other sites. */
export function isTrustedDashboardRequest(input: { remoteAddress?: string; host?: string; origin?: string; authorization?: string; method?: string; path?: string }, token = process.env.AUTOAPPLY_DASHBOARD_TOKEN): boolean {
  const remote = input.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false;
  let host: URL;
  try { host = new URL(`http://${input.host || ''}`); } catch { return false; }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host.hostname) || host.username || host.password || host.pathname !== '/' || host.search || host.hash) return false;
  const origin = input.origin;
  if (origin) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch { return false; }
    const dashboardOrigin = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && parsed.port === host.port && !parsed.username && !parsed.password;
    const extensionOrigin = parsed.protocol === 'chrome-extension:' && /^[a-p]{32}$/.test(parsed.hostname) && input.path === '/api/extension-brain';
    if (!dashboardOrigin && !extensionOrigin) return false;
  }
  if (input.path !== '/api/extension-brain' || input.method === 'OPTIONS') return true;
  if (!token || token.length < 32 || !input.authorization?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(input.authorization.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
