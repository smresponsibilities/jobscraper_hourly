export interface CandidateFitInput {
  title?: string | null;
  location?: string | null;
  company?: string | null;
  url?: string | null;
  description?: string | null;
}

export interface CandidateFitResult {
  allowed: boolean;
  reason?: string;
  priorityBonus: number;
  isBengaluru: boolean;
  isIndia: boolean;
}

const ISOLATED_TENANTS = new Set(['stripe', 'avoca', 'ssctech', 'paypal']);

const SENIOR_TITLE_REGEX =
  /\b(?:senior|sr\.?|staff|principal|lead|tech\s+lead|team\s+lead|engineering\s+manager|manager|director|vice\s+president|\bvp\b|head\s+of|chief|cto|cio|ciso|architect|distinguished|fellow|sde\s*(?:iii|3|iv|4)|engineer\s*(?:iii|3|iv|4|v|5)|level\s*[45678])\b/i;

const JUNIOR_OVERRIDE_REGEX =
  /\b(?:intern|internship|apprentice|apprenticeship|new\s+grad|graduate|fresher|trainee|entry[\s-]*level|junior|jr\.?|associate)\b/i;

const NON_TECH_TITLE_REGEX =
  /\b(?:account\s+executive|account\s+manager|business\s+development|\bbdr\b|\bsdr\b|sales\s+representative|sales\s+manager|customer\s+success|recruiter|talent\s+acquisition|human\s+resources|\bhr\b|people\s+operations|payroll|accountant|accounting|tax\s+|audit\s+|financial\s+advisor|legal\s+counsel|attorney|paralegal|lawyer|marketing\s+manager|content\s+writer|copywriter|social\s+media|public\s+relations|graphic\s+designer|receptionist|executive\s+assistant|office\s+manager|facilities|warehouse|forklift|driver|nurse|nursing|physician|pharmacist|therapist|medical\s+assistant|dentist|veterinarian)\b/i;

const TECH_ROLE_SIGNAL_REGEX =
  /\b(?:software|engineer|engineering|developer|programmer|\bsde\b|\bswe\b|backend|back-end|frontend|front-end|full[\s-]*stack|fullstack|data\s+scientist|data\s+engineer|data\s+analyst|machine\s+learning|\bml\b|\bai\b|artificial\s+intelligence|deep\s+learning|\bllm\b|\bnlp\b|genai|devops|\bsre\b|site\s+reliability|platform|infrastructure|cloud|kubernetes|security|cybersecurity|infosec|\bqa\b|quality\s+assurance|test|sdet|automation|mobile|android|ios|kotlin|flutter|react|node|python|java|golang|rust|c\+\+|database|clickhouse|spark|kafka|etl|analytics|quant|quantitative|systems|firmware|embedded|web\s+developer|application\s+developer|technical|technology\s+apprentice|member\s+of\s+technical\s+staff|\bmts\b)\b/i;

const INDIA_LOCATION_REGEX =
  /\b(?:india|bengaluru|bangalore|karnataka|hyderabad|telangana|pune|mumbai|maharashtra|chennai|tamil\s+nadu|gurugram|gurgaon|haryana|noida|delhi|\bncr\b|kolkata|ahmedabad|kochi|kerala|coimbatore|indore|jaipur|chandigarh|mohali|trivandrum|thiruvananthapuram)\b/i;

const BENGALURU_REGEX = /\b(?:bengaluru|bangalore|karnataka)\b/i;

const FOREIGN_ONLY_LOCATION_REGEX =
  /\b(?:united\s+states|\busa\b|u\.s\.a\.|new\s+york|\bnyc\b|san\s+francisco|bay\s+area|seattle|austin|boston|chicago|los\s+angeles|atlanta|denver|washington\s*d\.?c\.?|california|texas|united\s+kingdom|\buk\b|london|manchester|edinburgh|germany|berlin|munich|frankfurt|france|paris|netherlands|amsterdam|spain|madrid|barcelona|italy|milan|poland|warsaw|krakow|ireland|dublin|sweden|stockholm|switzerland|zurich|canada|toronto|vancouver|montreal|brazil|sao\s+paulo|mexico|mexico\s+city|argentina|colombia|chile|australia|sydney|melbourne|new\s+zealand|japan|tokyo|south\s+korea|seoul|china|beijing|shanghai|hong\s+kong|taiwan|taipei|israel|tel\s+aviv|uae|dubai|saudi\s+arabia|riyadh)\b/i;

export function evaluateCandidateJobFit(input: CandidateFitInput): CandidateFitResult {
  const company = String(input.company || '').trim().toLowerCase();
  if (ISOLATED_TENANTS.has(company)) {
    return { allowed: false, reason: 'isolated_tenant', priorityBonus: 0, isBengaluru: false, isIndia: false };
  }

  const title = String(input.title || '').trim();
  const location = String(input.location || '').trim();

  if (title) {
    // 1. Reject Senior / Staff / Principal / Lead / Manager / Director / VP / III / IV unless overridden by Intern/Apprentice/Associate
    if (SENIOR_TITLE_REGEX.test(title) && !JUNIOR_OVERRIDE_REGEX.test(title)) {
      return {
        allowed: false,
        reason: `senior_title_filtered: ${title.slice(0, 80)}`,
        priorityBonus: 0,
        isBengaluru: false,
        isIndia: false,
      };
    }

    // 2. Reject obvious non-tech roles (unless they also explicitly say Software/Data/ML Engineer)
    if (NON_TECH_TITLE_REGEX.test(title) && !/\b(?:software|data|machine\s+learning|\bml\b|\bai\b|security|devops|cloud|systems|qa|test)\s+engineer/i.test(title)) {
      return {
        allowed: false,
        reason: `non_tech_role_filtered: ${title.slice(0, 80)}`,
        priorityBonus: 0,
        isBengaluru: false,
        isIndia: false,
      };
    }
  }

  // 3. Geography check: if location is non-empty, check India vs Foreign-only
  const isBengaluru = BENGALURU_REGEX.test(location) || BENGALURU_REGEX.test(title);
  const isIndia = isBengaluru || INDIA_LOCATION_REGEX.test(location) || INDIA_LOCATION_REGEX.test(title);
  const isForeignListed = FOREIGN_ONLY_LOCATION_REGEX.test(location);
  const isGlobalRemote = /\b(?:remote\s*-\s*global|global\s*remote|worldwide|anywhere)\b/i.test(location);

  if (location && isForeignListed && !isIndia && !isGlobalRemote) {
    return {
      allowed: false,
      reason: `foreign_location_filtered: ${location.slice(0, 80)}`,
      priorityBonus: 0,
      isBengaluru: false,
      isIndia: false,
    };
  }

  // 4. Compute Priority Bonus for Scheduler
  let priorityBonus = 0;
  if (isBengaluru) priorityBonus += 5000;
  else if (isIndia) priorityBonus += 3500;

  if (JUNIOR_OVERRIDE_REGEX.test(title) || /\b(?:sde\s*1|sde\s*-?\s*i\b|engineer\s*i\b|engineer\s*1\b|founding)/i.test(title)) {
    priorityBonus += 3000;
  } else if (TECH_ROLE_SIGNAL_REGEX.test(title)) {
    priorityBonus += 1500;
  }

  return {
    allowed: true,
    priorityBonus,
    isBengaluru,
    isIndia,
  };
}
