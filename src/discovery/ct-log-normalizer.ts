export interface CtAtsTenant { provider: string; tenant: string; boardUrl: string }

/** Normalize certificate names into candidates. A certificate does not prove a board exists. */
export function extractAtsTenantsFromCtDomains(dnsNames: string[]): CtAtsTenant[] {
  const results: CtAtsTenant[] = [];
  const seen = new Set<string>();
  const supported: Array<[string, string]> = [
    ['recruitee.com', 'recruitee'], ['breezy.hr', 'breezy'], ['pinpointhq.com', 'pinpoint'],
    ['ashbyhq.com', 'ashby'], ['greenhouse.io', 'greenhouse'],
  ];
  for (const value of dnsNames || []) {
    if (typeof value !== 'string') continue;
    for (const raw of value.split(/[\r\n,]+/)) {
      const host = raw.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
      if (!host || host.length > 253 || !host.split('.').every(label => /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) continue;
      let provider = '';
      let tenant = '';
      const workday = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/.exec(host);
      if (workday) { provider = 'workday'; tenant = workday[1]!; }
      else {
        for (const [suffix, name] of supported) {
          if (!host.endsWith(`.${suffix}`)) continue;
          const prefix = host.slice(0, -(suffix.length + 1));
          if (!prefix || prefix.includes('.')) break;
          provider = name;
          tenant = prefix;
          break;
        }
      }
      if (!provider || !tenant || /^(?:www|api|app|jobs|boards|job-boards|cdn|static|assets|status|support|staging|test|dev|sandbox)$/i.test(tenant)) continue;
      if (/^(?:stripe|avoca|ssctech|paypal)(?:[-.]|$)/i.test(tenant) || /(?:^|-)(?:dev|development|staging|stage|test|testing|uat|impl|sandbox)(?:-|$)/i.test(tenant)) continue;
      const key = `${provider}:${tenant}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ provider, tenant, boardUrl: `https://${host}` });
    }
  }
  return results;
}
