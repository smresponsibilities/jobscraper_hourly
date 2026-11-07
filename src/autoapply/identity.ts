export interface RequisitionIdentity {
  provider: string;
  tenant: string;
  jobId: string;
  key: string;
}

/** Provider-aware token extraction retains employer boundaries in sameRequisition. */
export function extractRequisitionToken(url: string): string | null {
  try { return canonicalRequisition(url)?.jobId || null; } catch { return null; }
}

function identity(provider: string, tenant: string, jobId: string): RequisitionIdentity {
  tenant = tenant.toLowerCase().replace(/\/$/, '');
  return { provider, tenant, jobId, key: `${provider}:${tenant}:${jobId}` };
}

/** Workday may append a numeric posting variant to the catalogue requisition. */
export function sameRequisition(expected: RequisitionIdentity, actual: RequisitionIdentity): boolean {
  if (expected.provider === 'greenhouse' && actual.provider === 'greenhouse') {
    if (expected.jobId === actual.jobId) return true;
    if (expected.tenant === 'embed' || actual.tenant === 'embed') return true;
  }
  if (expected.provider !== actual.provider || expected.tenant !== actual.tenant && !(expected.provider === 'workable' && actual.tenant === 'public')) return false;
  if (expected.jobId === actual.jobId) return true;
  const left = expected.jobId.toLowerCase(), right = actual.jobId.toLowerCase();
  return expected.provider === 'workday' && (left === right || right.startsWith(`${left}-`) && /^\d+$/.test(right.slice(left.length + 1)));
}

/** Shared public ATS routes cannot establish a company account boundary. */
export function canonicalEmployerKey(url: string, catalogueId?: string): string {
  const requisition = canonicalRequisition(url, catalogueId);
  if (!requisition) return new URL(url).origin.toLowerCase();
  return requisition.tenant === 'public' ? `${requisition.provider}:unknown:${requisition.jobId}` : `${requisition.provider}:${requisition.tenant}`;
}

/** Prefer the scraper's existing ATS/tenant/external-ID key over presentation URLs. */
export function canonicalRequisition(url: string, catalogueId?: string): RequisitionIdentity | undefined {
  if (catalogueId) {
    const match = /^([a-z]+):(.+):([^:]+)$/i.exec(catalogueId);
    if (match) {
      const catalogued = identity(match[1]!.toLowerCase(), match[2]!, match[3]!);
      if (catalogued.provider === 'phenom') {
        const direct = canonicalRequisition(url);
        if (direct?.provider === 'workday' && sameRequisition(identity('workday', direct.tenant, catalogued.jobId), direct)) return identity('workday', direct.tenant, catalogued.jobId);
      }
      return catalogued;
    }
  }
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (/^(?:boards|job-boards|boards\.eu|job-boards\.eu)\.greenhouse\.io$/.test(host)) {
    const id = /\/jobs\/(\d+)/.exec(parsed.pathname)?.[1] || parsed.searchParams.get('gh_jid') || parsed.searchParams.get('token');
    const tenant = parts[0] === 'embed' ? (parsed.searchParams.get('for') || 'embed') : parts[0];
    if (tenant && id) return identity('greenhouse', tenant, id);
  }
  if (host === 'jobs.lever.co' && parts[0] && parts[1]) return identity('lever', parts[0], parts[1]);
  if (host === 'jobs.ashbyhq.com' && parts[0] && parts[1]) return identity('ashby', parts[0], parts[1]);
  if (host.endsWith('.myworkdayjobs.com')) {
    const slug = /\/job\/(?:[^/]+\/)*?([^/]+)(?:\/apply(?:\/.*)?)?\/?$/.exec(parsed.pathname)?.[1];
    const id = /_(R_\d+(?:-\d+)?)$/i.exec(slug || '')?.[1] || slug?.slice(slug.lastIndexOf('_') + 1);
    if (id && slug?.includes('_')) return identity('workday', host.split('.')[0]!, id);
  }
  if (host === 'apply.workable.com') {
    const id = /\/j\/([a-z0-9]+)/i.exec(parsed.pathname)?.[1];
    if (id) return identity('workable', parts[0] === 'j' ? 'public' : parts[0] || 'public', id.toUpperCase());
  }
  if (host.endsWith('.recruitee.com') && parts[0] === 'o' && parts[1]) return identity('recruitee', host.split('.')[0]!, parts[1]);
  if (host.endsWith('.oraclecloud.com')) {
    const id = /\/job\/([^/]+)/.exec(parsed.pathname)?.[1];
    if (id) return identity('oracle', host.split('.')[0]!, id);
  }
  if (host === 'jobs.smartrecruiters.com') {
    const offset = parts.length >= 3 && /^[a-z]{2}(?:[-_][a-z]{2})?$/i.test(parts[0]!) && /^\d+(?:-|$)/.test(parts[2]!) ? 1 : 0;
    const tenant = parts[offset], posting = parts[offset + 1];
    if (tenant && posting && /^\d+(?:-|$)/.test(posting)) return identity('smartrecruiters', tenant, posting.split('-')[0]!);
  }
  if (host.endsWith('.icims.com')) {
    const id = /\/jobs\/(\d+)/.exec(parsed.pathname)?.[1];
    if (id) return identity('icims', host, id);
  }
  if (host.includes('taleo.net')) {
    const id = parsed.searchParams.get('rid') || parsed.searchParams.get('job');
    if (id) return identity('taleo', parsed.searchParams.get('org') || host, id);
  }
  if (host.includes('successfactors.')) {
    const id = parsed.searchParams.get('career_job_req_id');
    if (id) return identity('successfactors', parsed.searchParams.get('company') || host, id);
  }
  return undefined;
}
