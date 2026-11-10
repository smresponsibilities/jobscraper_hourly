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

// Load .env variables into process.env if present
export function loadEnvFile(envPath = '.env'): void {
  if (!fs.existsSync(envPath)) return;
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
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
}): Promise<OutreachBatchResult> {
  loadEnvFile();

  const dryRun = options.dryRun !== false;
  const rawLimit = Number(options.limit) || 5;
  const limit = Math.min(Math.max(1, rawLimit), 15); // Capped at max 15 per invocation

  const leadsPath = options.leadsPath || path.resolve('state/autoapply/portal-review/outreach-leads.json');
  const ledgerPath = options.ledgerPath || DEFAULT_SENT_LEDGER_PATH;

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
  const ledger = loadSentLedger(ledgerPath);

  const resultItems: OutreachBatchResult['items'] = [];
  let sentCount = 0;
  let skippedCount = 0;

  // Filter and process leads
  for (const lead of leads) {
    if (resultItems.filter((i) => i.status !== 'skipped').length >= limit) {
      break;
    }

    const email = (lead.targetEmail || '').trim().toLowerCase();
    const company = (lead.company || '').trim();
    const roleTitle = (lead.roleTitle || '').trim();
    const domain = email.includes('@') ? email.split('@')[1]!.trim().toLowerCase() : '';

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

    // 4. DNS MX record validation
    let mxOk = lead.mxVerified;
    if (!mxOk && domain) {
      mxOk = await verifyDomainMxRecords(domain);
    }
    if (!mxOk) {
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

      console.log(`[OUTREACH_LIVE] Sending cold outreach to ${email} (${company} - ${roleTitle})...`);

      const info = await transporter.sendMail({
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

  let limit = 5;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx >= 0 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1]!, 10) || 5;
  }

  console.log(`[OUTREACH] Initializing batch: mode=${dryRun ? 'DRY-RUN' : 'LIVE'}, limit=${limit}`);
  const result = await runOutreachBatch({ dryRun, limit });

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
