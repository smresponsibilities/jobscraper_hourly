import { canonicalRequisition, canonicalEmployerKey } from './identity.js';
import { resolveExtendedProfileValue } from './classifier.js';
import type { CandidateExtendedProfile, ExtendedFieldCategory, ScopedAnswer } from './types.js';
import { matchBestOption } from './aihawk.js';
import { composeGroundedNarrative, composePortfolioProjectNarrative } from './narrative-composer.js';
import { lookupQuestionIn1000Bank } from './portal-question-bank-1000.js';

export interface AnswerContext {
  url: string;
  country?: string;
  company?: string;
  question: string;
  aliases?: string[];
  fieldType?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  employerKey?: string;
  requisitionKey?: string;
  options?: string[];
  location?: string;
}

export interface ResolvedAnswer {
  value: string | number | boolean | undefined;
  confidence: number;
  reason: string;
  canonicalIntent: string;
  sourceFactKeys: string[];
  isEmployerSpecific: boolean;
  modelProvider?: string;
}

export const normalizeQuestion = (text: string): string => (text || '').replace(/[✱*]/g, '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim().replace(/\s+/g, ' ');

/** The owner authorized affirmative agreement and consent checkboxes. */
export function isAuthorizedConsentCheckbox(question: string, option = ''): boolean {
  const text = `${question} ${option}`.trim();
  if (!/\b(?:agree|agreement|consent|accept|acknowledge|authori[sz]e|permission|privacy (?:information )?notice|privacy policy|terms and conditions|terms of service)\b/i.test(text)) return false;
  if (/\b(?:do not|don't|disagree|decline|refuse|withdraw|opt out|not consent|not agree)\b/i.test(text)) return false;
  if (/\b(?:i am|i have|you are|you have)\b.*\b(?:years? of experience|citizen|citizenship|authorized to work|criminal|conviction|age|years? old|employed)\b/i.test(text)) return false;
  if (/^(?:no|false|decline|disagree)\b/i.test(option.trim())) return false;
  return true;
}

export function isRecruitmentPrivacyAcknowledgement(question: string): boolean {
  return /\bprivacy (?:information )?(?:notice|policy|statement)\b/i.test(question)
    && /\b(?:agree|accept|acknowledge|read|understood|consent)\b/i.test(question)
    && !/\b(?:do not|don't|disagree|decline|refuse)\b|marketing|promotional|talent (?:pool|community)|sms|whatsapp|recording|background check|arbitration/i.test(question);
}

export const CATEGORY_FACTS: Partial<Record<ExtendedFieldCategory, string[]>> = {
  first_name: ['personal.firstName'], last_name: ['personal.lastName'], full_name: ['personal.firstName', 'personal.lastName'], preferred_name: ['personal.preferredName', 'personal.firstName'], email: ['personal.email'], phone: ['personal.phone'], phone_country_code: ['personal.phoneCountryCode'],
  address: ['personal.address'], address_line_2: ['personal.addressLine2'], city: ['personal.city'], state: ['personal.state'], postal_code: ['personal.postalCode'], country: ['personal.country'],
  linkedin: ['personal.linkedinUrl'], github: ['personal.githubUrl'], website: ['personal.portfolioUrl', 'personal.githubUrl', 'personal.linkedinUrl'], school: ['education.0.school'], degree: ['education.0.degree'], discipline: ['education.0.fieldOfStudy'], gpa: ['education.0.gpa'], graduation_year: ['education.0.graduationYear'], start_year: ['education.0.startYear'],
  current_company: ['professional.currentCompany', 'experience.0.company'], current_title: ['professional.currentTitle', 'experience.0.title'], total_experience: ['professional.totalYearsExperience'], current_salary: ['professional.currentSalary'], expected_salary: ['professional.expectedSalary'], salary_currency: ['professional.salaryCurrency'], notice_period: ['professional.noticePeriodDays'], relocate: ['professional.willingToRelocate'], work_preference: ['professional.workPreference'],
  non_compete: ['workAuthorization.hasNonCompete'], security_clearance: ['workAuthorization.hasSecurityClearance'], felony_conviction: ['workAuthorization.felonyConviction'], gender: ['eeo.gender'], race: ['eeo.raceOrEthnicity'], hispanic_latino: ['eeo.isHispanicLatino'], veteran: ['eeo.veteranStatus'], disability: ['eeo.disabilityStatus'],
  hear_about_us: ['referralSources'],
};

export function employerKey(url: string): string {
  return canonicalEmployerKey(url);
}

export function resolveExtendedPortalQuestionTaxonomy(
  questionText: string,
  widgetKind = 'text'
): string | undefined {
  const q = String(questionText || '').trim();
  if (!q) return undefined;

  const ql = q.toLowerCase();

  // Ticket GEN-229: Section-Scoped Education vs Work Experience Dates
  if (/\(education\)/i.test(ql)) {
    if (/\b(?:start|from|begin)\b/i.test(ql)) {
      return /year/i.test(ql) ? '2022' : /month/i.test(ql) ? '08' : widgetKind === 'date' ? '2022-08-01' : '08/2022';
    }
    if (/\b(?:end|to|graduation|completion)\b/i.test(ql)) {
      return /year/i.test(ql) ? '2026' : /month/i.test(ql) ? '08' : widgetKind === 'date' ? '2026-08-01' : '08/2026';
    }
  }
  if (/\(work\s+experience\)/i.test(ql)) {
    if (/\b(?:start|from|begin)\b/i.test(ql)) {
      return /year/i.test(ql) ? '2025' : /month/i.test(ql) ? '08' : widgetKind === 'date' ? '2025-08-01' : '08/2025';
    }
    if (/\b(?:end|to|completion)\b/i.test(ql)) {
      return /year/i.test(ql) ? '2026' : /month/i.test(ql) ? '08' : widgetKind === 'date' ? '2026-08-01' : '08/2026';
    }
  }

  // Ticket GEN-323: Composite Phone Splitter (Phone Country Code vs Mobile Phone Number)
  if (/\b(?:phone\s+country\s+code|country\s+phone\s+code|dialing\s+code|calling\s+code|phone\s+code|dial\s+code)\b/i.test(ql)) {
    return '+91';
  }
  if (/\b(?:mobile\s+phone\s+number|national\s+phone\s+number)\b/i.test(ql)) {
    const raw = process.env.AUTOAPPLY_PHONE || '9876543210';
    return raw.replace(/^\+91/, '').replace(/\D/g, '').slice(-10);
  }

  // Ticket GEN-324: Salary Currency / Compensation Currency (INR)
  if (/\b(?:salary\s+currency|compensation\s+currency|^currency\*?$)\b/i.test(ql)) {
    return 'INR';
  }

  // Ticket GEN-325: Split Date Component Fallbacks (Day, Month, Year)
  if (/^(?:day|\w+\s+day)\*?$/i.test(ql)) {
    return '01';
  }
  if (/^(?:month|\w+\s+month)\*?$/i.test(ql)) {
    if (/\b(?:start|begin|joining)\b/i.test(ql)) return '08';
    return '08';
  }
  if (/^(?:year|\w+\s+year)\*?$/i.test(ql)) {
    if (/\b(?:start|begin|joining)\b/i.test(ql)) return '2025';
    return '2026';
  }

  // Ticket GEN-212: 1,050+ Question Portal Ontology Engine
  const bankHit = lookupQuestionIn1000Bank(q, widgetKind);
  if (bankHit !== undefined) {
    return bankHit;
  }

  // 1. Export Control / Sanctioned Countries / Debarment (Must be "No"!)
  if (
    /\b(?:cuba|iran|north\s+korea|syria|crimea|sanctioned\s+countr|debarred|suspended\s+by\s+any\s+government|export\s+control\s+restriction|itar\s+restriction)\b/i.test(
      ql
    )
  ) {
    return 'No';
  }

  // 2. ML Research Papers / Publications / Technical Architecture Deep-Dive (Graviton!)
  if (
    /\b(?:research\s+papers?|publications?|papers?\s+you\s+have\s+(?:read|implemented)|machine\s+learning\s+models?\s+you|complex\s+technical\s+problem|challenging\s+engineering\s+problem|system\s+you\s+(?:built|architected))\b/i.test(
      ql
    )
  ) {
    return 'At Morgan Stanley, I engineered distributed CIAM data warehouse pipelines using Apache Kafka, PySpark, Apache Spark, Hive, and Azure Snowflake processing 5,000,000+ events with zero row-count tolerance. In applied ML and systems research, I built a production XGBoost/Scikit-Learn Fertilizer Recommendation ML microservice modeling NPK soil chemistry and climate features, Chaincode (an AI-assisted code originality validation engine with 15+ REST APIs achieving 95%+ accuracy, placing 3rd out of 200+ teams at HackIndia), and QuizDeck (500 concurrent WebSocket users at 31ms average latency), drawing heavily on gradient-boosted decision tree literature (Chen & Guestrin, XGBoost) and distributed log-compaction architectures.';
  }

  // 3. Compensation Range Alignment / Expectations Agreement (Particle41!)
  if (
    (/\b(?:compensation|salary|budgeted?)\b/i.test(ql) && /\b(?:range|package|aligns?|comfortable|align)\b/i.test(ql)) ||
    /\b(?:compensation\s+range|salary\s+range|budgeted\s+compensation|aligns?\s+with\s+your\s+(?:salary|compensation)|comfortable\s+with\s+the\s+(?:salary|compensation))\b/i.test(
      ql
    )
  ) {
    if (widgetKind === 'radio' || widgetKind === 'checkbox' || widgetKind === 'select') {
      return 'Yes';
    }
    return 'Yes, 12 LPA (Negotiable)';
  }

  // Ticket GEN-264: Experience in Months (12 months = 1 year at Morgan Stanley)
  if (
    /\b(?:experience|internship|apprenticeship)\b.*\bin\s+months\b|\bhow\s+many\s+months\s+of\s+(?:experience|internship|work)/i.test(
      ql
    )
  ) {
    return '12';
  }

  // Regional location confirmation (APAC / India)
  if (/\b(?:located\s+in|reside\s+in|based\s+in|living\s+in)\b.*\b(?:apac|asia|india|bengaluru|bangalore)\b/i.test(ql) || /\b(?:confirm\s+if\s+you\s+are\s+located\s+in\s+the\s+apac\s+region)\b/i.test(ql)) {
    return 'Yes';
  }

  // Ticket GEN-264: Monthly Stipend / Monthly Salary (80000 INR/month vs 1200000 annual)
  if (/\b(?:monthly\s+(?:salary|ctc|stipend|compensation)|stipend\s+per\s+month|expected\s+stipend)\b/i.test(ql)) {
    return '80000';
  }

  // 4. Current CTC vs Expected CTC
  if (/\b(?:current|present)\s+(?:total\s+|gross\s+|fixed\s+)?(?:ctc|annual\s+compensation|base\s+salary|salary|compensation)\b/i.test(ql)) {
    return /\bin\s+(?:lpa|lakhs?)\b/i.test(ql) ? '10' : '1000000';
  }
  if (/\b(?:expected|desired|target)\s+(?:total\s+|gross\s+|fixed\s+)?(?:ctc|annual\s+compensation|base\s+salary|salary|compensation)\b/i.test(ql)) {
    return /\bin\s+(?:lpa|lakhs?)\b/i.test(ql) ? '12' : '1200000';
  }

  // 5. Academic Grading Scale Variants (Backlogs, Percentage, 4.0 GPA, 10.0 CGPA, Division)
  if (/\b(?:backlogs?|arrears?|active\s+backlogs?)\b/i.test(ql)) {
    return widgetKind === 'radio' || widgetKind === 'select' ? 'No' : '0';
  }
  if (/\b(?:percentage|marks?\s+in\s*%|10th|12th|hsc|ssc)\b/i.test(ql) && !/salary|hike/i.test(ql)) {
    return '93.5';
  }
  if (/\b(?:4\.0\s+scale|out\s+of\s+4(?:\.0)?)\b/i.test(ql)) {
    return '3.9';
  }
  if (/\b(?:cgpa|gpa|grade\s+point|cumulative\s+grade)\b/i.test(ql)) {
    return '9.35';
  }
  if (/\b(?:division|class\s+obtained)\b/i.test(ql) && /degree|education|university|academic/i.test(ql)) {
    return 'First Class with Distinction';
  }

  // 6. Graduation Year / Passing Year / Batch
  if (/\b(?:years?\s+of\s+(?:graduation|passing)|graduation\s+years?|passing\s+years?|batch\s+years?)\b/i.test(ql)) {
    return '2026';
  }

  // 7. Competitive Programming / Coding Profiles (LeetCode, Codeforces, HackerRank, Kaggle)
  if (/\b(?:leetcode|codeforces|codechef|hackerrank|kaggle|coding\s+profiles?|competitive\s+programming)\b/i.test(ql)) {
    return 'https://github.com/smresponsibilities';
  }

  // 8. Timezone & Overlap Hours
  if (/\b(?:time\s*zones?|timezones?)\b/i.test(ql)) {
    if (/overlap|comfortable|willing|able\s+to\s+work/i.test(ql)) return 'Yes';
    return 'IST (UTC+5:30)';
  }

  // 9. Notice Period / Buyout / LWD
  if (/\b(?:currently\s+serving\s+notice|on\s+notice\s+period)\b/i.test(ql)) {
    return 'Yes';
  }
  if (/\b(?:notice\s+period\s+negotiable|buyout\s+option|join\s+within\s+\d+\s+days|can\s+you\s+start\s+immediately)\b/i.test(ql)) {
    return 'Yes';
  }
  if (/\b(?:notice\s+period(?:\s+in\s+days)?|official\s+notice\s+period)\b/i.test(ql)) {
    return '0';
  }

  // 10. Pronouns & Prefix/Title
  if (/\bpronouns?\b/i.test(ql)) {
    return 'He/Him';
  }
  if (/\b(?:title|prefix|salutations?)\b/i.test(ql) && !/\b(?:job\s+title|work\s+title|current\s+title|title\s+of)\b/i.test(ql)) {
    return 'Mr.';
  }

  return undefined;
}

export function scopeMatches(answer: ScopedAnswer, context: AnswerContext): boolean {
  if (answer.scope === 'GLOBAL_FACT') return true;
  if (answer.scope === 'JURISDICTION_SCOPED') return !!context.country && normalizeQuestion(answer.country!) === normalizeQuestion(context.country);
  const requisition = context.requisitionKey || (context.url ? canonicalRequisition(context.url)?.key : undefined) || context.url;
  return (!answer.employerKey || answer.employerKey === (context.employerKey || (context.url ? employerKey(context.url) : undefined))) && (!answer.requisitionKey || answer.requisitionKey === requisition);
}

export function hasScopedAnswerMismatch(profile: CandidateExtendedProfile, context: AnswerContext, labels: string[]): boolean {
  return (profile.answers || []).some(a =>
    (a.scope === 'EMPLOYER_SCOPED' || a.scope === 'JURISDICTION_SCOPED') &&
    !scopeMatches(a, context) &&
    labels.includes(normalizeQuestion(a.question))
  );
}

/** Resolve polarity, units and scope before applying a field-category fallback. */
export function resolveCandidateAnswer(category: ExtendedFieldCategory, profile: CandidateExtendedProfile, context: AnswerContext): ResolvedAnswer {
  const q = normalizeQuestion(context.question);
  const labels = [context.question, ...(context.aliases || [])].map(normalizeQuestion).filter(Boolean);
  const result = (value: ResolvedAnswer['value'], reason: string, sourceFactKeys: string[] = [], canonicalIntent = category as string, isEmployerSpecific = false): ResolvedAnswer => ({ value, confidence: value === undefined ? 0 : 0.99, reason, sourceFactKeys, canonicalIntent, isEmployerSpecific });
  if (profile.applicationPreferences?.skipOptionalQuestions?.some(question => labels.includes(normalizeQuestion(question)))) return result(undefined, 'owner_requested_blank');
  const matches = (profile.answers || []).map((answer, index) => ({ answer, index })).filter(({ answer }) => scopeMatches(answer, context) && labels.some(l => l === normalizeQuestion(answer.question) || (answer.question.length > 50 && (l.startsWith(normalizeQuestion(answer.question)) || normalizeQuestion(answer.question).startsWith(l)))));
  const specificity = (answer: ScopedAnswer) => ({ GLOBAL_FACT: 0, JURISDICTION_SCOPED: 1, EMPLOYER_SCOPED: 2 }[answer.scope] * 2 + Number(!!answer.requisitionKey));
  const ranked = matches.sort((a, b) => specificity(b.answer) - specificity(a.answer));
  if (ranked.length) {
    const best = ranked[0]!;
    if (ranked.some(entry => specificity(entry.answer) === specificity(best.answer) && entry.answer.value !== best.answer.value)) return result(undefined, 'conflicting_saved_answers');
    return result(best.answer.value, 'qa_bank_match', [`answers.${best.index}.value`], category, best.answer.scope === 'EMPLOYER_SCOPED');
  }
  const hasScopedMismatch = category !== 'hear_about_us' && hasScopedAnswerMismatch(profile, context, labels);
  // If an employer-scoped answer exists for another employer, we only block if the question requires employer-specific knowledge (e.g. former_employee)
  if (hasScopedMismatch && category === 'former_employee') {
    return result(undefined, 'scope_mismatch');
  }
  if (/\bexperience with snowflake\b/.test(q) && Number(profile.skillYears?.Snowflake) > 0) {
    const experienceIndex = (profile.experience || []).findIndex(entry => /\bsnowflake\b/i.test(JSON.stringify(entry)));
    const option = context.options?.find(value => /^professional-level experience$/i.test(value.trim()));
    if (experienceIndex >= 0 && option) return result(option, 'confirmed_professional_experience', ['skillYears.Snowflake', `experience.${experienceIndex}`], 'snowflake_experience');
  }
  const prefs = profile.applicationPreferences;
  if (prefs) {
    if (/\b(?:do not|not willing|not able|not speak|not travel|never|unable|unwilling|decline|reject|refuse)\b/.test(q) && /\b(?:language|speak|french|english|hindi|travel|shift|relocat\w*|experience|selenium|citizenship)\b/.test(q)) return result(undefined, 'negated_preference_requires_review');
    const optionFor = (patterns: RegExp[]): string | undefined => {
      for (const pattern of patterns) {
        const found = context.options?.find(option => pattern.test(option.trim()));
        if (found) return found;
      }
      return undefined;
    };
    if (/\baccounting\s+erp\s+systems\b/.test(q) && prefs.noExperienceWith?.some(value => /\baccounting\s*\/\s*erp\s+software\b/i.test(value))) {
      const selected = optionFor([/^(?:none|none of the above|no experience|not applicable|n\/?a)$/i]);
      return result(context.options?.length ? selected : context.fieldType === 'checkbox' ? undefined : 'None', 'confirmed_preference', ['applicationPreferences.noExperienceWith'], 'accounting_system_experience');
    }
    const excludedSkill = prefs.noExperienceWith?.find(value => {
      const normalized = normalizeQuestion(value);
      return normalized.length >= 3 && ` ${q} `.includes(` ${normalized} `);
    });
    if (excludedSkill && /\b(?:experience|years?|used|using|worked|proficien\w*)\b/.test(q)) {
      const selected = optionFor([/^(?:0|none|none of the above|no|no experience|less than 1 year)$/i]);
      if (context.options?.length) return result(selected, 'confirmed_preference', ['applicationPreferences.noExperienceWith'], 'excluded_skill_experience');
      if (context.fieldType === 'number' || /\b(?:how many|years?)\b/.test(q)) return result(0, 'confirmed_preference', ['applicationPreferences.noExperienceWith'], 'excluded_skill_experience');
      if (/^(?:do|have|did)\b/.test(q)) return result(false, 'confirmed_preference', ['applicationPreferences.noExperienceWith'], 'excluded_skill_experience');
      return result(undefined, 'excluded_skill_requires_review');
    }
    if (/\b(?:citizenship|nationality)\b/.test(q) && prefs.citizenship) return result(prefs.citizenship, 'confirmed_preference', ['applicationPreferences.citizenship'], 'citizenship');
    const language = Object.keys(prefs.languageProficiency || {}).find(name => {
      const aliases: Record<string, RegExp> = { french: /\bfrançais\b/i, english: /\banglais\b/i };
      return new RegExp(`\\b${name.toLowerCase()}\\b`).test(q) || !!aliases[name.toLowerCase()]?.test(q);
    });
    if (language && /\b(?:speak|spoken|language|proficien\w*|fluen\w*|native|knowledge|maîtrise)\b/.test(q)) {
      const level = prefs.languageProficiency![language]!;
      if (/\b(?:proficien\w*|fluen\w*|level|native|maîtrise)\b/.test(q)) {
        const selected = optionFor(level === 'native' ? [/^(?:native|native speaker|native\s*\/\s*bilingual|native or bilingual)(?:\s+proficiency)?$/i, /^natif\s*[–—-]/i] : [/^(?:none|no proficiency|no knowledge|no experience)$/i, /^aucune connaissance\s*[–—-]/i]);
        return result(context.options?.length ? selected : level, 'confirmed_preference', [`applicationPreferences.languageProficiency.${language}`], 'language_proficiency');
      }
      return result(level !== 'none', 'confirmed_preference', [`applicationPreferences.languageProficiency.${language}`], 'language');
    }
    if (/\b(?:languages? (?:do you |can you )?(?:speak|know)|spoken languages?)\b/.test(q) && prefs.spokenLanguages?.length && !context.options?.length) return result(prefs.spokenLanguages.join(', '), 'confirmed_preference', ['applicationPreferences.spokenLanguages'], 'spoken_languages');
    const foreign = /\b(?:outside india|international(?:ly)?|united states|usa|u s|united kingdom|uk|london|canada|toronto|germany|berlin|australia|sydney|singapore)\b/.test(q);
    const india = /\b(?:india|indian|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|delhi|noida|gurgaon|gurugram)\b/.test(q);
    if (/\b(?:travel|travelling|traveling)\b/.test(q) && prefs.businessTravel !== undefined) {
      if (foreign && prefs.travelCountries?.length === 1 && prefs.travelCountries[0]!.toLowerCase() === 'india') return result(false, 'confirmed_preference', ['applicationPreferences.travelCountries'], 'travel');
      if (india) return result(prefs.businessTravel, 'confirmed_preference', ['applicationPreferences.businessTravel', 'applicationPreferences.travelCountries'], 'travel');
      if (!context.options?.length && context.fieldType !== 'checkbox') return result('Available for business travel within India', 'confirmed_preference', ['applicationPreferences.businessTravel', 'applicationPreferences.travelCountries'], 'travel');
      return result(undefined, 'travel_destination_not_confirmed');
    }
    if (/\b(?:night|overnight)\b.*\bshift|\bshift\w*\b.*\b(?:night|overnight)\b/.test(q) && prefs.nightShifts !== undefined) return result(prefs.nightShifts, 'confirmed_preference', ['applicationPreferences.nightShifts'], 'night_shifts');
    if (/\bweekend\w*\b/.test(q) && /\b(?:work|shift|available|availability)\b/.test(q) && prefs.weekendWork !== undefined) return result(prefs.weekendWork, 'confirmed_preference', ['applicationPreferences.weekendWork'], 'weekend_work');
    if (/\b(?:relocat\w*|move to)\b/.test(q) && prefs.relocationCountries?.length === 1 && prefs.relocationCountries[0]!.toLowerCase() === 'india') {
      if (foreign) return result(false, 'confirmed_preference', ['applicationPreferences.relocationCountries'], 'relocate');
      if (/\b(?:support|assistance|package)\b/i.test(q)) return result(false, 'confirmed_preference', ['professional.willingToRelocate'], 'relocation_support');
      const destination = normalizeQuestion(context.location || '');
      if (india || (/\b(?:india|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|delhi|noida|gurgaon|gurugram)\b/.test(destination) && !/\b(?:united states|usa|london|canada|germany|australia|singapore)\b/.test(destination))) return result(true, 'confirmed_preference', ['applicationPreferences.relocationCountries'], 'relocate');
      // If no foreign or conflicting location is specified, candidate is willing to relocate within India
      const opt = optionFor([/^(?:yes|true|willing)\b/i]);
      return result(context.options?.length ? opt : true, 'confirmed_preference', ['professional.willingToRelocate', 'applicationPreferences.relocationCountries'], 'relocate');
    }
    if (/\b(?:unpaid|without pay|no pay)\b/.test(q) && !/\b(?:not|decline|reject|refuse)\b/.test(q) && prefs.paidRolesOnly === true && /\b(?:role|work|internship|position)\b/.test(q)) return result(false, 'confirmed_preference', ['applicationPreferences.paidRolesOnly'], 'employment_type');
    if (/\bpaid\b/.test(q) && !/\b(?:not|unpaid|decline|reject|refuse)\b/.test(q) && /\b(?:open|accept|willing|available|interest)\w*\b/.test(q)) {
      const kinds = [['full time', 'full-time'], ['permanent', 'permanent'], ['internship', 'internship'], ['apprenticeship', 'apprenticeship'], ['contract', 'contract']] as const;
      const mentioned = kinds.filter(([phrase]) => q.includes(phrase));
      if (mentioned.length && prefs.employmentTypes) return result(mentioned.every(([, kind]) => prefs.employmentTypes!.includes(kind)), 'confirmed_preference', ['applicationPreferences.employmentTypes', 'applicationPreferences.paidRolesOnly'], 'employment_type');
    }
    if (/\b(?:stipend|internship|apprenticeship)\b/.test(q) && /\b(?:salary|compensation|pay|stipend|ctc)\b/.test(q)) return result(undefined, 'stipend_not_provided');
    if (/\b(?:expected|desired|target)\b/.test(q) && /\b(?:salary|compensation|ctc)\b/.test(q) && prefs.annualSalaryRangeINR && !context.options?.length && context.fieldType !== 'number' && !/\b(?:hour|hourly|month|monthly|usd|eur|gbp)\b/.test(q)) {
      const range = prefs.annualSalaryRangeINR;
      return result(`${range.minimum / 100000}–${range.maximum / 100000} LPA annually (INR)`, 'confirmed_preference', ['applicationPreferences.annualSalaryRangeINR'], 'expected_salary');
    }
  }
  const policy = resolveByOptionPolicy(context.question, context.options || [], profile, context.location);
  if (policy) return policy;

  // Consent & age profile integrity guards: do not invent age confirmation or background-check consent if unprovided
  if (profile.adult === undefined && /\b(?:at least|over|aged?|older than)\s+(?:18|eighteen)\b|\b(?:18|eighteen)\s+years?\s+(?:of age|old|or older)\b|\bage of majority\b/i.test(q) && !/\b(?:under|not|less than|younger than)\b/i.test(q)) {
    return result(undefined, 'unprovided_age_confirmation');
  }
  if ((profile.declarations?.backgroundCheckConsent === undefined && (profile.workAuthorization as any)?.backgroundCheckConsent === undefined) && /\b(?:background\s+check|background\s+verification|bgv)\b/i.test(q)) {
    return result(undefined, 'unprovided_background_check_consent');
  }

  if (profile.recruitmentPrivacyConsent !== undefined && isRecruitmentPrivacyAcknowledgement(context.question)) return result(profile.recruitmentPrivacyConsent, 'explicit_recruitment_privacy_authorization', ['recruitmentPrivacyConsent']);
  if (profile.adult !== undefined && /\b(?:at least|over|aged?|older than)\s+(?:18|eighteen)\b|\b(?:18|eighteen)\s+years?\s+(?:of age|old|or older)\b|\bage of majority\b/.test(q) && !/\b(?:under|not|less than|younger than)\b/.test(q)) return result(profile.adult, 'explicit_profile', ['adult'], 'adult');
  if (/\b(?:confirm|verify|re enter|reenter)\s+(?:your\s+)?e\s*mail\b/i.test(q)) return result(profile.personal.email, 'explicit_profile', ['personal.email'], 'email');
  if ((category === 'full_name' || /^(?:full\s*name|name)$/i.test(q)) && profile.personal.firstName && profile.personal.lastName) return result(`${profile.personal.firstName} ${profile.personal.lastName}`, 'explicit_profile', ['personal.firstName', 'personal.lastName'], 'full_name');
  if (/\b(?:salutation|honorific|name prefix)\b/.test(q) && profile.personal.prefix) return result(profile.personal.prefix, 'explicit_profile', ['personal.prefix'], 'prefix');
  if (/\b(?:phone|telephone) (?:device )?type\b/.test(q) && profile.personal.phoneDeviceType) return result(profile.personal.phoneDeviceType, 'explicit_profile', ['personal.phoneDeviceType'], 'phone_device_type');
  const declarations = profile.declarations;
  if (declarations && !/\b(?:not|never|no|decline|disagree|refuse|withdraw|marketing|arbitration|recording)\b/.test(q)) {
    let key: keyof NonNullable<CandidateExtendedProfile['declarations']> | undefined;
    if (/\b(?:talent pool|talent community|candidate community)\b/.test(q) && /\b(?:agree|consent|join|contact)\b/.test(q)) key = 'talentPoolConsent';
    else if (/\bbackground (?:check|screening|verification)\b/.test(q) && /\b(?:agree|consent|authorize|authorise)\b/.test(q)) key = 'backgroundCheckConsent';
    else if (/\b(?:terms and conditions|terms of use|terms of service)\b/.test(q) && /\b(?:agree|accept)\b/.test(q) && !/\b(?:background|criminal|employment|waiv\w*)\b/.test(q)) key = 'termsAndAccuracyConsent';
    else if (/\b(?:certify|attest|confirm)\b/.test(q) && /\b(?:true|accurate|accuracy|truthful)\b/.test(q) && !/\b(?:background|arbitration|marketing|criminal|employment|consent)\b/.test(q)) key = 'termsAndAccuracyConsent';
    else if (/\b(?:relatives|family members)\b/.test(q) && /\b(?:work|employed)\b/.test(q) && /\b(?:company|organization|organisation|here)\b/.test(q)) key = 'relativesAtCompany';
    else if (/\b(?:are you|currently|yourself)\b/.test(q) && /\bgovernment official\b/.test(q)) key = 'governmentOfficial';
    else if (/\b(?:are you|currently|yourself)\b/.test(q) && /\b(?:big 4|big four)\b/.test(q) && /\bauditor\b/.test(q)) key = 'big4Auditor';
    if (key && declarations[key] !== undefined) return result(declarations[key], 'explicit_profile', [`declarations.${key}`], key);
  }
  for (const [key, answer] of Object.entries(profile.qaBank || {})) {
    if (/^(?:phone device type|permanent address(?: government address)?|linkedin(?: profile)?|github(?: profile)?|years of .+ experience)$/i.test(normalizeQuestion(key)) && labels.includes(normalizeQuestion(key))) return result(answer, 'qa_bank_match', [`qaBank.${key}`]);
  }
  const explicitCountry = /\b(?:united states|usa|u s a|u s)\b/.test(q) ? 'United States' : /\b(?:united kingdom|uk|u k)\b/.test(q) ? 'United Kingdom' : /\bindia\b/.test(q) ? 'India' : undefined;
  const country = explicitCountry || context.country;
  const mentionsIndia = /\bindia\b/.test(q) || (country && normalizeQuestion(country) === 'india');
  const home = country && normalizeQuestion(country) === normalizeQuestion(profile.personal.country);
  const scoped = country ? Object.entries(profile.workAuthorizationByCountry || {}).find(([key]) => normalizeQuestion(key) === normalizeQuestion(country))?.[1] : undefined;
  const outsideIndia = /\b(?:outside|other than) india\b/.test(q) || (!!explicitCountry && explicitCountry !== 'India') || (!!country && country !== 'India') || (!mentionsIndia && Boolean(profile.indiaOnlyWorkAuthorization));
  const indiaOnly = profile.indiaOnlyWorkAuthorization && outsideIndia ? { authorizedInCountry: false, requiresSponsorshipNowOrFuture: true } : undefined;
  const useScoped = !!scoped && !/\b(?:outside|other than) india\b/.test(q);
  const authorization = useScoped ? scoped : (indiaOnly || (home && !outsideIndia ? profile.workAuthorization : undefined));
  const authSource = useScoped ? `workAuthorizationByCountry.${country}` : indiaOnly ? 'indiaOnlyWorkAuthorization' : 'workAuthorization';
  const authFact = (key: string) => !useScoped && indiaOnly ? authSource : `${authSource}.${key}`;
  if (/\b(?:authorized|eligible|right) to work\b|\bwork authorization\b|\bsponsor(?:ship)?\b/.test(q) || ['work_authorization', 'sponsorship'].includes(category)) {
    if (!authorization) return result(undefined, 'jurisdiction_not_confirmed');
    const without = /\bwithout (?:visa )?sponsorship\b|\bnot (?:require|need) (?:visa )?sponsorship\b/.test(q);
    if (without) {
      if (authorization.authorizedInCountry === undefined || authorization.requiresSponsorshipNowOrFuture === undefined) return result(undefined, 'underlying_fact_missing');
      return result(authorization.authorizedInCountry && !authorization.requiresSponsorshipNowOrFuture, 'explicit_profile', [authFact('authorizedInCountry'), authFact('requiresSponsorshipNowOrFuture')], 'work_without_sponsorship');
    }
    if (category === 'work_authorization' || /\b(?:authorized|eligible|right) to work\b/.test(q)) return result(authorization.authorizedInCountry, 'explicit_profile', [authFact('authorizedInCountry')], 'work_authorization');
    return result(authorization.requiresSponsorshipNowOrFuture, 'explicit_profile', [authFact('requiresSponsorshipNowOrFuture')], 'sponsorship');
  }
  if (category === 'former_employee' || /\b(?:worked\s*for|employed\s*(?:at|by|with)|consulted\s*for|employee\s*of)\b/i.test(q)) {
    if (!profile.completeEmploymentHistory || !context.company || profile.experience.length !== 1 || /\b(?:not|never|neither|no prior|affiliate|affiliates|subsidiary|subsidiaries|parent|client|group)\b/.test(q)) return result(undefined, 'employer_scoped_answer_required');
    const company = normalizeQuestion(context.company);
    const employer = normalizeQuestion(profile.experience[0]!.company);
    if (!company || !employer) return result(undefined, 'employer_scoped_answer_required');
    if (!/\b(?:this|our|here|with us)\b/.test(q) && !` ${q} `.includes(` ${company} `)) return result(undefined, 'employer_scoped_answer_required');
    return result(` ${company} `.includes(` ${employer} `), 'explicit_employment_history', ['experience.0.company'], 'former_employee', true);
  }

  // Current or previous employer / title queries
  if (category === 'current_company' || /\b(?:current|most\s*recent|previous)\s*(?:employer|company)\b/i.test(q) || /\b(?:where\s+have\s+you\s+(?:most\s+recently\s+)?worked|most\s*recently\s*worked)\b/i.test(q)) {
    const comp = profile.professional?.currentCompany || profile.experience?.[0]?.company;
    if (comp) return result(comp, 'explicit_employment_history', ['professional.currentCompany', 'experience.0.company'], 'previous_company');
  }
  if (/\b(?:current|most\s*recent|previous)\s*(?:job\s*title|title|position)\b/i.test(q)) {
    if (profile.experience?.length) return result(profile.experience[0]!.title, 'explicit_employment_history', ['experience.0.title'], 'previous_title');
  }

  const employmentQuestion = /^(?:who|what) is your current or previous (employer|company|job title|title)$/.exec(q);
  if (employmentQuestion) {
    if (!profile.completeEmploymentHistory || profile.experience.length !== 1) return result(undefined, 'employment_history_not_unambiguous');
    const key = /title/.test(employmentQuestion[1]!) ? 'title' : 'company';
    return result(profile.experience[0]![key], 'explicit_employment_history', [`experience.0.${key}`], `previous_${key}`);
  }
  // Skill experience / Years of experience / Unlisted skill handling
  if (/\b(?:experi[en]+ce|years?|used|using|hands\s*on|proficien\w*|worked\s*with)\b/i.test(q)) {
    // 1. Overall / Total years of experience
    if (/\b(?:total|overall|full\s*time|fulltime|industry|professional)\s*(?:work\s*)?experience\b/i.test(q) && !/\b(?:ruby|node|python|snowflake|ai|ml|k8s|kubernetes|aws|java)\b/i.test(q)) {
      if (profile.professional?.totalYearsExperience === undefined) return result(undefined, 'total_experience_not_provided');
      if (/\bin\s*months\b/i.test(q)) return result(12, 'explicit_profile', ['professional.totalYearsExperience'], 'total_experience_months');
      if (context.options?.length) {
        const opt = context.options.find(o => /\b(?:1|1\s*[-–to]+\s*[23]|0\s*[-–to]+\s*[12]|entry|junior|< ?2)\b/i.test(o));
        if (opt) return result(opt, 'explicit_profile', ['professional.totalYearsExperience'], 'total_experience');
      }
      return result(profile.professional.totalYearsExperience, 'explicit_profile', ['professional.totalYearsExperience'], 'total_experience');
    }

    // 2. Verified skills check
    const skills = Object.entries(profile.skillYears || {}).filter(([skill]) => ` ${q} `.includes(` ${normalizeQuestion(skill)} `));
    if (skills.length === 1) {
      if (context.options?.length) {
        const val = skills[0]![1];
        const opt = context.options.find(o => new RegExp(`\\b${val}\\b`).test(o) || /practical|intermediate/i.test(o));
        if (opt) return result(opt, 'explicit_profile', [`skillYears.${skills[0]![0]}`], 'skill_experience');
      }
      return result(skills[0]![1], 'explicit_profile', [`skillYears.${skills[0]![0]}`], 'skill_experience');
    }

    // 3. Unlisted skills default: truthful 0 / No / Less than 1 year (or adjacent-stack narrative for TEXTAREA)
    const isKnownTech = /\b(?:python|sql|spark|kafka|typescript|node\.?js|node|fastapi|docker|git|aws|linux)\b/i.test(q);
    if (!isKnownTech && (profile.unlistedSkillYears !== undefined || profile.professional?.totalYearsExperience !== undefined)) {
      if (context.fieldType === 'textarea' || (category as string) === 'cover_letter') {
        const project = composePortfolioProjectNarrative(context.question, profile);
        if (project) return result(project.text, 'verified_project_catalog', [project.factKey]);
        const narrative = composeGroundedNarrative(context.question, profile, context.company);
        if (narrative) return result(narrative, 'certified_experience_excerpt', ['experience']);
      }
      if (context.options?.length) {
        const zeroOpt = context.options.find(opt => /^(?:0\b|0\s*-\s*1\b|none|no\b|no experience|limited|less than 1|< ?1\b|never)/i.test(opt.trim()));
        if (zeroOpt) return result(zeroOpt, 'explicit_profile', ['unlistedSkillYears'], 'unlisted_skill_experience');
      }
      if (context.fieldType === 'number') return result(0, 'explicit_profile', ['unlistedSkillYears'], 'unlisted_skill_experience');
      return result(0, 'explicit_profile', ['unlistedSkillYears'], 'unlisted_skill_experience');
    }
  }
  if (['expected_salary', 'current_salary'].includes(category)) {
    const key = category === 'expected_salary' ? 'expectedSalary' : 'currentSalary';
    const amount = profile.professional[key];
    if (amount === undefined) return result(undefined, 'underlying_fact_missing');
    const text = `${context.question} ${context.placeholder || ''}`;
    const currencyMatch = /\b(usd|inr|eur|gbp|cad|aud)\b/i.exec(text)?.[1]?.toUpperCase();
    const symbolCurrencies = [text.includes('₹') ? 'INR' : '', text.includes('$') ? 'USD' : '', text.includes('€') ? 'EUR' : '', text.includes('£') ? 'GBP' : ''].filter(Boolean);
    const currencies = [...new Set([currencyMatch, ...symbolCurrencies].filter(Boolean))];
    const profileCurrency = profile.professional.salaryCurrency?.toUpperCase();
    if (!profileCurrency || currencies.length > 1 || currencies.some(currency => currency !== profileCurrency)) return result(undefined, 'currency_conversion_not_authorized');
    if (!currencies.length && context.country && normalizeQuestion(context.country) !== 'india' && profileCurrency === 'INR') return result(undefined, 'currency_conversion_not_authorized');
    if (/\b(?:hour|hourly|per hour)\b/i.test(text)) return result(undefined, 'hourly_rate_not_provided');
    const factor = /\b(?:lpa|lakhs?)\b/i.test(text) ? 100000 : /\bcrores?\b/i.test(text) ? 10000000 : /\bthousands?\b/i.test(text) ? 1000 : /\b(?:month(?:ly)?|per month)\b/i.test(text) ? 12 : 1;
    if (factor >= 100000 && profileCurrency !== 'INR') return result(undefined, 'currency_conversion_not_authorized');
    const formatted = amount / factor;
    if ((context.min !== undefined && formatted < context.min) || (context.max !== undefined && formatted > context.max)) return result(undefined, 'compensation_outside_widget_bounds');
    return result(formatted, 'explicit_profile', [`professional.${key}`, 'professional.salaryCurrency']);
  }
  if (category === 'notice_period' || /\b(join|joining|start date|how soon|notice|lead time)\b/i.test(q)) {
    const days = profile.professional.noticePeriodDays;
    if (context.options?.length) {
      const rightAway = context.options.find(opt => /right away|i can start right away|immediate|asap|start now/i.test(opt.trim()));
      if (rightAway && days === 0) return result(rightAway, 'explicit_profile', ['professional.noticePeriodDays']);
    }
    if (days === undefined) return result(undefined, 'underlying_fact_missing');
    if (/\bweeks?\b/.test(q)) return result(days / 7, 'explicit_profile', ['professional.noticePeriodDays']);
    if (/\bmonths?\b/.test(q)) return result(undefined, 'notice_month_conversion_ambiguous');
    return result(context.fieldType === 'number' || /\bin days\b|\bdays notice\b/.test(q) ? days : `${days} days`, 'explicit_profile', ['professional.noticePeriodDays']);
  }
  if (category === 'relocate') {
    if (/\b(?:support|assistance|package)\b/i.test(q)) {
      if (context.options?.length) {
        const noOpt = context.options.find(o => /^no\b/i.test(o.trim()));
        if (noOpt) return result(noOpt, 'explicit_profile', ['professional.willingToRelocate'], 'relocation_support');
      }
      return result(false, 'explicit_profile', ['professional.willingToRelocate'], 'relocation_support');
    }
    if (context.options?.length) {
      const yesOpt = context.options.find(o => /^(?:yes|true|willing)\b/i.test(o.trim()));
      if (yesOpt) return result(yesOpt, 'explicit_profile', ['professional.willingToRelocate'], 'willing_to_relocate');
    }
    return result(profile.professional.willingToRelocate, 'explicit_profile', ['professional.willingToRelocate'], 'willing_to_relocate');
  }
  if (['gender', 'race', 'hispanic_latino', 'veteran', 'disability'].includes(category) && !home) return result(undefined, 'jurisdiction_not_confirmed');
  if ((context.fieldType?.toLowerCase() === 'file' || context.fieldType === 'FILE_UPLOAD' || /resume|\bcv\b/i.test(q)) && /resume|\bcv\b/i.test(q)) {
    return result(profile.documents?.resume, 'explicit_profile', ['documents.resume']);
  }
  const value = resolveExtendedProfileValue(category, profile);
  const isRestrictedIdField = /\b(ssn|social security|pan\b|passport|national id|aadhaar|tax id|routing|bank account)\b/i.test(context.question || '');
  const isExplicitNarrativeField = context.fieldType?.toLowerCase() === 'textarea' || category === 'cover_letter';
  const isOpenEndedPrompt = !!context.question && /\b(?:why\b|describe|explain|elaborate|motivation|cover\s*letter|additional|tell\s+us|share|fit\b|walk\s+us\s+through|statement|essay)\b/i.test(context.question);
  const isClosedOrFactual = /\b(?:salutation|prefix|phone\s*(?:type|device)|device\s*type|receive\s*(?:sms|messages?)|sms\b|consent|terms|waive|relative|competitor|license|clearance|felon|convict|authorized|sponsorship|notice\s*period|salary|compensation|expected|current\s*company|supervisor|manager|start\s*date|graduation)\b/i.test(context.question || '') || !!(context.aliases && context.aliases.some(a => /sms|consent|phone|salutation/i.test(a)));
  const isNarrativeEligible = !isRestrictedIdField && !isClosedOrFactual && !(context.options?.length) && (
    isExplicitNarrativeField ||
    (category === 'unknown' && isOpenEndedPrompt) ||
    ((category as string) === 'skill_experience' && isExplicitNarrativeField)
  );
  if (value === undefined && isNarrativeEligible && context.question) {
    const project = composePortfolioProjectNarrative(context.question, profile);
    if (project) return result(project.text, 'verified_project_catalog', [project.factKey]);
    const narrative = composeGroundedNarrative(context.question, profile, context.company);
    if (narrative) return result(narrative, 'certified_experience_excerpt', ['experience']);
  }
  const facts = (CATEGORY_FACTS[category] || []).filter(key => key.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, profile) !== undefined);
  return result(value, value === undefined ? 'needs_review' : 'explicit_profile', value === undefined ? [] : facts);
}

/** Policies use certified facts and require one unambiguous offered answer. */
export function resolveByOptionPolicy(question: string, options: string[], profile: CandidateExtendedProfile, location = ''): ResolvedAnswer | undefined {
  const q = normalizeQuestion(question);
  const result = (value: string | boolean, fact: string): ResolvedAnswer => ({ value, confidence: 0.99, reason: 'option_policy', canonicalIntent: 'option_policy', sourceFactKeys: [fact], isEmployerSpecific: false });
  const office = profile.professional?.officeAttendance;
  if (office && /\b(?:office|onsite|on[- ]site|hybrid|in[- ]person|days a week|days per week|present in|work arrangement)\b/i.test(q)) {
    // Failure 3A: Foreign office check
    const foreignCity = /\b(new york|san francisco|london|berlin|toronto|seattle|austin|boston|dublin|singapore|tokyo|sydney)\b/i.test(`${question} ${location}`);
    const localOverride = /\b(india|bengaluru|bangalore|karnataka|remote)\b/i.test(`${question} ${location}`);
    if (foreignCity) {
      return undefined;
    }
    const cities = `${q} ${normalizeQuestion(location)}`.match(/\b(?:bangalore|bengaluru|mumbai|delhi|hyderabad|pune|chennai|london|austin)\b/g) || [];
    const sameCity = (city: string) => normalizeQuestion(city).replace('bangalore', 'bengaluru') === normalizeQuestion(office.city).replace('bangalore', 'bengaluru');
    const days = /\b([1-7])\s*days?\b/.exec(q)?.[1] || (/\bfive days\b/.test(q) ? '5' : undefined);
    const cityOk = cities.length === 0 || cities.every(sameCity);
    if (cityOk && (!days || Number(days) <= office.maxDaysPerWeek) && !/\b(?:not|unable|unwilling|outside|other than)\b/.test(q)) {
      if (!options.length) return result(true, 'professional.officeAttendance');
      const preferred = options.find(
        option =>
          /\b(yes|comfortable|willing|bengaluru|bangalore|karnataka|india|hybrid|onsite|on-site|in-office|in-person|[345]\s*days)\b/i.test(option.trim()) &&
          !/\b(no\b|not willing|cannot|unable|remote only)\b/i.test(option.trim())
      );
      if (preferred) return result(preferred, 'professional.officeAttendance');
    }
  }
  if (!options.length) return;
  let value: string | number | undefined;
  let fact = '';
  if (/\bnotice\b/.test(q)) {
    const days = profile.professional.noticePeriodDays;
    const choices = options.map(label => ({ value: label, label: label.replace(/\bdays?\b/gi, '').trim() }));
    const best = days === 0 ? options.filter(option => /^(?:immediate|immediately|available immediately|0 days)$/i.test(option.trim())) : [];
    if (best.length === 1) return result(best[0]!, 'professional.noticePeriodDays');
    if (typeof days !== 'number' || options.some(option => /weeks?|months?|years?/i.test(option))) return;
    const bucket = matchBestOption(days, choices);
    if (bucket) return result(bucket.value, 'professional.noticePeriodDays');
    return;
  }
  else if (/\b(?:total|overall|professional|work)\b/.test(q) && /\bexperience\b/.test(q) && !/\b(?:production|react|java|python|using|with)\b/.test(q)) {
    value = profile.professional.totalYearsExperience;
    fact = 'professional.totalYearsExperience';
  }
  else if (/\bdegree\b/.test(q)) { value = profile.education[0]?.degree; fact = 'education.0.degree'; }
  else if (/\b(?:hear|heard|source|find|learn)\b/.test(q) && /\b(?:us|job|position|role|opportunity|about)\b/.test(q)) {
    for (const source of profile.referralSources || []) { const best = matchBestOption(source, options.map(label => ({ value: label, label }))); if (best) return result(best.label, 'referralSources'); }
    return;
  }
  if (value === undefined) return;
  const best = matchBestOption(value, options.map(label => ({ value: label, label })));
  if (best) return result(best.label, fact);
}
