import fs from 'node:fs';
import path from 'node:path';
import { runMode2WonderPillInvertedLeadFinder, type DiscoveredOutreachContact } from '../src/outreach/dual-mode-lead-finder.js';
import { composeTechnicalOpenerHook } from '../src/outreach/personalized-hook-composer.js';
import { INVENTED_ROLE_GUESS_REGEX, isVerbatimObservedSource } from '../src/outreach/zero-bounce-verifier.js';
import type { OutreachLeadItem } from './backfill-applied-outreach.js';

export async function reEnrichOutreachLeads(
  leadsPath = path.resolve('state/autoapply/portal-review/outreach-leads.json')
): Promise<{
  total: number;
  tierA: number;
  tierB: number;
  tierC: number;
  enrichedCount: number;
}> {
  if (!fs.existsSync(leadsPath)) {
    console.warn(`[RE_ENRICH] Leads file not found at ${leadsPath}`);
    return { total: 0, tierA: 0, tierB: 0, tierC: 0, enrichedCount: 0 };
  }

  const raw = fs.readFileSync(leadsPath, 'utf8');
  const leads: OutreachLeadItem[] = JSON.parse(raw);

  const discoveryCache = new Map<string, DiscoveredOutreachContact[]>();
  let enrichedCount = 0;

  console.log(`[RE_ENRICH] Starting Mode 2 scrub & re-enrichment across ${leads.length} leads...`);

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;
    const currentEmail = (lead.targetEmail || (lead as any).email || '').trim().toLowerCase();
    const isRoleGuess = INVENTED_ROLE_GUESS_REGEX.test(currentEmail) ||
      lead.source === 'fallback' ||
      lead.source === 'role_fallback' ||
      lead.source === 'poison_scrubbed_fallback';

    const isAlreadyVerbatim = isVerbatimObservedSource(lead.discoveryStep || lead.source);

    if (!isRoleGuess || isAlreadyVerbatim) {
      lead.tier = 'TIER_A_VERBATIM_OBSERVED';
      lead.sendEligible = true;
      continue;
    }

    // Role guess encountered: Run Mode 2 Wonder-Pill Inverted Discovery
    const domain = (currentEmail.includes('@') ? currentEmail.split('@')[1] : lead.company || '').toLowerCase().trim();
    const cacheKey = `${lead.company.toLowerCase().trim()}|${domain}`;

    let contacts: DiscoveredOutreachContact[];
    if (discoveryCache.has(cacheKey)) {
      contacts = discoveryCache.get(cacheKey)!;
    } else {
      console.log(`[RE_ENRICH] Mode 2 lateral scan for "${lead.company}" (${domain})...`);
      contacts = await runMode2WonderPillInvertedLeadFinder({
        company: lead.company,
        domain,
      }).catch(() => []);
      discoveryCache.set(cacheKey, contacts);
    }

    if (contacts.length > 0) {
      const best = contacts[0]!;
      console.log(`[RE_ENRICH] Replaced guessed ${currentEmail} with real observed: ${best.email} (${best.name})`);
      lead.targetEmail = best.email;
      lead.email = best.email;
      lead.personName = best.name;
      lead.personRole = best.role;
      lead.source = best.source;
      lead.discoveryStep = best.source === 'mode2_npm_maintainer'
        ? 'inversion1_npm_maintainer_registry'
        : 'inversion2_git_patch_header';
      lead.tier = 'TIER_A_VERBATIM_OBSERVED';
      lead.sendEligible = true;
      enrichedCount++;

      // Re-compose technical opener hook with real engineer name/role
      const hook = composeTechnicalOpenerHook({
        company: lead.company,
        roleTitle: lead.roleTitle,
        personName: lead.personName,
        personRole: lead.personRole,
        discoveryStep: lead.discoveryStep,
      });

      if (lead.body) {
        const paragraphs = lead.body.split('\n\n');
        if (paragraphs.length >= 2 && /^Hi\s+/i.test(paragraphs[0] || '')) {
          lead.body = [hook, ...paragraphs.slice(2)].join('\n\n');
        } else {
          lead.body = `${hook}\n\n${lead.body}`;
        }
      }
    } else {
      // No Mode 2 contact found: Quarantine unverified role guess
      lead.tier = 'TIER_C_UNVERIFIED_GUESS';
      lead.sendEligible = false;
    }
  }

  // Save back updated leads
  fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2), 'utf8');

  let tierA = 0;
  let tierB = 0;
  let tierC = 0;
  for (const l of leads) {
    if (l.tier === 'TIER_A_VERBATIM_OBSERVED') tierA++;
    else if (l.tier === 'TIER_B_MAILBOX_VERIFIED') tierB++;
    else tierC++;
  }

  console.log(`[RE_ENRICH] Completed! Total leads: ${leads.length}`);
  console.log(`  - TIER_A_VERBATIM_OBSERVED: ${tierA}`);
  console.log(`  - TIER_B_MAILBOX_VERIFIED: ${tierB}`);
  console.log(`  - TIER_C_UNVERIFIED_GUESS (quarantined): ${tierC}`);
  console.log(`  - Newly enriched from Mode 2: ${enrichedCount}`);

  return { total: leads.length, tierA, tierB, tierC, enrichedCount };
}

// Direct execution CLI entrypoint
if (process.argv[1]?.endsWith('re-enrich-outreach-leads.ts') || process.argv[1]?.endsWith('re-enrich-outreach-leads.js')) {
  reEnrichOutreachLeads()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[RE_ENRICH] Failed:', err);
      process.exit(1);
    });
}
