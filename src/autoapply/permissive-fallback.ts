// src/autoapply/permissive-fallback.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveExtendedPortalQuestionTaxonomy } from './answers.js';

export const ATTEMPTS_PATH = path.resolve('state/autoapply/portal-review/job-attempts.json');

export function getAndIncrementJobAttempt(jobId: string, filePath = ATTEMPTS_PATH): number {
  let store: Record<string, number> = {};
  try {
    if (fs.existsSync(filePath)) {
      store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {}
  const next = (store[jobId] || 0) + 1;
  store[jobId] = next;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
  } catch {}
  return next;
}

export function getJobAttemptCount(jobId: string, filePath = ATTEMPTS_PATH): number {
  try {
    if (fs.existsSync(filePath)) {
      const store = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return store[jobId] || 0;
    }
  } catch {}
  return 0;
}

/**
 * Guaranteed Universal Fallback Resolver ("Submit-All" Mode):
 * Ensures ZERO required fields are ever left blank when strict classification returns null.
 */
export function resolveUniversalPermissiveFallback(params: {
  questionText: string;
  widgetKind: string;
  options: string[] | null;
  placeholder?: string;
  inputType?: string;
  profileEmail?: string;
}): string {
  const q = `${params.questionText} ${params.placeholder || ''}`.replace(/[✱*]/g, '').toLowerCase().trim();
  const opts = (params.options || []).filter(o => o && !/^(select|choose|please select|--)/i.test(o.trim()));

  // Ticket GEN-205: Extended 50-Category Portal Question Taxonomy
  const taxonomy = resolveExtendedPortalQuestionTaxonomy(params.questionText, params.widgetKind);
  if (taxonomy !== undefined) {
    if (opts.length > 0) {
      const match =
        opts.find(o => new RegExp(`^${taxonomy}$`, 'i').test(o.trim())) ||
        opts.find(o => new RegExp(`\\b${taxonomy}\\b`, 'i').test(o.trim())) ||
        opts.find(o => /yes|align|agree|confirm/i.test(o.trim()));
      if (match) return match;
    }
    return taxonomy;
  }

  // Domain & Technical Protocol / Experience Questions (FIX protocol, REST APIs, Kafka, etc.)
  if (/\b(fix protocol|fix\b|protocol|trading|market data|financial protocol|describe your experience|tell us about your experience|experience with|hands-on experience)\b/i.test(q)) {
    if (opts.length > 0 || params.widgetKind === 'SINGLE_SELECT' || params.widgetKind === 'RADIO' || params.widgetKind === 'BOOLEAN_TOGGLE') {
      const yesHit = opts.find(o => /^(yes|i do|true|familiar|intermediate|advanced)\b/i.test(o.trim()));
      if (yesHit) return yesHit;
    } else {
      return '1 year of production experience at Morgan Stanley engineering distributed Java Spring Boot APIs, FIX and Apache Kafka event streaming pipelines processing 5,000,000+ daily events.';
    }
  }

  // 1. Choice Widgets (Select / Combobox / Radio / Boolean Toggle)
  if (
    opts.length > 0 ||
    params.widgetKind === 'SINGLE_SELECT' ||
    params.widgetKind === 'BOOLEAN_TOGGLE' ||
    params.widgetKind === 'RADIO'
  ) {
    const isNegativeQuestion =
      /\b(sponsorship|visa|restrict|non-compete|covenant|criminal|convict|felony|former employee|previously worked|relatives|family member|government official|politically exposed|auditor|pwc|deloitte|kpmg|ey\b|debarred|sanctioned)\b/i.test(
        q
      );

    if (isNegativeQuestion) {
      const noHit = opts.find(o => /^(no|false|none|i do not|not applicable|n\/a)\b/i.test(o.trim()));
      return noHit || 'No';
    }

    // Prefer high-signal positive / India / candidate-aligned options
    const preferredPatterns = [
      /^(yes|i agree|agree|true)$/i,
      /\b(bengaluru|bangalore|karnataka|india|do not reside in the us|outside us)\b/i,
      /\b(immediate|0\s*days|0\s*-\s*15|15\s*days|within [12] week)\b/i,
      /\b(0\s*-\s*[123]|1\s*-\s*[234]|less than [23]|\b1\s*year|entry|junior|associate|practical)\b/i,
      /\b(bachelor|b\.?e\b|b\.?tech|undergraduate|computer science)\b/i,
      /\b(fluent|native|advanced|c1|c2)\b/i,
      /\b(inr|annual|gross|base|website|linkedin)\b/i,
      /\b(decline|prefer not|do not wish)\b/i,
    ];
    for (const pat of preferredPatterns) {
      const match = opts.find(o => pat.test(o.trim()));
      if (match) return match;
    }

    // Numeric LPA dropdown 1..24
    if (opts.includes('12') && /\b(salary|lpa|ctc)\b/i.test(q)) return '12';

    return opts[0] || 'Yes';
  }

  // 2. Numeric Inputs
  if (params.widgetKind === 'NUMBER' || params.inputType === 'number') {
    if (/\b(gpa|cgpa|grade)\b/i.test(q)) return '9.35';
    if (/\b(notice|days to join)\b/i.test(q)) return '0';
    if (/\b(lpa|lakhs)\b/i.test(q)) return '12';
    if (/\b(ctc|salary|compensation|pay)\b/i.test(q)) return '1200000';
    if (/\b(graduat|year|batch)\b/i.test(q)) return '2026';
    if (
      /\b(ro-?r|ruby|\.net|c#|rust|golang|go\b|swift|flutter|php|cobol|servicenow|informatica|boomi|qlik|kdb)\b/i.test(
        q
      )
    )
      return '0';
    return '1';
  }

  // 3. Checkboxes
  if (params.widgetKind === 'CHECKBOX') {
    return 'true';
  }

  // 4. Text & Textarea Inputs
  const email = process.env.AUTOAPPLY_EMAIL || params.profileEmail || '';
  if (/\b(email|e-mail)\b/i.test(q)) return email;
  if (/\b(phone|mobile|contact|whatsapp)\b/i.test(q)) return process.env.AUTOAPPLY_PHONE || '9000000000';
  if (/\b(linkedin)\b/i.test(q)) return 'https://www.linkedin.com/in/mahajanshivam';
  if (/\b(github|repo|code)\b/i.test(q)) return 'https://github.com/smresponsibilities';
  if (/\b(portfolio|website|blog|sample|link|url)\b/i.test(q)) return 'https://shivammahajan.com/projects/';
  if (/\b(city|location|based|reside|address)\b/i.test(q)) return 'Bengaluru, Karnataka, India';
  if (/\b(company|employer|organization)\b/i.test(q)) return 'Morgan Stanley';
  if (/\b(title|designation|role)\b/i.test(q)) return 'Technology Apprentice';
  if (/\b(school|university|college|institute)\b/i.test(q)) return 'Chitkara University';
  if (/\b(specialization|major|branch|stream|degree)\b/i.test(q))
    return 'B.E. in Computer Science and Engineering (9.35 CGPA)';
  if (/\b(gpa|cgpa|percentage|marks)\b/i.test(q)) return '9.35 / 10.0';
  if (/\b(notice|when can you start|join|availability|earliest)\b/i.test(q)) return 'Immediate (0 days notice)';
  if (/\b(ctc|salary|compensation|pay|remuneration)\b/i.test(q)) return '12 LPA (Open / Negotiable)';
  if (/\b(referr|consultant|who recommended|employee id)\b/i.test(q)) return 'N/A — Direct Application';

  if (params.widgetKind === 'TEXTAREA' || q.length > 45) {
    return (
      'I am a 2026 Computer Science & Engineering graduate (Chitkara University, 9.35 CGPA) with 1 year of production experience ' +
      'as a Technology Apprentice at Morgan Stanley in Bengaluru, where I engineered Java Spring Boot REST APIs and Apache Kafka, ' +
      'PySpark, and Azure Snowflake pipelines processing 5,000,000+ CIAM events. I am based in Bengaluru and available to start immediately.'
    );
  }

  return 'Yes, available immediately in Bengaluru, India.';
}
