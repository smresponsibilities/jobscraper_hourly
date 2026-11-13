import { isPoisonPrefixEmail } from './free-contact-discovery.js';
import { isSafeOutreachEmailSyntax } from '../../scripts/sync-applied-to-outreach.js';
import { isStrictlyIsolatedTenant } from '../autoapply/priority-scheduler.js';

export interface ObservedOssLead { name: string; email: string; provenance: 'TIER_A_VERBATIM_OBSERVED'; evidenceUrl: string }

function collect(entries: Array<{ name?: unknown; email?: unknown }>, domain: string, evidenceUrl: string): ObservedOssLead[] {
  const target = domain.trim().toLowerCase().replace(/\.$/, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(target) || isStrictlyIsolatedTenant(target, `https://${target}`)) return [];
  try { const source = new URL(evidenceUrl); if (source.protocol !== 'https:' || source.username || source.password) return []; } catch { return []; }
  const found = new Map<string, ObservedOssLead>();
  for (const entry of entries) {
    if (typeof entry.email !== 'string' || typeof entry.name !== 'string') continue;
    const email = entry.email.trim().toLowerCase();
    const name = entry.name.trim();
    const [local, host] = email.split('@');
    if (!name || !isSafeOutreachEmailSyntax(email) || host !== target || isPoisonPrefixEmail(email) || /(?:^|[._+-])(?:dependabot|renovate|bot|noreply|no-reply|donotreply)(?:[._+\-]|$)/i.test(local || '') || /\b(?:dependabot|renovate|bot)\b/i.test(name)) continue;
    if (!found.has(email)) found.set(email, { name, email, provenance: 'TIER_A_VERBATIM_OBSERVED', evidenceUrl });
  }
  return [...found.values()];
}

export function extractVerbatimEmailsFromGitPatch(patchText: string, targetCompanyDomain: string, patchUrl: string): ObservedOssLead[] {
  if (typeof patchText !== 'string' || typeof targetCompanyDomain !== 'string' || typeof patchUrl !== 'string') return [];
  const entries = [...patchText.matchAll(/^(?:From|Author):[ \t]*([^\r\n<>]+?)[ \t]*<([^\s<>]+)>[ \t]*$/gim)].map(match => ({ name: match[1], email: match[2] }));
  return collect(entries, targetCompanyDomain, patchUrl);
}

export function extractVerbatimEmailsFromNpmPackument(packumentJson: unknown, targetCompanyDomain: string, registryUrl: string): ObservedOssLead[] {
  if (!packumentJson || typeof packumentJson !== 'object' || typeof targetCompanyDomain !== 'string' || typeof registryUrl !== 'string') return [];
  const data = packumentJson as { maintainers?: unknown; author?: unknown };
  const entries: Array<{ name?: unknown; email?: unknown }> = [];
  if (Array.isArray(data.maintainers)) for (const item of data.maintainers) if (item && typeof item === 'object') entries.push(item);
  if (data.author && typeof data.author === 'object') entries.push(data.author);
  return collect(entries, targetCompanyDomain, registryUrl);
}
