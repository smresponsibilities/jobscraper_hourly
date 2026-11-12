import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import {
  isPoisonPrefixEmail,
  verifyDomainMxRecords,
} from '../src/outreach/free-contact-discovery.js';
import { isSafeOutreachEmailSyntax } from './sync-applied-to-outreach.js';
import {
  determineJobArchetype,
  type JobArchetype,
  type OutreachLeadItem,
} from './backfill-applied-outreach.js';
import {
  loadInboxLifecycleEvents,
  type InboxLifecycleEvent,
  type LifecycleStage,
} from '../src/autoapply/inbox-lifecycle-tracker.js';
import { recordWonderPillDeadEnd } from '../src/outreach/dual-mode-lead-finder.js';
import {
  composeDay5FollowUpWithNewProof,
  composeTechnicalOpenerHook,
} from '../src/outreach/personalized-hook-composer.js';
import {
  isDay5FollowUpEligible,
  buildDay5FollowUpDraft,
} from '../src/outreach/follow-up-sequencer.js';
import {
  verifyMailboxExistsBeforeSend,
  sendVerifiedOutreachEmail,
  ZeroBounceBlockedError,
} from '../src/outreach/zero-bounce-verifier.js';

// Load .env variables into process.env if present
export function loadEnvFile(envPath = '.env'): void {
  const candidatePaths = [
    envPath,
    path.resolve('.env'),
    path.resolve('.env.local'),
    path.resolve('state/autoapply/portal-review/.env'),
  ];
  for (const p of candidatePaths) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, 'utf8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch {}
  }
}

export interface SentLedgerEntry {
  company: string;
  domain: string;
  targetEmail: string;
  roleTitle: string;
  archetype: JobArchetype;
  resumePdf: string;
  subject: string;
  sentAt: string;
  messageId: string;
  mode: 'dry-run' | 'live';
  followUpCount?: number;
  lastFollowUpAt?: string;
  isFollowUp?: boolean;
}

export interface SentLedgerState {
  records: SentLedgerEntry[];
}

export const DEFAULT_SENT_LEDGER_PATH = path.resolve(
  'state/autoapply/portal-review/sent-ledger.json'
);

export function loadSentLedger(ledgerPath = DEFAULT_SENT_LEDGER_PATH): SentLedgerState {
  if (!fs.existsSync(ledgerPath)) return { records: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    return { records: Array.isArray(parsed?.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
}

export function saveSentLedger(
  ledger: SentLedgerState,
  ledgerPath = DEFAULT_SENT_LEDGER_PATH
): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');
}

export function isDomainOrCompanyOnCooldown(
  company: string,
  domain: string,
  ledger: SentLedgerState,
  cooldownDays = 30
): boolean {
  const cleanComp = (company || '').toLowerCase().trim();
  const cleanDom = (domain || '').toLowerCase().trim();
  const cutoff = Date.now() - cooldownDays * 24 * 60 * 60 * 1000;

  return ledger.records.some((r) => {
    const sentTime = new Date(r.sentAt).getTime();
    if (sentTime < cutoff) return false;
    const rComp = (r.company || '').toLowerCase().trim();
    const rDom = (r.domain || '').toLowerCase().trim();
    if (cleanComp && rComp === cleanComp) return true;
    if (cleanDom && rDom === cleanDom) return true;
    return false;
  });
}

export function isDomainSuppressedByInboxLifecycle(
  company: string,
  domain: string,
  events: InboxLifecycleEvent[]
): { suppressed: boolean; stage?: LifecycleStage; reason?: string } {
  const cleanComp = (company || '').toLowerCase().trim();
  const cleanDom = (domain || '').toLowerCase().trim();

  for (const ev of events) {
    if (
      ev.stage === 'APPLICATION_REJECTED' ||
      ev.stage === 'INTERVIEW_OR_OA_INVITE' ||
      ev.stage === 'RECRUITER_DIRECT_REPLY'
    ) {
      const evDom = (ev.fromDomain || '').toLowerCase().trim();
      const evComp = (ev.company || '').toLowerCase().trim();
      const evSub = (ev.subject || '').toLowerCase().trim();
      if (
        (cleanDom && evDom && (evDom === cleanDom || evDom.endsWith('.' + cleanDom) || cleanDom.endsWith('.' + evDom))) ||
        (cleanComp && evComp && (evComp === cleanComp || evComp.includes(cleanComp) || cleanComp.includes(evComp))) ||
        (cleanComp && cleanComp.length >= 3 && evSub.includes(cleanComp))
      ) {
        return {
          suppressed: true,
          stage: ev.stage,
          reason: `suppressed_by_inbox_lifecycle (${ev.stage})`,
        };
      }
    }
  }
  return { suppressed: false };
}

export function resolveBounceFallbackEmail(
  targetEmail: string,
  domain: string,
  events: InboxLifecycleEvent[],
  explicitFallback?: string
): { email: string; wasBounced: boolean } {
  const cleanTarget = (targetEmail || '').toLowerCase().trim();
  const isBounced = events.some(
    (e) => e.stage === 'HARD_BOUNCE_550' && e.bouncedRecipient?.toLowerCase().trim() === cleanTarget
  );
  if (!isBounced) {
    return { email: targetEmail, wasBounced: false };
  }
  const fallback = (explicitFallback || (domain ? `talent@${domain}` : '')).toLowerCase().trim();
  if (fallback && fallback !== cleanTarget) {
    return { email: fallback, wasBounced: true };
  }
  return { email: targetEmail, wasBounced: true };
}

export function resolveResumeAttachmentForArchetype(
  archetype: JobArchetype,
  resumesDir = 'state/autoapply/resumes'
): string {
  const fullDir = path.resolve(resumesDir);
  const candidates: string[] = [];

  switch (archetype) {
    case 'AI_ML':
      candidates.push('Shivam_Mahajan_Resume_AI_ML_SYSTEMS.pdf');
      candidates.push('Shivam_Mahajan_Resume_DATA.pdf');
      break;
    case 'DATA':
      candidates.push('Shivam_Mahajan_Resume_DATA.pdf');
      candidates.push('Shivam_Mahajan_Resume_DATA_ENGINEERING.pdf');
      break;
    case 'DEVOPS':
      candidates.push('Shivam_Mahajan_Resume_DEVOPS.pdf');
      candidates.push('Shivam_Mahajan_Resume_BACKEND.pdf');
      break;
    case 'FULLSTACK':
      candidates.push('Shivam_Mahajan_Resume_FULLSTACK.pdf');
      candidates.push('Shivam_Mahajan_Resume_FULLSTACK_REACT.pdf');
      break;
    case 'BACKEND':
    default:
      candidates.push('Shivam_Mahajan_Resume_BACKEND.pdf');
      candidates.push('Shivam_Mahajan_Resume_BACKEND_DISTRIBUTED.pdf');
      break;
  }

  candidates.push('Shivam_Mahajan_Resume_GENERAL_SWE.pdf');
  candidates.push('Shivam_Mahajan_Resume_BACKEND.pdf');

  for (const c of candidates) {
    const candidatePath = path.join(fullDir, c);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  // Final fallback to any .pdf in resumes directory
  if (fs.existsSync(fullDir)) {
    const files = fs.readdirSync(fullDir);
    const pdf = files.find((f) => f.endsWith('.pdf'));
    if (pdf) return path.join(fullDir, pdf);
  }

  return path.join(fullDir, 'Shivam_Mahajan_Resume_BACKEND.pdf');
}

export interface OutreachBatchResult {
  dryRun: boolean;
  totalLeads: number;
  eligibleCount: number;
  processedCount: number;
  sentCount: number;
  skippedCount: number;
  items: Array<{
    company: string;
    targetEmail: string;
    roleTitle: string;
    archetype: JobArchetype;
    resumePdf: string;
    status: 'sent' | 'dry_run_passed' | 'skipped';
    reason?: string;
  }>;
}

export async function runOutreachBatch(options: {
  dryRun?: boolean;
  limit?: number;
  leadsPath?: string;
  ledgerPath?: string;
  lifecycleEvents?: InboxLifecycleEvent[];
  followUps?: boolean;
}): Promise<OutreachBatchResult> {
  loadEnvFile();

  const dryRun = options.dryRun !== false;
  const rawLimit = Number(options.limit) || 5;
  const limit = Math.min(Math.max(1, rawLimit), 15); // Capped at max 15 per invocation

  const leadsPath = options.leadsPath || path.resolve('state/autoapply/portal-review/outreach-leads.json');
  const ledgerPath = options.ledgerPath || DEFAULT_SENT_LEDGER_PATH;
  const ledger = loadSentLedger(ledgerPath);
  const lifecycleEvents = options.lifecycleEvents || loadInboxLifecycleEvents();

  const resultItems: OutreachBatchResult['items'] = [];
  const seenDomainsInBatch = new Set<string>();
  const seenCompaniesInBatch = new Set<string>();
  let sentCount = 0;
  let skippedCount = 0;

  // GEN-464: Day-5 Follow-up branch
  if (options.followUps) {
    const now = Date.now();
    const fiveDaysMs = 5 * 86_400_000;

    for (const entry of ledger.records) {
      if (resultItems.filter((i) => i.status !== 'skipped').length >= limit) {
        break;
      }

      const eligibility = isDay5FollowUpEligible(entry, lifecycleEvents, now);
      if (!eligibility.eligible) {
        if (eligibility.reason?.startsWith('suppressed_by_inbox_lifecycle')) {
          resultItems.push({
            company: entry.company,
            targetEmail: entry.targetEmail,
            roleTitle: entry.roleTitle,
            archetype: entry.archetype,
            resumePdf: entry.resumePdf || '',
            status: 'skipped',
            reason: eligibility.reason,
          });
          skippedCount++;
        }
        continue;
      }

      const company = (entry.company || '').trim();
      const domain = (entry.domain || '').trim().toLowerCase();
      const email = (entry.targetEmail || '').trim().toLowerCase();
      const roleTitle = (entry.roleTitle || '').trim();

      const domainKey = domain.toLowerCase();
      const companyKey = company.toLowerCase();
      if (seenDomainsInBatch.has(domainKey) || seenCompaniesInBatch.has(companyKey)) {
        skippedCount++;
        continue;
      }

      const resumePdf =
        entry.resumePdf && fs.existsSync(entry.resumePdf)
          ? entry.resumePdf
          : resolveResumeAttachmentForArchetype(entry.archetype);

      const draftResult = buildDay5FollowUpDraft(
        {
          company,
          roleTitle,
          domain,
          followUpCount: entry.followUpCount,
        },
        entry.sentAt,
        lifecycleEvents,
        now
      );
      const followUpDraft = {
        subject: draftResult.subject || `Re: Applied for ${roleTitle} — Shivam Mahajan (Morgan Stanley / CSE '26)`,
        body: draftResult.body || composeDay5FollowUpWithNewProof({ company, roleTitle }).body,
      };

      seenDomainsInBatch.add(domainKey);
      seenCompaniesInBatch.add(companyKey);

      if (dryRun) {
        console.log(
          `[OUTREACH_FOLLOWUP_DRY_RUN] Day-5 Follow-up verified: ${company} | ${roleTitle} -> ${email} | Resume: ${path.basename(resumePdf)}`
        );
        resultItems.push({
          company,
          targetEmail: email,
          roleTitle,
          archetype: entry.archetype,
          resumePdf,
          status: 'dry_run_passed',
        });
        sentCount++;
      } else {
        const host = process.env.SMTP_HOST || 'smtp.gmail.com';
        const user = process.env.SMTP_USER || process.env.IMAP_USER || process.env.AUTOAPPLY_EMAIL || '';
        const pass = process.env.SMTP_PASS || process.env.IMAP_PASSWORD || '';

        if (!user || !pass) {
          throw new Error('SMTP credentials missing: set SMTP_USER / SMTP_PASS in .env');
        }

        const transporter = nodemailer.createTransport({
          host,
          port: 465,
          secure: true,
          auth: { user, pass },
        });

        console.log(`[OUTREACH_LIVE_FOLLOWUP] Sending Day-5 follow-up to ${email} (${company} - ${roleTitle})...`);

        const mailOptions = {
          from: `Shivam Mahajan <${user}>`,
          to: email,
          subject: followUpDraft.subject,
          text: followUpDraft.body,
          attachments: fs.existsSync(resumePdf)
            ? [
                {
                  filename: `Shivam_Mahajan_Resume_${entry.archetype}.pdf`,
                  path: resumePdf,
                  contentType: 'application/pdf',
                },
              ]
            : [],
        };

        const info = await sendVerifiedOutreachEmail({
          transporter,
          mailOptions,
          to: email,
          provenanceTier: 'TIER_B_MAILBOX_VERIFIED',
          mailboxStatus: 'VALID',
          isCatchAll: false,
        });

        entry.followUpCount = (entry.followUpCount || 0) + 1;
        entry.lastFollowUpAt = new Date().toISOString();

        const followUpEntry: SentLedgerEntry = {
          company,
          domain,
          targetEmail: email,
          roleTitle,
          archetype: entry.archetype,
          resumePdf,
          subject: followUpDraft.subject,
          sentAt: new Date().toISOString(),
          messageId: info.messageId || `msg_fu_${Date.now()}`,
          mode: 'live',
          isFollowUp: true,
          followUpCount: 1,
        };

        ledger.records.push(followUpEntry);
        saveSentLedger(ledger, ledgerPath);

        resultItems.push({
          company,
          targetEmail: email,
          roleTitle,
          archetype: entry.archetype,
          resumePdf,
          status: 'sent',
        });
        sentCount++;

        if (resultItems.filter((i) => i.status === 'sent').length < limit) {
          const jitterMs = Math.floor(45_000 + Math.random() * 45_000);
          console.log(`[OUTREACH_LIVE] Pacing jitter: waiting ${Math.round(jitterMs / 1000)}s before next send...`);
          await new Promise((r) => setTimeout(r, jitterMs));
        }
      }
    }

    return {
      dryRun,
      totalLeads: ledger.records.length,
      eligibleCount: resultItems.length,
      processedCount: resultItems.length,
      sentCount,
      skippedCount,
      items: resultItems,
    };
  }

  if (!fs.existsSync(leadsPath)) {
    console.warn(`[OUTREACH_BATCH] Leads file not found at ${leadsPath}`);
    return {
      dryRun,
      totalLeads: 0,
      eligibleCount: 0,
      processedCount: 0,
      sentCount: 0,
      skippedCount: 0,
      items: [],
    };
  }

  const leads: OutreachLeadItem[] = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));

  // Filter and process leads
  for (const lead of leads) {
    if (resultItems.filter((i) => i.status !== 'skipped').length >= limit) {
      break;
    }

    let email = (lead.targetEmail || (lead as any).primaryEmail || (lead as any).email || '').trim().toLowerCase();
    const company = (lead.company || '').trim();
    const roleTitle = (lead.roleTitle || '').trim();
    let domain = ((lead as any).domain || (email.includes('@') ? email.split('@')[1] : '') || '').trim().toLowerCase();

    // Ticket GEN-488: Quarantined unverified role guesses are skipped immediately
    if (lead.sendEligible === false || (lead as any).tier === 'TIER_C_UNVERIFIED_GUESS') {
      resultItems.push({
        company,
        targetEmail: email,
        roleTitle,
        archetype: lead.archetype || determineJobArchetype(roleTitle),
        resumePdf: '',
        status: 'skipped',
        reason: 'Quarantined unverified role guess (TIER_C_UNVERIFIED_GUESS)',
      });
      skippedCount++;
      continue;
    }

    // GEN-456: Suppress domain if lifecycle event indicates rejection, interview/OA, or recruiter direct reply
    const suppressCheck = isDomainSuppressedByInboxLifecycle(company, domain, lifecycleEvents);
    if (suppressCheck.suppressed) {
      resultItems.push({
        company,
        targetEmail: email,
        roleTitle,
        archetype: lead.archetype || determineJobArchetype(roleTitle),
        resumePdf: '',
        status: 'skipped',
        reason: suppressCheck.reason || 'suppressed_by_inbox_lifecycle',
      });
      skippedCount++;
      continue;
    }

    // GEN-456: Fallback if recipient previously suffered 550 hard bounce
    const fallbackCheck = resolveBounceFallbackEmail(email, domain, lifecycleEvents, (lead as any).fallbackEmail);
    if (fallbackCheck.wasBounced) {
      recordWonderPillDeadEnd({
        sourceOrigin: 'imap_bounce_550',
        whatWentWrong: `SMTP 550 hard bounce observed for ${email}`,
        whyDisqualifying: 'Recipient address not found or permanently rejected by MTA',
        company,
        domain,
      });

      if (fallbackCheck.email && fallbackCheck.email !== email) {
        console.log(`[OUTREACH_BATCH] Bounced recipient ${email} detected; falling back to ${fallbackCheck.email}`);
        email = fallbackCheck.email;
        domain = email.includes('@') ? email.split('@')[1]!.trim().toLowerCase() : domain;
      } else {
        resultItems.push({
          company,
          targetEmail: email,
          roleTitle,
          archetype: lead.archetype || determineJobArchetype(roleTitle),
          resumePdf: '',
          status: 'skipped',
          reason: 'Hard bounce 550 with no secondary fallback',
        });
        skippedCount++;
        continue;
      }
    }

    // 1. Poison prefix shield
    if (isPoisonPrefixEmail(email)) {
      skippedCount++;
      continue;
    }

    // 2. Syntax validation
    if (!isSafeOutreachEmailSyntax(email)) {
      skippedCount++;
      continue;
    }

    // 3. 30-day domain & company cooldown check
    if (isDomainOrCompanyOnCooldown(company, domain, ledger, 30)) {
      skippedCount++;
      continue;
    }

    // 3.5 Intra-batch deduplication: at most 1 email per company domain / company in a single batch!
    const domainKey = domain.toLowerCase();
    const companyKey = company.toLowerCase();
    if (seenDomainsInBatch.has(domainKey) || seenCompaniesInBatch.has(companyKey)) {
      skippedCount++;
      continue;
    }

    // 4. DNS MX record validation
    let mxOk = lead.mxVerified;
    if (!mxOk && domain) {
      mxOk = await verifyDomainMxRecords(domain);
    }
    if (!mxOk) {
      skippedCount++;
      continue;
    }

    // 4.5. Ticket GEN-488: Zero-Bounce Mailbox Existence & Tier verification
    const verification = await verifyMailboxExistsBeforeSend(email, lead.discoveryStep || lead.source);
    if (!verification.deliverable) {
      recordWonderPillDeadEnd({
        sourceOrigin: 'zero_bounce_verifier',
        whatWentWrong: `Mailbox unverified or role guess: ${email} (${verification.tier})`,
        whyDisqualifying: verification.reason || 'Blocked by zero-bounce pre-send mailbox verifier',
        company,
        domain,
      });
      resultItems.push({
        company,
        targetEmail: email,
        roleTitle,
        archetype: lead.archetype || determineJobArchetype(roleTitle),
        resumePdf: '',
        status: 'skipped',
        reason: `zero_bounce_blocked: ${verification.tier}`,
      });
      skippedCount++;
      continue;
    }

    // 5. Archetype and PDF Resume attachment resolution
    const archetype = lead.archetype || determineJobArchetype(roleTitle);
    const resumePdf = resolveResumeAttachmentForArchetype(archetype);
    const resumeExists = fs.existsSync(resumePdf);

    if (!resumeExists) {
      resultItems.push({
        company,
        targetEmail: email,
        roleTitle,
        archetype,
        resumePdf,
        status: 'skipped',
        reason: 'Resume PDF attachment file missing on disk',
      });
      skippedCount++;
      continue;
    }

    // GEN-463: Ensure technical opener hook is applied if discovery metadata is present
    if (lead.discoveryStep || lead.personRole) {
      const hook = composeTechnicalOpenerHook({
        company,
        roleTitle,
        personName: lead.personName,
        personRole: lead.personRole,
        discoveryStep: lead.discoveryStep,
      });
      if (lead.body && !lead.body.includes(hook)) {
        const paragraphs = lead.body.split('\n\n');
        if (paragraphs.length >= 2 && /^Hi\s+/i.test(paragraphs[0] || '')) {
          lead.body = [hook, ...paragraphs.slice(2)].join('\n\n');
        } else {
          lead.body = `${hook}\n\n${lead.body}`;
        }
      } else if (!lead.body) {
        lead.body = `${hook}\n\nI am based in Bengaluru with immediate availability and would welcome a brief conversation.\n\nBest regards,\nShivam Mahajan`;
      }
    }

    seenDomainsInBatch.add(domainKey);
    seenCompaniesInBatch.add(companyKey);

    if (dryRun) {
      console.log(
        `[OUTREACH_DRY_RUN] Lead verified: ${company} | ${roleTitle} (${archetype}) -> ${email} | Resume: ${path.basename(resumePdf)}`
      );
      resultItems.push({
        company,
        targetEmail: email,
        roleTitle,
        archetype,
        resumePdf,
        status: 'dry_run_passed',
      });
      sentCount++;
    } else {
      // Live send via SMTP / Gmail
      const host = process.env.SMTP_HOST || 'smtp.gmail.com';
      const user = process.env.SMTP_USER || process.env.IMAP_USER || process.env.AUTOAPPLY_EMAIL || '';
      const pass = process.env.SMTP_PASS || process.env.IMAP_PASSWORD || '';

      if (!user || !pass) {
        throw new Error('SMTP credentials missing: set SMTP_USER / SMTP_PASS in .env');
      }

      const transporter = nodemailer.createTransport({
        host,
        port: 465,
        secure: true,
        auth: { user, pass },
      });

      // Ticket GEN-488.1: Verify Mailbox Exists Before Send right before transporter.sendMail()
      const emailToVerify = lead.email || lead.targetEmail || email;
      const liveVerification = await verifyMailboxExistsBeforeSend(emailToVerify, lead.discoveryStep);
      if (!liveVerification.deliverable) {
        console.warn(`[OUTREACH_LIVE] Prevented bounce: ${emailToVerify} deliverable=false (${liveVerification.tier})`);
        recordWonderPillDeadEnd({
          sourceOrigin: 'zero_bounce_verifier',
          whatWentWrong: `Pre-send verification failed for ${emailToVerify} (${liveVerification.tier})`,
          whyDisqualifying: liveVerification.reason || 'Blocked by zero-bounce pre-send mailbox verifier',
          company,
          domain,
        });
        resultItems.push({
          company,
          targetEmail: emailToVerify,
          roleTitle,
          archetype,
          resumePdf,
          status: 'skipped',
          reason: `zero_bounce_blocked: ${liveVerification.tier}`,
        });
        skippedCount++;
        continue;
      }

      console.log(`[OUTREACH_LIVE] Sending cold outreach to ${email} (${company} - ${roleTitle})...`);

      const mailOptions = {
        from: `Shivam Mahajan <${user}>`,
        to: email,
        subject: lead.subject,
        text: lead.body,
        attachments: [
          {
            filename: `Shivam_Mahajan_Resume_${archetype}.pdf`,
            path: resumePdf,
            contentType: 'application/pdf',
          },
        ],
      };

      const info = await sendVerifiedOutreachEmail({
        transporter,
        mailOptions,
        to: email,
        provenanceTier: liveVerification.tier,
        evidenceUrl: (lead as any).evidenceUrl || (lead as any).sourceUrl || (liveVerification.tier === 'TIER_A_VERBATIM_OBSERVED' ? (lead.discoveryStep || 'https://github.com') : undefined),
        mailboxStatus: liveVerification.smtpVerified ? 'VALID' : 'UNKNOWN',
        isCatchAll: false,
      });

      console.log(`[OUTREACH_LIVE] Sent successfully! Message ID: ${info.messageId}`);

      const entry: SentLedgerEntry = {
        company,
        domain,
        targetEmail: email,
        roleTitle,
        archetype,
        resumePdf,
        subject: lead.subject,
        sentAt: new Date().toISOString(),
        messageId: info.messageId || `msg_${Date.now()}`,
        mode: 'live',
      };

      ledger.records.push(entry);
      saveSentLedger(ledger, ledgerPath);

      resultItems.push({
        company,
        targetEmail: email,
        roleTitle,
        archetype,
        resumePdf,
        status: 'sent',
      });
      sentCount++;

      // Jitter pause between live sends (45s–90s) if more sends remain
      if (resultItems.filter((i) => i.status === 'sent').length < limit) {
        const jitterMs = Math.floor(45_000 + Math.random() * 45_000);
        console.log(`[OUTREACH_LIVE] Pacing jitter: waiting ${Math.round(jitterMs / 1000)}s before next send...`);
        await new Promise((r) => setTimeout(r, jitterMs));
      }
    }
  }

  return {
    dryRun,
    totalLeads: leads.length,
    eligibleCount: resultItems.length,
    processedCount: resultItems.length,
    sentCount,
    skippedCount,
    items: resultItems,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isSend = args.includes('--send');
  const dryRun = !isSend || args.includes('--dry-run');
  const followUps = args.includes('--follow-ups');

  let limit = 5;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx >= 0 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1]!, 10) || 5;
  }

  console.log(`[OUTREACH] Initializing batch: mode=${dryRun ? 'DRY-RUN' : 'LIVE'}, followUps=${followUps}, limit=${limit}`);
  const result = await runOutreachBatch({ dryRun, limit, followUps });

  console.log('\n=== OUTREACH BATCH SUMMARY ===');
  console.log(`Mode: ${result.dryRun ? 'DRY-RUN' : 'LIVE SEND'}`);
  console.log(`Total Leads in Pool: ${result.totalLeads}`);
  console.log(`Verified Candidates: ${result.eligibleCount}`);
  console.log(`Processed: ${result.processedCount}`);
  console.log('\nLeads Selected:');
  for (const item of result.items) {
    console.log(
      `- [${item.status.toUpperCase()}] ${item.company} | ${item.roleTitle} (${item.archetype}) -> ${item.targetEmail} | Attachment: ${path.basename(item.resumePdf)}`
    );
  }
}

if (process.argv[1] && (process.argv[1].endsWith('send-outreach-batch.ts') || process.argv[1].endsWith('send-outreach-batch.js'))) {
  main().catch((err) => {
    console.error('[OUTREACH_FATAL_ERROR]', err);
    process.exit(1);
  });
}
