import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  isPoisonPrefixEmail,
  verifyDomainDeliverability,
  discoverGithubOrgCommitContacts,
  discoverPublicWebsiteContacts,
  runMode2WonderPillInvertedLeadFinder,
} from '../src/outreach/free-contact-discovery.js';
import { isSafeOutreachEmailSyntax } from './sync-applied-to-outreach.js';
import { resolveCompanyOfficialDomain } from './enrich-applied-outreach.js';
import { composeTechnicalOpenerHook } from '../src/outreach/personalized-hook-composer.js';

export type JobArchetype = 'BACKEND' | 'DATA' | 'DEVOPS' | 'FULLSTACK' | 'AI_ML';

export interface OutreachLeadItem {
  company: string;
  roleTitle: string;
  targetEmail: string;
  mxProvider: string;
  mxVerified: boolean;
  archetype: JobArchetype;
  matchedProject: string;
  subject: string;
  body: string;
  generatedAt: string;
  source: string;
  personName?: string;
  personRole?: string;
  discoveryStep?: string;
}

export function determineJobArchetype(roleTitle: string): JobArchetype {
  const t = String(roleTitle || '').toLowerCase();
  if (/\b(?:ml|machine\s+learning|ai\b|artificial|data\s+scientist|nlp|llm|eval|cv\b|vision)\b/i.test(t)) {
    return 'AI_ML';
  }
  if (/\b(?:data|analytics|etl|warehouse|database|spark|kafka|clickhouse|pipeline)\b/i.test(t)) {
    return 'DATA';
  }
  if (/\b(?:devops|sre|platform|infra|infrastructure|cloud|kubernetes|docker|systems)\b/i.test(t)) {
    return 'DEVOPS';
  }
  if (/\b(?:full[-_\s]*stack|frontend|front[-_\s]*end|ui|react|web|client)\b/i.test(t)) {
    return 'FULLSTACK';
  }
  return 'BACKEND';
}

export function getArchetypeProject(archetype: JobArchetype): { project: string; proofLine: string } {
  switch (archetype) {
    case 'AI_ML':
      return {
        project: 'Fertilizer ML API & Chaincode',
        proofLine: 'built a predictive ML microservice (XGBoost, FastAPI, Docker) delivering real-time recommendation inference and Chaincode (AI coding validation with 15+ REST APIs at 95%+ accuracy, placing 3rd out of 200+ teams at HackIndia)',
      };
    case 'DATA':
      return {
        project: 'ClickHouse Data Ingestion Tool',
        proofLine: 'developed a bidirectional OLAP-to-CSV ingestion pipeline with Kafka streaming, automated schema discovery, and zero row-count tolerance for high-throughput analytics',
      };
    case 'DEVOPS':
      return {
        project: 'Azure Snowflake CI/CD & Security Pipelines',
        proofLine: 'automated Jenkins CI/CD deployment pipelines, mTLS, OAuth 2.0, and RBAC data workflows processing 5,000,000+ records with zero failure tolerance',
      };
    case 'FULLSTACK':
      return {
        project: 'QuizDeck & Shopify Insights',
        proofLine: 'architected QuizDeck, a distributed WebSocket real-time engine stress-tested for 500 concurrent players at 31ms average latency, and Shopify Insights (PostgreSQL analytics platform)',
      };
    case 'BACKEND':
    default:
      return {
        project: 'Chaincode & Java Spring Boot Microservices',
        proofLine: 'built distributed Java Spring Boot REST microservices and Chaincode (high-throughput API platform with 15+ endpoints, placing 3rd at HackIndia among 200+ teams)',
      };
  }
}

export function composeTailored4SentenceColdEmail(
  company: string,
  roleTitle: string,
  archetype: JobArchetype,
  contact?: { personName?: string; personRole?: string; discoveryStep?: string }
): { subject: string; body: string; matchedProject: string } {
  const cleanCompany = (company || '').trim() || 'your team';
  const cleanRole = (roleTitle || '').trim() || 'Software Engineer';
  const { project, proofLine } = getArchetypeProject(archetype);

  const subject = `Applied: ${cleanRole} at ${cleanCompany} — Shivam Mahajan (Morgan Stanley / 9.35 CGPA)`;

  const hasHook = Boolean(contact && (contact.discoveryStep || contact.personRole));
  const hookOpener = hasHook
    ? composeTechnicalOpenerHook({
        company: cleanCompany,
        roleTitle: cleanRole,
        personName: contact?.personName,
        personRole: contact?.personRole,
        discoveryStep: contact?.discoveryStep,
      })
    : undefined;

  const sentence1 = `I recently submitted my application for the ${cleanRole} role at ${cleanCompany} and wanted to reach out directly to express my strong enthusiasm for what your engineering team is building.`;
  const sentence2 = `Currently a Technology Apprentice at Morgan Stanley (graduating B.E. CSE from Chitkara University with a 9.35/10.0 CGPA), I engineer customer-facing data pipelines and microservices processing 5,000,000+ daily events.`;
  const sentence3 = `Relevant to ${cleanCompany}'s focus, I built the ${project} (${proofLine}, portfolio at https://shivammahajan.com/projects/).`;
  const sentence4 = `Based in Bengaluru with immediate availability and 1,255+ consecutive days of coding commitment, I would welcome the opportunity to discuss how my hands-on background can add immediate value to ${cleanCompany}.`;

  const body = hasHook && hookOpener
    ? [
        hookOpener,
        ``,
        sentence2,
        ``,
        sentence3,
        ``,
        sentence4,
        ``,
        `Best regards,`,
        `Shivam Mahajan`,
        `Bengaluru, India`,
        `Portfolio: https://shivammahajan.com`,
        `LinkedIn: https://www.linkedin.com/in/mahajanshivam`,
        `GitHub: https://github.com/smresponsibilities`,
      ].join('\n')
    : [
        `Hi ${cleanCompany} Team,`,
        ``,
        `${sentence1} ${sentence2}`,
        ``,
        `${sentence3}`,
        ``,
        `${sentence4}`,
        ``,
        `Best regards,`,
        `Shivam Mahajan`,
        `Bengaluru, India`,
        `Portfolio: https://shivammahajan.com`,
        `LinkedIn: https://www.linkedin.com/in/mahajanshivam`,
        `GitHub: https://github.com/smresponsibilities`,
      ].join('\n');

  return { subject, body, matchedProject: project };
}

export async function resolveEmployerDomain(company: string, jobUrl?: string): Promise<string> {
  // If jobUrl contains direct employer domain
  if (jobUrl) {
    try {
      const u = new URL(jobUrl);
      const host = u.hostname.toLowerCase();
      // Ignore ATS domains
      if (!/(?:greenhouse\.io|ashbyhq\.com|lever\.co|myworkdayjobs\.com|smartrecruiters\.com)$/i.test(host)) {
        return host.replace(/^www\./, '');
      }
    } catch {}
  }

  const resolved = await resolveCompanyOfficialDomain(company);
  if (resolved) return resolved;

  // Fallback to company slug
  const slug = company.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${slug}.com`;
}

export async function backfillAppliedOutreachLeads(
  dbPath = 'state/autoapply/portal-review/queue.sqlite',
  leadsPath = 'state/autoapply/portal-review/outreach-leads.json'
): Promise<{ totalApplied: number; existingLeads: number; newlyAdded: number }> {
  if (!fs.existsSync(dbPath)) {
    console.warn(`[OUTREACH_BACKFILL] Database not found at ${dbPath}`);
    return { totalApplied: 0, existingLeads: 0, newlyAdded: 0 };
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare(
    "SELECT id, normalized_url, payload FROM applications WHERE status = 'applied'"
  ).all() as Array<{ id: string; normalized_url: string; payload: string }>;

  let leads: OutreachLeadItem[] = [];
  if (fs.existsSync(leadsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
      if (Array.isArray(parsed)) leads = parsed;
    } catch {}
  }

  // Scrub any legacy poison prefix emails from earlier runs
  leads = leads.map((l) => {
    if (l.targetEmail && isPoisonPrefixEmail(l.targetEmail)) {
      const dom = l.targetEmail.split('@')[1] || 'domain.com';
      l.targetEmail = `talent@${dom}`;
      l.source = 'poison_scrubbed_fallback';
    }
    return l;
  });

  const existingMap = new Set<string>();
  for (const l of leads) {
    existingMap.add(`${l.company.trim().toLowerCase()}|${l.roleTitle.trim().toLowerCase()}`);
  }

  let newlyAdded = 0;

  for (const row of rows) {
    let payloadObj: any = {};
    try {
      payloadObj = JSON.parse(row.payload || '{}');
    } catch {}

    const company = (payloadObj.company || '').trim();
    const roleTitle = (payloadObj.title || '').trim();
    const jobUrl = payloadObj.jobUrl || row.normalized_url || '';
    if (!company || !roleTitle) continue;

    const key = `${company.toLowerCase()}|${roleTitle.toLowerCase()}`;
    if (existingMap.has(key)) continue;

    const domain = await resolveEmployerDomain(company, jobUrl);
    const deliverability = await verifyDomainDeliverability(domain);

    // Try contact discovery
    let targetEmail = '';
    let source = 'role_fallback';
    let contactMeta: { personName?: string; personRole?: string; discoveryStep?: string } | undefined;

    // 1. Check website contacts
    const webContacts = await discoverPublicWebsiteContacts(company, domain).catch(() => []);
    const validWebContact = webContacts.find(
      (c) => isSafeOutreachEmailSyntax(c.email) && !isPoisonPrefixEmail(c.email)
    );
    if (validWebContact) {
      targetEmail = validWebContact.email;
      source = 'website_contact';
      contactMeta = {
        personName: validWebContact.name,
        personRole: (validWebContact as any).role,
      };
    }

    // 2. Check GitHub commit contacts if needed
    if (!targetEmail) {
      const gitContacts = await discoverGithubOrgCommitContacts(company, domain, undefined, roleTitle).catch(() => []);
      const validGitContact = gitContacts.find(
        (c) => isSafeOutreachEmailSyntax(c.email) && !isPoisonPrefixEmail(c.email)
      );
      if (validGitContact) {
        targetEmail = validGitContact.email;
        source = 'github_commit_osint';
        contactMeta = {
          personName: validGitContact.name,
          personRole: (validGitContact as any).repo || (validGitContact as any).repository,
          discoveryStep: 'github_org_events',
        };
      }
    }

    // 2.5 Check Mode 2 Wonder-Pill Inverted Assumption Discovery (NPM maintainer / Git patch)
    if (!targetEmail) {
      const mode2Contacts = await runMode2WonderPillInvertedLeadFinder({ company, domain }).catch(() => []);
      const validMode2 = mode2Contacts.find(
        (c) => isSafeOutreachEmailSyntax(c.email) && !isPoisonPrefixEmail(c.email)
      );
      if (validMode2) {
        targetEmail = validMode2.email;
        source = validMode2.source;
        contactMeta = {
          personName: validMode2.name,
          personRole: validMode2.role,
          discoveryStep: validMode2.source === 'mode2_npm_maintainer' ? 'inversion1_npm_maintainer_registry' : 'inversion2_git_patch_header',
        };
      }
    }

    // 3. Fallback to talent / recruiting / team email
    if (!targetEmail) {
      const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]!;
      const safePrefixes = ['talent', 'recruiting', 'engineering', 'team'];
      for (const prefix of safePrefixes) {
        const candidate = `${prefix}@${cleanDomain}`;
        if (isSafeOutreachEmailSyntax(candidate) && !isPoisonPrefixEmail(candidate)) {
          targetEmail = candidate;
          break;
        }
      }
      if (!targetEmail) {
        targetEmail = `team@${cleanDomain}`;
      }
      source = 'role_fallback';
    }

    const archetype = determineJobArchetype(roleTitle);
    const { subject, body, matchedProject } = composeTailored4SentenceColdEmail(company, roleTitle, archetype, contactMeta);

    const lead: OutreachLeadItem = {
      company,
      roleTitle,
      targetEmail,
      mxProvider: deliverability.mxProvider || 'unknown',
      mxVerified: deliverability.hasMx,
      archetype,
      matchedProject,
      subject,
      body,
      generatedAt: new Date().toISOString(),
      source,
      personName: contactMeta?.personName,
      personRole: contactMeta?.personRole,
      discoveryStep: contactMeta?.discoveryStep,
    };

    leads.push(lead);
    existingMap.add(key);
    newlyAdded++;
  }

  fs.mkdirSync(path.dirname(leadsPath), { recursive: true });
  fs.writeFileSync(leadsPath, JSON.stringify(leads, null, 2), 'utf8');

  console.log(`[OUTREACH_BACKFILL] Completed: ${rows.length} applied rows, ${leads.length} total leads (+${newlyAdded} new).`);
  return { totalApplied: rows.length, existingLeads: leads.length - newlyAdded, newlyAdded };
}

if (process.argv[1] && (process.argv[1].endsWith('backfill-applied-outreach.ts') || process.argv[1].endsWith('backfill-applied-outreach.js'))) {
  backfillAppliedOutreachLeads().catch(console.error);
}
