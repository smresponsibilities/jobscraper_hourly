import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CandidateExtendedProfile } from './types.js';
import { composeGroundedNarrative } from './narrative-composer.js';

export interface LearnedSemanticRule {
  normalizedQuestion: string;
  sampleRawQuestion: string;
  linkedCategory: string;
  resolvedValue: string;
  confidence: number;
  successCount: number;
  lastUsedAt: string;
}

export interface UnknownFieldEntry {
  signature: string;
  questionText: string;
  widgetKind: string;
  isRequired: boolean;
  options: string[] | null;
  validationError: string | null;
  sectionHeading: string;
  occurrences: number;
  sampleCompanies: string[];
  sampleUrls: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

const DEFAULT_MEMORY_PATH = path.resolve('state/autoapply/portal-review/semantic-memory.json');
const DEFAULT_LEDGER_PATH = path.resolve('state/autoapply/portal-review/unknown-fields-ledger.json');

export function normalizeQuestionKey(q: string): string {
  return q
    .toLowerCase()
    .replace(/\*|\(required\)|required/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function loadSemanticMemory(memoryPath = DEFAULT_MEMORY_PATH): Record<string, LearnedSemanticRule> {
  try {
    if (fs.existsSync(memoryPath)) {
      return JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
    }
  } catch {
    // Ignore corrupt file
  }
  return {};
}

export function recordLearnedSuccess(
  questionText: string,
  linkedCategory: string,
  resolvedValue: string,
  confidence = 0.85,
  memoryPath = DEFAULT_MEMORY_PATH
): void {
  const key = normalizeQuestionKey(questionText);
  if (!key || key.length < 3) return;
  const mem = loadSemanticMemory(memoryPath);
  const existing = mem[key];
  mem[key] = {
    normalizedQuestion: key,
    sampleRawQuestion: questionText.slice(0, 200),
    linkedCategory,
    resolvedValue,
    confidence: Math.min(1.0, (existing?.confidence ?? confidence) + 0.05),
    successCount: (existing?.successCount ?? 0) + 1,
    lastUsedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, JSON.stringify(mem, null, 2), 'utf8');
}

export function logUnknownFieldForLearning(
  entry: {
    questionText: string;
    widgetKind: string;
    isRequired: boolean;
    options?: string[] | null;
    validationError?: string | null;
    sectionHeading?: string;
    company: string;
    url: string;
  },
  ledgerPath = DEFAULT_LEDGER_PATH
): void {
  const normKey = normalizeQuestionKey(entry.questionText);
  if (!normKey || normKey.length < 2) return;
  const key = `${normKey}::${entry.widgetKind}`;
  let ledger: Record<string, UnknownFieldEntry> = {};
  try {
    if (fs.existsSync(ledgerPath)) {
      ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    }
  } catch {
    ledger = {};
  }
  const now = new Date().toISOString();
  const existing = ledger[key];
  if (existing) {
    existing.occurrences += 1;
    existing.lastSeenAt = now;
    if (entry.validationError && !existing.validationError) {
      existing.validationError = entry.validationError;
    }
    if (entry.options?.length && !existing.options?.length) {
      existing.options = entry.options.slice(0, 25);
    }
    if (!existing.sampleCompanies.includes(entry.company) && existing.sampleCompanies.length < 10) {
      existing.sampleCompanies.push(entry.company);
    }
    if (!existing.sampleUrls.includes(entry.url) && existing.sampleUrls.length < 5) {
      existing.sampleUrls.push(entry.url);
    }
  } else {
    ledger[key] = {
      signature: key,
      questionText: entry.questionText.slice(0, 300),
      widgetKind: entry.widgetKind,
      isRequired: entry.isRequired,
      options: entry.options ? entry.options.slice(0, 25) : null,
      validationError: entry.validationError || null,
      sectionHeading: entry.sectionHeading || '',
      occurrences: 1,
      sampleCompanies: [entry.company],
      sampleUrls: [entry.url],
      firstSeenAt: now,
      lastSeenAt: now,
    };
  }
  // Sort ledger by occurrences descending so highest-impact gaps are always at the top
  const sorted = Object.fromEntries(
    Object.entries(ledger).sort((a, b) => b[1].occurrences - a[1].occurrences)
  );
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(sorted, null, 2), 'utf8');
}

/**
 * 1. Bottom-Up Option-Signature Inference:
 * Identifies what a dropdown/radio question is asking purely from the shape of its options[]!
 */
export function inferAnswerFromOptionSignature(
  questionText: string,
  options: string[]
): { category: string; value: string } | null {
  if (Array.isArray(questionText) && typeof options === 'string') {
    const tmp = questionText;
    questionText = options;
    options = tmp;
  }
  if (!options || options.length === 0) return null;
  const joined = options.join(' | ').toLowerCase();

  // Referral Source signature
  if (/\b(linkedin|job board|company website|careers page|glassdoor|indeed|referral)\b/.test(joined)) {
    const hit = options.find(o => /website/i.test(o)) || options.find(o => /linkedin|job board|other/i.test(o)) || options[0]!;
    return { category: 'referral_source', value: hit };
  }
  // Notice Period signature (Ticket GEN-120: prefer shortest bucket)
  if (/\b(immediate|15 days|30 days|60 days|90 days|notice|serving notice)\b/i.test(joined)) {
    const hit =
      options.find(o => /^immediate\b/i.test(o.trim())) ||
      options.find(o => /immediate|serving notice|0\s*days|0\s*-\s*15|less than 15|< ?15|1\s*week|2\s*weeks/i.test(o)) ||
      options.find(o => /30\s*days|< ?30/i.test(o)) ||
      options[0]!;
    return { category: 'notice_period', value: hit };
  }
  // Salary / Compensation range buckets (Ticket GEN-120: Shivam ground truth is 12 LPA -> matches "10 - 15 LPA" or "8 - 12 LPA")
  if (/\b(lpa|lakhs?|inr|per annum|\bctc\b|\bsalary\b)\b/i.test(joined) && options.some(o => /\d+\s*[-–]\s*\d+|\d+\s*lpa/i.test(o))) {
    const hit =
      options.find(o => /\b1[0-2]\s*[-–]\s*1[5-9]\b/i.test(o) || /\b10\s*[-–]\s*15\b/i.test(o) || /\b8\s*[-–]\s*12\b/i.test(o) || /\b12\s*lpa\b/i.test(o)) ||
      options.find(o => /\b1[0-5]\b/i.test(o)) ||
      options[0]!;
    return { category: 'expected_salary', value: hit };
  }
  // Compensation agreement / confirmation options signature (Particle41)
  if (
    /\b(?:compensation|salary|budget|range|aligns?|confirm|agree|accept)\b/i.test(questionText) ||
    /\b(?:aligns?|comfortable|competitive package|desired annual compensation)\b/i.test(joined)
  ) {
    const hit =
      options.find(o => /^(?:yes|i agree|agree|confirm|aligns?|comfortable|understand|accept)\b/i.test(o.trim())) ||
      options.find(o => /yes|align|agree|confirm|comfortable|understand|accept|10\s*-\s*15|₹|\$/i.test(o)) ||
      options[0]!;
    return { category: 'compensation_agreement', value: hit };
  }
  // Experience Bucket signature
  if (/\b(0\s*-\s*1|1\s*-\s*3|3\s*-\s*5|5\+\s*years|entry level|<\s*1\s*year|fresher)\b/.test(joined)) {
    const hit = options.find(o => /0\s*-\s*[123]|1\s*-\s*[234]|less than|<\s*1|\b1\s*year|entry|junior|associate|fresher/i.test(o));
    if (hit) return { category: 'total_experience', value: hit };
  }
  // Degree signature
  if (/\b(bachelor|master|doctorate|phd|high school|associate degree)\b/.test(joined)) {
    const hit = options.find(o => /bachelor|b\.?e\b|b\.?tech|undergraduate/i.test(o));
    if (hit) return { category: 'degree', value: hit };
  }
  // Month signature (e.g. Ashby/Workday education/experience dates - Ticket GEN-68)
  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(joined)) {
    const isStart = /start|from|begin/i.test(questionText);
    const hit = isStart
      ? (options.find(o => /^june\b/i.test(o.trim())) || options.find(o => /^august\b/i.test(o.trim())) || options.find(o => !/month|\.\.\./i.test(o.trim())) || options[0]!)
      : (options.find(o => /^august\b/i.test(o.trim())) || options.find(o => /^june\b/i.test(o.trim())) || options.find(o => !/month|\.\.\./i.test(o.trim())) || options[0]!);
    return { category: 'date_month', value: hit };
  }
  // 4-digit Year signature (e.g. graduation/start year - Ticket GEN-68)
  if (options.some(o => /\b(?:202[0-9]|201[5-9])\b/.test(o.trim()))) {
    const isStart = /start|from|begin/i.test(questionText);
    const hit = isStart
      ? (options.find(o => /\b2022\b/.test(o.trim())) || options.find(o => /\b2023\b/.test(o.trim())) || options[0]!)
      : (options.find(o => /\b2026\b/.test(o.trim())) || options.find(o => /\b2025\b/.test(o.trim())) || options[0]!);
    return { category: 'date_year', value: hit };
  }
  // EEO Gender / Veteran / Disability / Race signature
  if (/\b(decline to self-identify|prefer not to say|i do not wish to answer|choose not to disclose|not to disclose|do not wish)\b/.test(joined)) {
    const decline = options.find(o => /decline|prefer not|do not wish|not to disclose|choose not/i.test(o)) || options[options.length - 1]!;
    return { category: 'eeo_decline', value: decline };
  }
  // Gender options without explicit decline
  if (/\b(male|female)\b/.test(joined) && !/\b(clothing|apparel|shoe)\b/.test(joined)) {
    const hit = options.find(o => /^male\b/i.test(o.trim())) || options.find(o => /^(decline|prefer not)/i.test(o.trim())) || options[0]!;
    return { category: 'gender', value: hit };
  }
  // Country signature
  if (options.length >= 15) {
    const ind = options.find(o => /^india\b/i.test(o.trim()) || /\bindia\b/i.test(o.trim()));
    if (ind) return { category: 'country', value: ind };
  }
  // Australia work rights signature (observed on Atomic)
  if (/\b(australian citizen|australian permanent resident|unrestricted full-time work rights|australian work rights)\b/.test(joined)) {
    const hit = options.find(o => /do not currently have|no australian work rights|not authorized/i.test(o)) || options[options.length - 1]!;
    return { category: 'australia_work_rights', value: hit };
  }
  // Canada work permit signature (observed on Blackbird)
  if (/\b(canada on a work permit|require a work permit\/visa|eligible to work in canada)\b/.test(joined)) {
    const hit = options.find(o => /require a work permit|would require/i.test(o)) || options[options.length - 1]!;
    return { category: 'canada_work_rights', value: hit };
  }
  // Commute distance / Relocation signature (observed on loopfour / Columbus)
  if (/\b(willing to relocate|commuting distance|relocate to)\b/.test(joined)) {
    const hit = options.find(o => /willing to relocate|relocate/i.test(o)) || options.find(o => /^no\b/i.test(o.trim())) || options[0]!;
    return { category: 'commute_relocation', value: hit };
  }
  // Salary ranges signature (e.g. Atomic: $50,000 - $70,000)
  if (options.some(o => /\$\d{2,3},\d{3}/.test(o))) {
    const hit = options.find(o => /\$(?:50|60|70|80),\d{3}/.test(o)) || options.find(o => !/select\.\.\./i.test(o)) || options[0]!;
    return { category: 'salary_range_option', value: hit };
  }
  // Location selection dropdown (e.g. which location are you applying for / opportunitylocationid)
  if (options.some(o => /india/i.test(o))) {
    const hit = options.find(o => /^india\b/i.test(o.trim()) || /\bindia\b/i.test(o.trim()))!;
    return { category: 'country', value: hit };
  }
  if (options.some(o => /united states|canada/i.test(o)) && options.length <= 5) {
    const hit = options.find(o => /united states/i.test(o)) || options.find(o => !/select\.\.\./i.test(o)) || options[0]!;
    return { category: 'location_selection', value: hit };
  }
  // Indian State signature (e.g. Karnātaka / Karnataka)
  if (options.some(o => /karn[aā]taka/i.test(o))) {
    const hit = options.find(o => /karn[aā]taka/i.test(o)) || options[0]!;
    return { category: 'indian_state', value: hit };
  }
  // University / School signature (e.g. Ashby Education History)
  if (/\b(university|institute|college|academy|school)\b/i.test(joined)) {
    const hit = options.find(o => /chitkara/i.test(o)) || options.find(o => /india/i.test(o)) || options[0]!;
    return { category: 'education_school_option', value: hit };
  }

  // Ticket GEN-280 & GEN-284: Bottom-up option signature matchers: Mobile, Fluent, Full-time, Hybrid, L
  // Phone device type signature (e.g. Workday / iCIMS phone type dropdown)
  if (/\b(mobile|cell|cellular|home|work|landline|pager)\b/i.test(joined)) {
    const hit = options.find(o => /^mobile\b/i.test(o.trim())) || options.find(o => /mobile|cell/i.test(o)) || options[0]!;
    return { category: 'phone_device_type', value: hit };
  }

  // Language proficiency signature (Fluent / Native / Intermediate / Basic)
  if (/\b(fluent|native|proficient|conversational|intermediate|basic|beginner)\b/i.test(joined)) {
    const hit = options.find(o => /^fluent\b/i.test(o.trim())) || options.find(o => /^native\b/i.test(o.trim())) || options.find(o => /fluent|native|proficient/i.test(o)) || options[0]!;
    return { category: 'language_proficiency', value: hit };
  }

  // Employment schedule / job type signature (Full-time / Part-time / Contract)
  if (/\b(full[- ]time|part[- ]time|contract|internship|temporary)\b/i.test(joined)) {
    const hit = options.find(o => /^full[- ]time\b/i.test(o.trim())) || options.find(o => /full[- ]time/i.test(o)) || options[0]!;
    return { category: 'employment_type', value: hit };
  }

  // Workplace model signature (Hybrid / Remote / On-site)
  if (/\b(hybrid|remote|on[- ]?site|in[- ]?office)\b/i.test(joined)) {
    const hit = options.find(o => /^hybrid\b/i.test(o.trim())) || options.find(o => /^remote\b/i.test(o.trim())) || options.find(o => /hybrid|remote/i.test(o)) || options[0]!;
    return { category: 'workplace_model', value: hit };
  }

  // Clothing / T-shirt size signature (XS, S, M, L, XL, XXL)
  if (/\b(?:xs|small|medium|large|xl|xxl)\b/i.test(joined) || options.some(o => /^(?:xs|s|m|l|xl|xxl)$/i.test(o.trim()))) {
    const hit = options.find(o => /^l\b/i.test(o.trim()) || /^large\b/i.test(o.trim())) || options.find(o => /^m\b/i.test(o.trim()) || /^medium\b/i.test(o.trim())) || options[0]!;
    return { category: 'tshirt_size', value: hit };
  }

  // Binary Yes/No options for disqualifying / specialized prompts
  if (options.length === 2 && options.some(o => /^yes\b/i.test(o.trim())) && options.some(o => /^no\b/i.test(o.trim()))) {
    const normQ = questionText.toLowerCase();
    if (/\b(sponsorship|require.*visa|visa.*sponsor|require any help.*file visa|sponsorship in the future)\b/i.test(normQ)) {
      const noOpt = options.find(o => /^no\b/i.test(o.trim())) || 'No';
      return { category: 'visa_sponsorship_custom', value: noOpt };
    }
    if (/\b(authorized to work|legally authorized|eligible to work|right to work)\b/i.test(normQ)) {
      const yesOpt = options.find(o => /^yes\b/i.test(o.trim())) || 'Yes';
      return { category: 'work_authorization_custom', value: yesOpt };
    }
    if (/\b(closed.*deals|closed.*contracts|annual contract value|quota|book of business|sales targets?|revenue closed|(?:currently\s+)?(?:located|residing|live|living)\s+in\s+the\s+(?:u\.?\s*s\.?|united states)|columbus.*office|u\.?\s*s\.?\s*citizen for itar|itar|(?:have|did)\s+you\s+work(?:ed)?\s+here\s+before|previously worked for us|employed by|related to.*tekion|contractor.*tekion|offer in hand|former associate|employment agreements?|post[- ]employment restrictions?|non[- ]compete)\b/i.test(normQ)) {
      const noOpt = options.find(o => /^no\b/i.test(o.trim())) || 'No';
      return { category: 'disqualifying_affirmation_negative', value: noOpt };
    }
    if (/\b(bachelors?(?:\s*degree)?|have a bachelor|18 years|over 18|age of majority|willing to work in shifts?|24\s*[\/-]?\s*7\s*environment|relocate|willing to relocate|relocate at your own expense)\b/i.test(normQ)) {
      const yesOpt = options.find(o => /^yes\b/i.test(o.trim())) || 'Yes';
      return { category: 'qualifying_affirmation_positive', value: yesOpt };
    }
  }
  return null;
}

/**
 * 2. Top-Down Semantic Concept Linker & Validation Error Self-Healer:
 * Links custom question phrasings (like Onit, Brevo, custom Workday prompts) to verified candidate facts.
 */
export function resolveBySemanticSelfLearning(
  questionText: string,
  widgetKind: string,
  options: string[] | null,
  validationError: string | null,
  profile: CandidateExtendedProfile,
  memoryPath = DEFAULT_MEMORY_PATH
): { category: string; value: string; confidence: number } | null {
  const key = normalizeQuestionKey(questionText);

  // Step A: Check Persistent Semantic Memory first (unless in validation error healing)
  if (!validationError) {
    const mem = loadSemanticMemory(memoryPath);
    if (mem[key]) {
      if (!options?.length || options.includes(mem[key]!.resolvedValue)) {
        return {
          category: mem[key]!.linkedCategory,
          value: mem[key]!.resolvedValue,
          confidence: mem[key]!.confidence,
        };
      }
    }
  }

  // Step B: Bottom-Up Option-Signature Inference
  if (options && options.length > 0) {
    const sigMatch = inferAnswerFromOptionSignature(questionText, options);
    if (sigMatch) {
      return { ...sigMatch, confidence: 0.9 };
    }
  }

  // Step C: Validation Error Self-Healing (when a field failed validation on Onit/Brevo)
  const err = (validationError || '').toLowerCase();
  if (err) {
    if (/\b(?:url|http)\b|enter a url|valid url|must be a url|requested format/i.test(err)) {
      const url = /github|code|repo/i.test(key)
        ? (profile as any).personal?.githubUrl || (profile as any).personal?.github || 'https://github.com/smresponsibilities'
        : (profile as any).personal?.linkedinUrl || (profile as any).personal?.linkedin || 'https://www.linkedin.com/in/mahajanshivam';
      return { category: 'healed_url', value: url, confidence: 0.85 };
    }
    if (/\b(?:number|numeric|integer|digits only)\b|enter a number|valid number/i.test(err)) {
      if (/gpa|cgpa|grade/i.test(key)) return { category: 'healed_cgpa', value: String(profile.education?.[0]?.gpa || '9.35'), confidence: 0.9 };
      if (/salary|ctc|compensation|pay/i.test(key)) return { category: 'healed_ctc', value: String(profile.professional?.expectedSalary || '1200000'), confidence: 0.85 };
      if (/notice|days/i.test(key)) return { category: 'healed_notice_days', value: String(profile.professional?.noticePeriodDays ?? '0'), confidence: 0.9 };
      return { category: 'healed_numeric_yoe', value: String(profile.professional?.totalYearsExperience || '1'), confidence: 0.8 };
    }
  }

  // Step D: Semantic Concept Bag Linking for Custom Employer Questions
  const isNumber = widgetKind.toUpperCase() === 'NUMBER';
  const conceptRules: Array<{ category: string; pattern: RegExp; resolve: () => string }> = [
    {
      category: 'total_years_full_time_experience',
      pattern: /\b(how many years of (?:full[- ]?time\s+|total\s+|overall\s+|work\s+|professional\s+)?experience|years of full[- ]?time experience|total years of experience)\b/i,
      resolve: () => '1',
    },
    {
      category: 'former_employee_or_consultant_negative',
      pattern: /\b(previously worked at|consulted for|ever worked for|former employee|worked at or consulted for)\b/i,
      resolve: () => 'No',
    },
    {
      category: 'sponsorship_required_negative',
      pattern: /\b(require.*sponsorship|visa sponsorship|immigration sponsorship)\b/i,
      resolve: () => 'No',
    },
    {
      category: 'ruby_on_rails_production_narrative',
      pattern: /\b(ruby on rails|ruby|rails)\b/i,
      resolve: () => "While I have not worked extensively with Ruby on Rails in production yet, during my Technology Apprenticeship at Morgan Stanley (Aug 2025 – Aug 2026) I engineered scalable enterprise backend services using Java Spring Boot REST APIs, Python/PySpark data pipelines, and Apache Kafka workflows, applying core distributed system, testing, and CI/CD patterns directly transferable to production web applications.",
    },
    {
      category: 'highest_degree_field_university_grad_year',
      pattern: /\b(highest degree.*field of study|highest degree.*university|degree.*field of study.*graduation year)\b/i,
      resolve: () => 'Bachelor of Engineering in Computer Science and Engineering, Chitkara University, Class of 2026 (9.35 CGPA)',
    },
    {
      category: 'educational_qualification_engineering',
      pattern: /\b(educational qualification|highest qualification|degree qualification)\b/i,
      resolve: () => {
        if (options && options.length > 0) {
          const hit = options.find(o => /b\.?e\/b\.?tech.*computer science|b\.?e\b|b\.?tech|bachelor.*engineering|computer science/i.test(o));
          if (hit) return hit;
        }
        return 'BE/B.Tech / Dual Degree -  Computer Science /EE';
      },
    },
    {
      category: 'name_of_the_college',
      pattern: /\b(name of the college|college name|name of college)\b/i,
      resolve: () => {
        if (options && options.length > 0) {
          const hit = options.find(o => /chitkara/i.test(o));
          if (hit) return hit;
          const otherOpt = options.find(o => /^(?:other|others)\b/i.test(o.trim()));
          if (otherOpt) return otherOpt;
        }
        return 'Other';
      },
    },
    {
      category: 'repetitive_tasks_affirmative',
      pattern: /\b(comfortable with performing highly repetitive tasks|repetitive tasks|performing repetitive)\b/i,
      resolve: () => 'Yes',
    },
    {
      category: 'phone_number_direct',
      pattern: /^(phone|mobile|telephone|contact number|phone number)\*?$/i,
      resolve: () => process.env.AUTOAPPLY_PHONE || profile.personal?.phone || '9000000000',
    },
    {
      category: 'compensation_expectation',
      pattern: /\b(ctc|salary|compensation|remuneration|pay expectation|expected pay|target pay|annual base|stipend)\b/i,
      resolve: () => (isNumber ? String(profile.professional?.expectedSalary || '1200000') : '12 LPA (Open / Negotiable as per company standards)'),
    },
    {
      category: 'notice_period_custom',
      pattern: /\b(join|joining|start date|how soon|notice|lead time|transition period|earliest date)\b/i,
      resolve: () => (isNumber || /\b(?:in\s+days|days)\b/i.test(key) ? String(profile.professional?.noticePeriodDays ?? '0') : 'Immediate (Available to start immediately)'),
    },
    {
      category: 'location_preference_custom',
      pattern: /\b(where do you currently reside|where do you reside|work from|commute|relocate to|based out of|current city|reside in|living in|time zone|timezone)\b/i,
      resolve: () => (/time\s*zone/i.test(key) ? 'IST (UTC+5:30) / Flexible' : `${profile.personal?.city || 'Bengaluru'}, ${profile.personal?.state || 'Karnataka'}, ${profile.personal?.country || 'India'}`),
    },
    {
      category: 'role_motivation_narrative',
      pattern: /\b(what interests you about this role|share what interests you|why do you want to work|why are you interested in|why this role)\b/i,
      resolve: () => 'I am eager to contribute to your engineering team by leveraging my experience at Morgan Stanley in building scalable distributed systems and backend data pipelines. I am excited by your product mission and look forward to delivering reliable, high-impact software from day one.',
    },
    {
      category: 'relocate_at_own_expense',
      pattern: /\b(relocate at your own expense|willing to relocate at your own expense)\b/i,
      resolve: () => 'Yes',
    },
    {
      category: 'visa_help_future',
      pattern: /\b(require any help.*file visa|require.*visa.*future|help.*visa)\b/i,
      resolve: () => 'No',
    },
    {
      category: 'education_gpa_custom',
      pattern: /\b(cgpa|gpa|percentage|academic score|marks|grade point)\b/i,
      resolve: () => (isNumber ? String(profile.education?.[0]?.gpa || '9.35') : `${profile.education?.[0]?.gpa || '9.35'} / 10.0`),
    },
    {
      category: 'graduation_year_custom',
      pattern: /\b(year of graduation|graduating year|passout year|batch of|class of|completion year)\b/i,
      resolve: () => String(profile.education?.[0]?.graduationYear || '2026'),
    },
    {
      category: 'pronouns_or_preferred_name',
      pattern: /\b(pronouns?|preferred name|nickname|how do you pronounce)\b/i,
      resolve: () => (/pronoun/i.test(key) ? 'He/Him' : (profile.personal?.preferredName || [profile.personal?.firstName, profile.personal?.lastName].filter(Boolean).join(' ') || 'Shivam Mahajan')),
    },
    {
      category: 'work_authorization_custom',
      pattern: /\b(legally authorized|work authorization|authorized to work|eligible to work|right to work)\b/i,
      resolve: () => 'Yes',
    },
    {
      category: 'visa_sponsorship_custom',
      pattern: /\b(sponsorship|require.*visa|visa.*sponsor)\b/i,
      resolve: () => 'No',
    },
    {
      category: 'gender_custom',
      pattern: /^(gender|sex|gender identity)$/i,
      resolve: () => 'Male',
    },
    {
      category: 'legal_name_government_id',
      pattern: /\b(aadhaar|pan\s*card|government\s*id|national\s*id|official\s*name)\b/i,
      resolve: () => (profile.personal?.firstName && profile.personal?.lastName ? `${profile.personal.firstName} ${profile.personal.lastName}` : 'Shivam Mahajan'),
    },
    {
      category: 'total_experience_custom',
      pattern: /\b(total\s*(?:years\s*(?:of\s*)?)?(?:work\s*|relevant\s*)?experience|overall\s*experience)\b/i,
      resolve: () => String(profile.professional?.totalYearsExperience || '1'),
    },
    {
      category: 'education_history_school',
      pattern: /\b(?:school|university|college|alma mater|education history)\b/i,
      resolve: () => (widgetKind.toUpperCase() === 'CHECKBOX' ? 'Yes' : ((profile as any).education?.[0]?.school || 'Chitkara University')),
    },
    {
      category: 'commute_distance_custom',
      pattern: /\b(live within reasonable commuting distance|commuting distance|commute to)\b/i,
      resolve: () => {
        if (options && options.some(o => /relocate/i.test(o))) {
          return options.find(o => /relocate/i.test(o))!;
        }
        return 'No';
      },
    },
    {
      category: 'foreign_office_attendance',
      pattern: /\b(willing to go into the .* office|office .* days a week|columbus.*short north)\b/i,
      resolve: () => 'No',
    },
    {
      category: 'located_in_us_custom',
      pattern: /\b((?:currently\s+)?(?:located|residing|live|living)\s+in\s+the\s+(?:u\.?\s*s\.?|united states)|which\s+(?:u\.?\s*s\.?|united states)\s*state)\b/i,
      resolve: () => (/which.*state/i.test(key) ? 'N/A (India)' : 'No'),
    },
    {
      category: 'enterprise_deals_sales_revenue',
      pattern: /\b(closed.*deals|closed.*contracts|annual contract value|quota|book of business|sales targets?|revenue closed)\b/i,
      resolve: () => 'No',
    },
    {
      category: 'consulting_ai_agentic_solutions',
      pattern: /\b(sold or scoped consulting engagements|scoped consulting|agentic workflow solutions|client conversations at the executive level)\b/i,
      resolve: () => 'While my primary focus is technical engineering—designing and deploying high-throughput distributed systems and data pipelines at Morgan Stanley—I have architected AI agent workflows and collaborated with senior stakeholders to articulate the business impact and architectural feasibility of automated solutions.',
    },
    {
      category: 'employment_restrictions_negative',
      pattern: /\b(?:employment agreements?|post[- ]employment restrictions?|non[- ]compete|restrictive covenants?)\b/i,
      resolve: () => 'No',
    },
    {
      category: 'confirm_email_address',
      pattern: /\b(?:confirm(?:ation)?\s*email|re[- ]?enter\s*email|verify\s*email)\b/i,
      resolve: () => (profile as any).personal?.email || 'shivam@example.com',
    },
    {
      category: 'alert_frequency_custom',
      pattern: /\b(?:alert\s*frequency|job\s*alert\s*frequency|notification\s*frequency)\b/i,
      resolve: () => {
        if (options && options.length > 0) {
          const hit = options.find(o => /\b7\b|weekly/i.test(o));
          if (hit) return hit;
        }
        return '7';
      },
    },
    {
      category: 'accounting_erp_systems',
      pattern: /\b(?:accounting|erp|netsuite|sap|financial software|quickbooks|oracle financials)\b/i,
      resolve: () => {
        if (options && options.length > 0) {
          const hit = options.find(o => /\b(?:sql|python|none|other)\b/i.test(o));
          if (hit) return hit;
          return options[options.length - 1]!;
        }
        return 'None';
      },
    },
    {
      category: 'location_city_direct',
      pattern: /^(?:location\s*\(city\)|city)\*?$/i,
      resolve: () => (options && options.length > 0 ? (options.find(o => /bengaluru|bangalore/i.test(o)) || options[0]!) : 'Bengaluru'),
    },
    {
      category: 'country_region_direct',
      pattern: /^(?:country(?:\/region)?)\*?$/i,
      resolve: () => (options && options.length > 0 ? (options.find(o => /india/i.test(o)) || options[0]!) : 'India'),
    },
    {
      category: 'shift_environment_affirmative',
      pattern: /\b(?:work in shifts?|24\s*[\/-]?\s*7\s*environment)\b/i,
      resolve: () => 'Yes',
    },
    {
      category: 'authorization_rbac_experience',
      pattern: /\b(?:authorization concepts|role based access control|rbac|fine grained permissions)\b/i,
      resolve: () => 'Yes, extensive hands-on experience implementing Role-Based Access Control (RBAC) and fine-grained permissions across microservices and data pipelines.',
    },
    {
      category: 'candidate_email_direct',
      pattern: /^email$/i,
      resolve: () => (profile as any).personal?.email || 'shivam@example.com',
    },
    {
      category: 'open_to_roles_custom',
      pattern: /\b(open to the following roles|interested in other roles|open to other roles)\b/i,
      resolve: () => (widgetKind.toUpperCase() === 'CHECKBOX' ? 'true' : 'Yes'),
    },
    {
      category: 'still_student_affirmative',
      pattern: /\b(?:still student|currently a student|current student)\b/i,
      resolve: () => (widgetKind.toUpperCase() === 'CHECKBOX' ? 'true' : 'Yes'),
    },
    {
      category: widgetKind.toUpperCase() === 'CHECKBOX' ? 'checkbox_negative' : 'tekion_employee_negative',
      pattern: /\b(?:currently a tekion employee|tekion employee)\b/i,
      resolve: () => 'No',
    },
    {
      category: 'previous_employment_or_relation',
      pattern: /\b(contractor or consultant for|related to.*relationship with|worked (?:here|for us) before|previously worked for us|ever been employed by|former associate)\b/i,
      resolve: () => (widgetKind.toUpperCase() === 'CHECKBOX' ? 'false' : 'No'),
    },
    {
      category: 'specialized_industry_experience',
      pattern: /\b(?:gaming|aerospace|automotive|pharma|oil|aviation)\s+(?:industry\s+)?experience\b/i,
      resolve: () => (isNumber ? '0' : '0 years'),
    },
    {
      category: 'job_alert_frequency_days',
      pattern: /\b(?:how often.*receive an alert|alert frequency|receive an alert.*days)\b/i,
      resolve: () => '7',
    },
    {
      category: 'current_or_preferred_location',
      pattern: /\b(current location|preferred location|location preference|location\s+city|residence city)\b/i,
      resolve: () => 'Bengaluru, India',
    },
    {
      category: 'banking_bfsi_domain_affirmative',
      pattern: /\b(?:banking or bfsi domain|bfsi domain|banking domain)\b/i,
      resolve: () => 'Yes',
    },
    {
      category: 'hadoop_scheduling_experience',
      pattern: /\b(?:experience in hadoop|hadoop.*scheduling)\b/i,
      resolve: () => 'Yes, hands-on experience designing and operating distributed data pipelines with Hadoop, Spark, and workflow schedulers at scale.',
    },
    {
      category: 'canada_work_permit_negative',
      pattern: /\b(?:currently in canada|canada.*work permit|canada.*visa)\b/i,
      resolve: () => 'No',
    },
    {
      category: 'eligible_affirmation_positive',
      pattern: /^yes\b.*(?:eligible|authorized)\b/i,
      resolve: () => 'Yes',
    },
    {
      category: 'us_state_not_applicable',
      pattern: /\b(?:which\s+(?:u\.?\s*s\.?|united states)\s*state|(?:u\.?\s*s\.?|united states)\s*state\s+do\s+you\s+currently\s+live\s+in)\b/i,
      resolve: () => 'N/A (India)',
    },
    {
      category: 'cctc_ectc_inr',
      pattern: /\b(?:cctc|ectc|current ctc|expected ctc)\b/i,
      resolve: () => (isNumber ? '1200000' : '12 LPA'),
    },
    {
      category: 'competing_offer_in_hand',
      pattern: /\b(offer in hand|competing offers?|active offers?)\b/i,
      resolve: () => 'No',
    },
    {
      category: 'career_aspirations',
      pattern: /\b(career aspirations?|short[- ]term.*long[- ]term|aspirations)\b/i,
      resolve: () => 'Short-term: Excel as a backend and distributed systems engineer building high-throughput microservices. Long-term: Lead architectural design and scalable infrastructure.',
    },
    {
      category: 'bachelors_degree_affirmative',
      pattern: /\b(bachelors?(?:\s*degree)?|have a bachelor)\b/i,
      resolve: () => 'Yes',
    },
    {
      category: 'itar_us_citizen_negative',
      pattern: /\b(itar|u\.?s\.?\s*citizen for itar)\b/i,
      resolve: () => 'No',
    },
    {
      category: 'linkedin_url_custom',
      pattern: /\b(linkedin|linkedln)\s*(?:profile|url)?\b/i,
      resolve: () => ((profile as any).personal?.linkedinUrl || 'https://www.linkedin.com/in/mahajanshivam'),
    },
    {
      category: 'employment_type_full_time',
      pattern: /^full[- ]time$/i,
      resolve: () => 'Yes',
    },
    {
      category: 'employment_type_other',
      pattern: /^(part[- ]time|casual|contract)$/i,
      resolve: () => 'No',
    },
    {
      category: 'brand_partnership_grounded_response',
      pattern: /\b(brand fam should partner with|brands you ve personally closed|collaboration ideas)\b/i,
      resolve: () => 'FamPay could partner with campus cafeterias and student discount platforms to enable frictionless UPI micro-payments and student reward discounts.',
    },
    {
      category: 'role_interest_grounded_narrative',
      pattern: /\b(what interests you|share what interests|brand.*partner|collaboration ideas|strengthened relationships|why this role|tell us about|how you've owned)\b/i,
      resolve: () => composeGroundedNarrative(questionText, profile) || "I am a Computer Science graduate from Chitkara University (9.35 CGPA) with 1 year of professional experience as a Technology Apprentice at Morgan Stanley in Bengaluru, specializing in Java Spring Boot backend microservices and Python/PySpark data platforms.",
    },
  ];

  for (const rule of conceptRules) {
    if (rule.pattern.test(key)) {
      const rawVal = rule.resolve();
      if (options && options.length > 0) {
        let bestOpt: string | undefined;
        if (/^(?:yes|no)$/i.test(rawVal)) {
          bestOpt = options.find(o => new RegExp(`^${rawVal}\\b`, 'i').test(o.trim())) || options.find(o => new RegExp(`\\b${rawVal}\\b`, 'i').test(o.trim()));
        } else if (/^\d+$/.test(rawVal)) {
          bestOpt = options.find(o => new RegExp(`\\b${rawVal}\\b`).test(o));
        } else {
          bestOpt = options.find(o => o.toLowerCase().includes(rawVal.toLowerCase().slice(0, 6)));
        }
        bestOpt ||= options.find(o => !/^(none|no\b)/i.test(o.trim())) || options[0]!;
        return { category: rule.category, value: bestOpt, confidence: 0.8 };
      }
      return { category: rule.category, value: rawVal, confidence: 0.8 };
    }
  }

  // Step E: Lever Custom Cards & Radio/Checkbox fallbacks
  if (/^cards\[[0-9a-f-]+\]\[field\d+\]$/i.test(questionText.trim()) || /^cards\s+[0-9a-f-]+\s+field\d+$/i.test(key)) {
    if (widgetKind.toUpperCase() === 'TEXTAREA' || widgetKind.toUpperCase() === 'TEXT' || widgetKind.toUpperCase() === 'INPUT') {
      const narrative = composeGroundedNarrative(questionText, profile) ||
        "I am a Computer Science graduate from Chitkara University (9.35 CGPA) with 1 year of professional experience as a Technology Apprentice at Morgan Stanley in Bengaluru, specializing in Java Spring Boot backend microservices and Python/PySpark data platforms.";
      return { category: 'lever_custom_card_narrative', value: narrative, confidence: 0.85 };
    }
    if (options && options.length > 0) {
      const sigMatch = inferAnswerFromOptionSignature(questionText, options);
      if (sigMatch) return { ...sigMatch, confidence: 0.85 };
      const opt = options.find(o => !/select\.\.\.|choose/i.test(o)) || options[0]!;
      return { category: 'lever_custom_card_option', value: opt, confidence: 0.75 };
    }
  }

  // Step F: Raw Yes/No radio button fallback (e.g. Lever question label not captured)
  if ((key === 'yes' || key === 'no') && (widgetKind.toUpperCase() === 'RADIO' || widgetKind.toUpperCase() === 'INPUT')) {
    if (options && options.length > 0) {
      const noOpt = options.find(o => /^no\b/i.test(o.trim())) || 'No';
      return { category: 'binary_toggle_safe_default', value: noOpt, confidence: 0.75 };
    }
    return { category: 'binary_toggle_safe_default', value: 'No', confidence: 0.70 };
  }

  // Step G: Unrecognized declaration / checkbox fallback
  if (key.includes('unrecognized declaration') || key.includes('open to the following roles') || widgetKind.toUpperCase() === 'CHECKBOX') {
    if (/\b(?:part[- ]time|casual|contract|temporary)\b/i.test(key)) {
      return { category: 'checkbox_negative', value: 'No', confidence: 0.9 };
    }
    if (/\b(?:tekion employee|internal job board|currently employed by|former (?:employee|associate)|worked (?:here|for us) before|previously worked|restrictions?|non[- ]compete)\b/i.test(key)) {
      return { category: 'checkbox_negative', value: 'No', confidence: 0.9 };
    }
    if (/\b(?:female|non[- ]binary|prefer not to say|decline to state)\b/i.test(key) && !/\bmale\b/i.test(key)) {
      return { category: 'checkbox_negative', value: 'No', confidence: 0.9 };
    }
    if (/\bmale\b/i.test(key) && !/\b(?:female)\b/i.test(key)) {
      return { category: 'checkbox_gender_male', value: 'Yes', confidence: 0.9 };
    }
    return { category: 'checkbox_consent_acknowledgement', value: 'Yes', confidence: 0.85 };
  }

  return null;
}

export function resolveOvernightLearnedQuestions(
  rawQuestion: string,
  widgetKind: string,
  options: string[] | null,
  profile: any
): string | null {
  // Strip Lever's heavy asterisk '✱' (\u2731) and standard asterisks
  const q = rawQuestion.replace(/[\u2731*]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  // Ticket GEN-89: Single-Option Dropdown / Radio Auto-Select (e.g. YipitData PDF Resume Acknowledgment)
  if (options && options.length > 0) {
    const cleanOptions = options.filter(o => o && o.trim() && !/^(?:select|choose|--|placeholder)/i.test(o.trim()));
    if (cleanOptions.length === 1) {
      return cleanOptions[0]!;
    }
  }

  // Ticket GEN-89: Social Profile Links (Facebook, Twitter/X, Instagram, Threads, TikTok)
  if (/\b(facebook|twitter|x\s*\(twitter\)|instagram|threads|tiktok)\b/i.test(q)) {
    return 'https://github.com/smresponsibilities';
  }

  // Ticket GEN-89: GitLab RBAC / Authorization Concepts
  if (/\b(authorization concepts|rbac|access control|authentication|oauth|mtls|iam|ciam|fine-grained permissions)\b/i.test(q)) {
    if (options && options.length > 0) {
      return options.find(o => /^(yes|true)$/i.test(o.trim())) || options.find(o => /yes/i.test(o)) || options[0]!;
    }
    return 'Yes, extensive hands-on experience implementing Role-Based Access Control (RBAC), OAuth2/OIDC, and fine-grained permissions across microservices and data pipelines.';
  }

  // Ticket GEN-89: Flextrade FIX Protocol & Domain Protocols
  if (/\b(fix protocol|financial information exchange)\b/i.test(q)) {
    if (options && options.length > 0) {
      return options.find(o => /^(no|false)$/i.test(o.trim())) || options.find(o => /no/i.test(o)) || 'No';
    }
    return 'No';
  }

  // Ticket GEN-89: ERP / Accounting Systems (YipitData)
  if (/\b(?:accounting|erp)\b/i.test(q)) {
    if (options && options.length > 0) {
      return options.find(o => /none|none of the above|n\/a|other|sql/i.test(o)) || options[options.length - 1]!;
    }
    return 'SQL, PostgreSQL';
  }

  // 1. Confirm / Verify Email (Bjak — 4 hits)
  if (/\b(confirm.*email|verify.*email|re-?enter.*email|email confirmation)\b/i.test(q)) {
    return profile?.personal?.email || profile?.basics?.email || '';
  }

  // 2. Design Portfolio / Website / Work Samples (Altimate.ai)
  if (/\b(design portfolio|portfolio|personal website|work sample|project link)\b/i.test(q)) {
    return 'https://shivammahajan.com/projects/';
  }

  // 3. US State Residence when residing in India (CrowdGen by Appen)
  if (/\b(i do not reside in the us|not reside in the us|which us state|residing in the us|us state are you currently)\b/i.test(q)) {
    if (widgetKind === 'BOOLEAN_TOGGLE' || (options && options.some(o => /^(yes|no)$/i.test(o)))) {
      return 'Yes';
    }
    if (options?.length) {
      const nonUs = options.find(o => /do not reside|not in the us|outside|not applicable|n\/a|none/i.test(o));
      if (nonUs) return nonUs;
    }
  }

  // 4. AI Tools Usage / Verification / Automation (Diagrid, Portcast)
  if (/\b(ai.*tools|ai.*assistant|chatgpt|claude|copilot|llm|automated or improved.*using ai)\b/i.test(q)) {
    if (widgetKind === 'BOOLEAN_TOGGLE' || (options && options.some(o => /^(yes|no)$/i.test(o)))) {
      return 'Yes';
    }
    if (/\b(?:which|what|list)\b/i.test(q)) {
      return 'Cursor, GitHub Copilot, Claude Code';
    }
    return (
      'I use GitHub Copilot, Claude, and Gemini AI daily to accelerate boilerplate generation, schema mapping, and unit-test scaffolding. ' +
      'To ensure 100% correctness, I validate all AI-assisted code through strict static typing, automated test suites (425+ test suites authored), ' +
      'peer code review, and deterministic data-integrity checks (such as zero row-count tolerance pipelines at Morgan Stanley).'
    );
  }

  // 5. Async / Remote Environment Experience (Supabase — 2 hits)
  if (/\b(async|asynchronous|remote environment|distributed team)\b/i.test(q)) {
    if (widgetKind === 'BOOLEAN_TOGGLE' || (options && options.some(o => /^(yes|no)$/i.test(o)))) {
      return 'Yes';
    }
    return (
      'At Morgan Stanley, I collaborated across distributed global engineering teams using written RFCs, detailed pull-request documentation, ' +
      'structured Jira workflows, and automated Jenkins CI/CD pipelines so code reviews and releases progressed seamlessly across time zones.'
    );
  }

  // 6. B.Tech / B.E. Specialization (Beghou Consulting)
  if (/\b(specialization in b\.?tech|specialization in b\.?e|branch of engineering|stream in graduation)\b/i.test(q)) {
    return 'Computer Science and Engineering (B.E., Chitkara University, 9.35 CGPA)';
  }

  // 7. Total / Full-Time Experience in TEXT or TEXTAREA (Dozee, Lingaro, GitLab)
  if (/\b(how many years of (?:full[- ]?time\s+|total\s+|overall\s+|work\s+|professional\s+)?experience|years of full[- ]?time experience|total years of experience|how many years of experience do you have in total|what is your full-time experience|total experience)\b/i.test(q)) {
    if (widgetKind === 'NUMBER' || widgetKind === 'TEXT') return '1';
    return '1 year (Technology Apprentice at Morgan Stanley, Aug 2025 – Aug 2026)';
  }

  // 8. Specific Tech Stack YOE in TEXTAREA / RADIO (Onit RoR, Beghou .NET/C#, AppZen ML/AI, Smart Working Solutions .NET MAUI)
  if (/\b(how many years.*experience|years of hands-on experience)\b/i.test(q)) {
    if (options && options.length > 0) {
      const lowBucket = options.find(o => /less than [123]|0\s*-\s*[12]|1\s*-\s*[23]|limited|practical/i.test(o));
      if (lowBucket) return lowBucket;
    }
    if (/\b(ml\/ai|machine learning|llm|python|java|sql|spark|kafka|react|typescript|node)\b/i.test(q)) {
      return '1 year of production experience at Morgan Stanley and deployed ML/LLM microservices (Gemini AI & XGBoost REST APIs).';
    }
    return '0 years direct commercial experience in that specific framework; 1 year of production backend & distributed systems experience in Java Spring Boot, Python, and TypeScript at Morgan Stanley.';
  }

  // 9. Salary in LPA Numeric Dropdown ["1","2",..."12",..."24"] (Smart Working Solutions)
  if (/\b(salary.*lpa|ctc.*lpa|compensation.*lpa|expected.*lpa|annual.*lpa|in lpa)\b/i.test(q) && options?.length) {
    const filtered = options.filter(o => !/^(?:select|choose|--)/i.test(o.trim()));
    const target = filtered.find(o => /\b(?:3|4|5|6|10|12)\b/.test(o)) || filtered[0];
    if (target) return target;
  }

  // 10. Currency / Salary Period / Gross vs Net / Referral Name (Lingaro)
  if (/\b(choose your currency)\b/i.test(q) && options?.length) {
    return options.find(o => /^inr$/i.test(o.trim())) || options.find(o => /^usd$/i.test(o.trim())) || options[0]!;
  }
  if (/\b(choose your salary period|salary period)\b/i.test(q) && options?.length) {
    return options.find(o => /annual|year/i.test(o)) || options.find(o => /month/i.test(o)) || options[0]!;
  }
  if (/\b(gross or net)\b/i.test(q) && options?.length) {
    return options.find(o => /gross/i.test(o)) || options[0]!;
  }
  if (/\b(did a consultant.*recommend|who referred you|name him or her)\b/i.test(q)) {
    return 'No / Direct Application via Careers Page';
  }

  // 11. Language Proficiency (English / Hindi — Smart Working Solutions, TSMG)
  if (/\b(level of.*english|english proficiency)\b/i.test(q) && options?.length) {
    return options.find(o => /fluent|native|advanced|c1|c2/i.test(o)) || options[0]!;
  }
  if (/\b(level of.*hindi|hindi language)\b/i.test(q) && options?.length) {
    return options.find(o => /native|c2|c1|advanced|fluent/i.test(o)) || options[options.length - 1]!;
  }

  // 12. SQL / Technical Self-Rating Checkboxes or Radios (Portcast)
  if (/\b(rate yourself in|proficiency in sql)\b/i.test(q) && options?.length) {
    return options.find(o => /advanced|strong|4|5|8|9|expert|intermediate/i.test(o)) || options[options.length - 1]!;
  }

  // 13. Affirmative Capability / Shift / Contract / Assessment / Relocation / Consent Questions
  // (Onit SaaS, Beghou Python, CLO Bangalore move, Mactores take-home, Keyloop 6-mo contract, Smart Working shift/negotiation/disqualification, GitLab RBAC, TSMG privacy)
  if (
    /\b(have you developed saas|are you aware of python|in bangalore now|willingness.*move to bangalore|take home assessment|fixed term contract|comfortable working.*shift|open to negotiation|acknowledge.*disqualify|hands-on experience with rbac|agree to the privacy policy|receive information about training|freelancer)\b/i.test(
      q
    )
  ) {
    if (options && options.length > 0) {
      return options.find(o => /^(yes|i agree|agree|true)$/i.test(o.trim())) || options.find(o => /yes|agree/i.test(o)) || options[0]!;
    }
    return 'Yes, I am based in Bengaluru, India and am comfortable with this requirement and available to start immediately.';
  }

  // 14. Post-employment restrictions / Non-compete (GitLab — 19 hits)
  if (/\b(post-employment restriction|subject to.*restriction|non-compete|restrictive covenant)\b/i.test(q)) {
    if (options && options.length > 0) {
      return options.find(o => /^no\b/i.test(o.trim())) || 'No';
    }
    return 'No';
  }

  return null;
}
