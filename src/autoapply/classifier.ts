/**
 * Jobright Instant ATS Field Classifier Engine.
 * Reverse-engineered from Jobright's high-speed DOM classifier.
 * Classifies form fields across 60+ granular taxonomies with confidence scoring.
 */

import type {
  CandidateExtendedProfile,
  ExtendedFieldCategory,
  FieldClassificationResult,
} from './types.js';

interface FieldRuleDef {
  category: ExtendedFieldCategory;
  strongPatterns: RegExp[];
  mediumPatterns: RegExp[];
  negativePatterns?: RegExp[];
}

export const CLASSIFICATION_RULES: FieldRuleDef[] = [
  // 1. Personal
  {
    category: 'first_name',
    strongPatterns: [
      /\bfirst[_\-\s]?name\b/i,
      /\bgiven[_\-\s]?name\b/i,
      /\bfname\b/i,
      /\bfirst\b$/i,
    ],
    mediumPatterns: [
      /candidate[_\-\s]?first/i,
    ],
    negativePatterns: [/middle/i, /last/i, /full/i, /company/i],
  },
  {
    category: 'last_name',
    strongPatterns: [
      /\blast[_\-\s]?name\b/i,
      /\bfamily[_\-\s]?name\b/i,
      /\bsurname\b/i,
      /\blname\b/i,
      /\blast\b$/i,
    ],
    mediumPatterns: [
      /candidate[_\-\s]?last/i,
    ],
    negativePatterns: [/first/i, /middle/i, /full/i, /company/i],
  },
  {
    category: 'full_name',
    strongPatterns: [
      /\bfull[_\-\s]?name\b/i,
      /\bcandidate[_\-\s]?name\b/i,
      /^name$/i,
      /\byour[_\-\s]?name\b/i,
    ],
    mediumPatterns: [
      /legal[_\-\s]?name/i,
      /applicant[_\-\s]?name/i,
    ],
    negativePatterns: [/first/i, /last/i, /middle/i, /company/i, /school/i],
  },
  {
    category: 'preferred_name',
    strongPatterns: [
      /\bpreferred[_\-\s]?name\b/i,
      /\bnickname\b/i,
      /\bchosen[_\-\s]?name\b/i,
    ],
    mediumPatterns: [
      /known[_\-\s]?as/i,
    ],
  },
  {
    category: 'email',
    strongPatterns: [
      /\be-?mail[_\-\s]?(?:address)?\b/i,
      /\bemail\b/i,
    ],
    mediumPatterns: [
      /electronic[_\-\s]?mail/i,
    ],
    negativePatterns: [/confirm/i, /secondary/i],
  },
  {
    category: 'phone_country_code',
    strongPatterns: [
      /\bcountry[_\-\s]?code\b/i,
      /\bdialing[_\-\s]?code\b/i,
      /\bphone[_\-\s]?prefix\b/i,
    ],
    mediumPatterns: [
      /isd[_\-\s]?code/i,
    ],
  },
  {
    category: 'phone',
    strongPatterns: [
      /\bphone[_\-\s]?(?:number)?\b/i,
      /\bmobile[_\-\s]?(?:number)?\b/i,
      /\btelephone\b/i,
      /\bcontact[_\-\s]?(?:number|phone)?\b/i,
      /\bcell[_\-\s]?(?:phone)?\b/i,
    ],
    mediumPatterns: [
      /\bprimary[_\-\s]?phone\b/i,
    ],
    negativePatterns: [/country[_\-\s]?code/i],
  },
  {
    category: 'address_line_2',
    strongPatterns: [
      /\baddress[_\-\s]?(?:line)?[_\-\s]?2\b/i,
      /\bapt[_\-\s]?(?:suite|unit|bldg)?\b/i,
      /\bsuite[_\-\s]?(?:number|#)?\b/i,
    ],
    mediumPatterns: [
      /line\s*2/i,
    ],
  },
  {
    category: 'address',
    strongPatterns: [
      /\bstreet[_\-\s]?address\b/i,
      /\baddress[_\-\s]?(?:line)?[_\-\s]?1\b/i,
      /^address$/i,
      /\bresidential[_\-\s]?address\b/i,
    ],
    mediumPatterns: [
      /\bcurrent[_\-\s]?address\b/i,
    ],
    negativePatterns: [/email/i, /web/i, /ip/i, /address[_\-\s]?2/i],
  },
  {
    category: 'city',
    strongPatterns: [
      /\bcity\b/i,
      /\btown\b/i,
      /\bmunicipality\b/i,
    ],
    mediumPatterns: [
      /suburb/i,
    ],
  },
  {
    category: 'state',
    strongPatterns: [
      /\bstate\b/i,
      /\bprovince\b/i,
      /\bregion\b/i,
      /\bstate[_\-\s]?\/[_\-\s]?province\b/i,
    ],
    mediumPatterns: [
      /territory/i,
    ],
    negativePatterns: [/united\s+states/i, /statement/i, /authorized|eligible|right\s+to\s+work/i],
  },
  {
    category: 'postal_code',
    strongPatterns: [
      /\bzip[_\-\s]?(?:code)?\b/i,
      /\bpostal[_\-\s]?(?:code)?\b/i,
      /\bpincode\b/i,
      /\bpin[_\-\s]?code\b/i,
      /\bpostcode\b/i,
    ],
    mediumPatterns: [
      /\bzip\b/i,
    ],
  },
  {
    category: 'country',
    strongPatterns: [
      /\bcountry\b/i,
      /\bnationality\b/i,
      /\bcountry[_\-\s]?\/[_\-\s]?region\b/i,
    ],
    mediumPatterns: [
      /nation/i,
    ],
    negativePatterns: [/country[_\-\s]?code/i, /authorized|eligible|right\s+to\s+work/i],
  },

  // 2. Social / Web
  {
    category: 'linkedin',
    strongPatterns: [
      /\blinkedin[_\-\s]?(?:profile|url|link)?\b/i,
      /linkedin\.com/i,
    ],
    mediumPatterns: [
      /\blinked-in\b/i,
    ],
  },
  {
    category: 'github',
    strongPatterns: [
      /\bgithub[_\-\s]?(?:profile|url|username|handle)?\b/i,
      /github\.com/i,
    ],
    mediumPatterns: [
      /\bgit\b/i,
    ],
  },
  {
    category: 'website',
    strongPatterns: [
      /\bportfolio[_\-\s]?(?:url|link|website)?\b/i,
      /\bpersonal[_\-\s]?(?:website|site|url|link)\b/i,
      /\bwebsite\b/i,
    ],
    mediumPatterns: [
      /\bblog\b/i,
    ],
    negativePatterns: [/company/i],
  },
  {
    category: 'twitter',
    strongPatterns: [
      /\btwitter[_\-\s]?(?:handle|url|profile)?\b/i,
      /\bx[_\-\s]?handle\b/i,
    ],
    mediumPatterns: [
      /twitter\.com|x\.com/i,
    ],
  },
  {
    category: 'leetcode',
    strongPatterns: [
      /\bleetcode[_\-\s]?(?:profile|url|username)?\b/i,
      /leetcode\.com/i,
    ],
    mediumPatterns: [
      /\bhackerrank\b/i,
      /\bcodeforces\b/i,
    ],
  },

  // 3. Education
  {
    category: 'school',
    strongPatterns: [
      /\buniversity\b/i,
      /\bcollege\b/i,
      /\bschool[_\-\s]?(?:name)?\b/i,
      /\binstitution\b/i,
    ],
    mediumPatterns: [
      /alma[_\-\s]?mater/i,
      /educational[_\-\s]?institution/i,
    ],
    negativePatterns: [/high\s*school/i],
  },
  {
    category: 'degree',
    strongPatterns: [
      /\bdegree\b/i,
      /\beducation[_\-\s]?level\b/i,
      /\bhighest[_\-\s]?degree\b/i,
      /\bdegree[_\-\s]?type\b/i,
    ],
    mediumPatterns: [
      /qualification/i,
    ],
  },
  {
    category: 'discipline',
    strongPatterns: [
      /\bfield[_\-\s]?of[_\-\s]?study\b/i,
      /\bmajor\b/i,
      /\bdiscipline\b/i,
      /\bbranch\b/i,
      /\bstream\b/i,
    ],
    mediumPatterns: [
      /specialization/i,
      /department/i,
    ],
  },
  {
    category: 'gpa',
    strongPatterns: [
      /\bgpa\b/i,
      /\bgrade[_\-\s]?point\b/i,
      /\bcgpa\b/i,
      /\bpercentage[_\-\s]?(?:marks)?\b/i,
    ],
    mediumPatterns: [
      /grade/i,
    ],
  },
  {
    category: 'graduation_year',
    strongPatterns: [
      /\bgraduation[_\-\s]?year\b/i,
      /\byear[_\-\s]?of[_\-\s]?(?:graduation|passing)\b/i,
      /\bgrad[_\-\s]?year\b/i,
      /\bend[_\-\s]?year\b/i,
    ],
    mediumPatterns: [
      /batch\s*(?:of)?/i,
    ],
  },
  {
    category: 'start_year',
    strongPatterns: [
      /\bstart[_\-\s]?year\b/i,
      /\byear[_\-\s]?of[_\-\s]?joining\b/i,
    ],
    mediumPatterns: [
      /commenced/i,
    ],
  },
  {
    category: 'date_year',
    strongPatterns: [
      /datesection_year\b/i,
      /\bdate[_\-\s]?year\b/i,
    ],
    mediumPatterns: [
      /year$/i,
    ],
  },
  {
    category: 'date_month',
    strongPatterns: [
      /datesection_month\b/i,
      /\bdate[_\-\s]?month\b/i,
    ],
    mediumPatterns: [
      /month$/i,
    ],
  },
  {
    category: 'date_day',
    strongPatterns: [
      /datesection_day\b/i,
      /\bdate[_\-\s]?day\b/i,
    ],
    mediumPatterns: [
      /day$/i,
    ],
  },

  // 4. Experience & Employment
  {
    category: 'current_company',
    strongPatterns: [
      /\bcurrent[_\-\s]?company\b/i,
      /\bcurrent[_\-\s]?employer\b/i,
      /\bpresent[_\-\s]?company\b/i,
      /\bmost[_\-\s]?recent[_\-\s]?employer\b/i,
    ],
    mediumPatterns: [
      /employer/i,
    ],
  },
  {
    category: 'current_title',
    strongPatterns: [
      /\bcurrent[_\-\s]?(?:job[_\-\s]?)?title\b/i,
      /\bcurrent[_\-\s]?role\b/i,
      /\bpresent[_\-\s]?title\b/i,
      /\bmost[_\-\s]?recent[_\-\s]?role\b/i,
    ],
    mediumPatterns: [
      /designation/i,
    ],
  },
  {
    category: 'total_experience',
    strongPatterns: [
      /\btotal[_\-\s]?(?:years[_\-\s]?of[_\-\s]?)?experience\b/i,
      /\byears[_\-\s]?of[_\-\s]?experience\b/i,
      /\byoe\b/i,
      /\boverall[_\-\s]?experience\b/i,
    ],
    mediumPatterns: [
      /experience[_\-\s]?in[_\-\s]?years/i,
    ],
  },
  {
    category: 'notice_period',
    strongPatterns: [
      /\bnotice[_\-\s]?period\b/i,
      /\bhow[_\-\s]?soon[_\-\s]?can[_\-\s]?you[_\-\s]?start\b/i,
      /\bearliest[_\-\s]?start[_\-\s]?date\b/i,
      /\bavailability[_\-\s]?(?:to[_\-\s]?join)?\b/i,
    ],
    mediumPatterns: [
      /joining[_\-\s]?time/i,
      /start[_\-\s]?date/i,
    ],
  },
  {
    category: 'current_salary',
    strongPatterns: [
      /\bcurrent[_\-\s]?(?:ctc|salary|compensation|package)\b/i,
      /\bpresent[_\-\s]?(?:ctc|salary)\b/i,
    ],
    mediumPatterns: [
      /current[_\-\s]?pay/i,
    ],
  },
  {
    category: 'expected_salary',
    strongPatterns: [
      /\bexpected[_\-\s]?(?:ctc|salary|compensation|package)\b/i,
      /\bsalary[_\-\s]?expectations?\b/i,
      /\btarget[_\-\s]?(?:compensation|salary)\b/i,
      /\bdesired[_\-\s]?(?:salary|pay)\b/i,
    ],
    mediumPatterns: [
      /pay[_\-\s]?expectation/i,
    ],
  },
  {
    category: 'salary_currency',
    strongPatterns: [
      /\bsalary[_\-\s]?currency\b/i,
      /\bpay[_\-\s]?currency\b/i,
      /\bcurrency\b/i,
    ],
    mediumPatterns: [
      /currency/i,
    ],
  },
  {
    category: 'relocate',
    strongPatterns: [
      /\bwilling[_\-\s]?to[_\-\s]?relocate\b/i,
      /\brelocation\b/i,
      /\bopen[_\-\s]?to[_\-\s]?relocation\b/i,
    ],
    mediumPatterns: [
      /relocate/i,
    ],
  },
  {
    category: 'work_preference',
    strongPatterns: [
      /\bwork[_\-\s]?(?:place)?[_\-\s]?preference\b/i,
      /\bremote[_\-\s]?(?:or)?[_\-\s]?hybrid\b/i,
      /\bwork[_\-\s]?mode\b/i,
    ],
    mediumPatterns: [
      /onsite[_\-\s]?or[_\-\s]?remote/i,
    ],
  },

  // 5. Work Auth & Legal
  {
    category: 'work_authorization',
    strongPatterns: [
      /\blegally[_\-\s]?(?:authorized|eligible)[_\-\s]?to[_\-\s]?work\b/i,
      /\bauthorized[_\-\s]?to[_\-\s]?work\b/i,
      /\bright[_\-\s]?to[_\-\s]?work\b/i,
      /\bwork[_\-\s]?auth(?:orization)?\b/i,
    ],
    mediumPatterns: [
      /eligible[_\-\s]?to[_\-\s]?work[_\-\s]?in/i,
    ],
  },
  {
    category: 'sponsorship',
    strongPatterns: [
      /\b(?:require|need)[_\-\s]?(?:visa[_\-\s]?)?sponsorship\b/i,
      /\bnow[_\-\s]?or[_\-\s]?in[_\-\s]?the[_\-\s]?future[_\-\s]?require[_\-\s]?sponsorship\b/i,
      /\bfuture[_\-\s]?sponsorship\b/i,
      /\bvisa[_\-\s]?sponsorship\b/i,
      /\bimmigration[_\-\s]?sponsorship\b/i,
    ],
    mediumPatterns: [
      /h-?1b/i,
      /sponsorship/i,
    ],
  },
  {
    category: 'former_employee',
    strongPatterns: [
      /\bpreviously[_\-\s]?(?:employed|worked)\b/i,
      /\bformer[_\-\s]?employee\b/i,
      /\bhave[_\-\s]?you[_\-\s]?(?:ever)?[_\-\s]?worked[_\-\s]?for\b/i,
    ],
    mediumPatterns: [
      /past[_\-\s]?employee/i,
    ],
  },
  {
    category: 'non_compete',
    strongPatterns: [
      /\bnon[_\-\s]?compete\b/i,
      /\bnon[_\-\s]?solicitation\b/i,
      /\brestrictive[_\-\s]?covenant\b/i,
    ],
    mediumPatterns: [
      /agreement[_\-\s]?preventing/i,
    ],
  },
  {
    category: 'security_clearance',
    strongPatterns: [
      /\bsecurity[_\-\s]?clearance\b/i,
      /\bclearance[_\-\s]?level\b/i,
      /\bactive[_\-\s]?clearance\b/i,
    ],
    mediumPatterns: [
      /secret|top[_\-\s]?secret/i,
    ],
  },
  {
    category: 'felony_conviction',
    strongPatterns: [
      /\bconvicted[_\-\s]?of[_\-\s]?(?:a[_\-\s]?)?felony\b/i,
      /\bcriminal[_\-\s]?(?:record|history)\b/i,
    ],
    mediumPatterns: [
      /conviction/i,
    ],
  },

  // 6. EEO & Demographics
  {
    category: 'gender',
    strongPatterns: [
      /\bgender\b/i,
      /\bsex\b/i,
      /\bgender[_\-\s]?identity\b/i,
    ],
    mediumPatterns: [
      /male[_\-\s]?or[_\-\s]?female/i,
    ],
  },
  {
    category: 'hispanic_latino',
    strongPatterns: [
      /\bhispanic\b/i,
      /\blatino\b/i,
      /\bhispanic[_\-\s]?or[_\-\s]?latino\b/i,
    ],
    mediumPatterns: [
      /spanish[_\-\s]?origin/i,
    ],
  },
  {
    category: 'race',
    strongPatterns: [
      /\brace\b/i,
      /\bethnicity\b/i,
      /\brace[_\-\s]?\/[_\-\s]?ethnicity\b/i,
    ],
    mediumPatterns: [
      /racial[_\-\s]?identity/i,
    ],
  },
  {
    category: 'veteran',
    strongPatterns: [
      /\bveteran[_\-\s]?(?:status)?\b/i,
      /\bmilitary[_\-\s]?(?:status|service)\b/i,
      /\bprotected[_\-\s]?veteran\b/i,
    ],
    mediumPatterns: [
      /armed[_\-\s]?forces/i,
    ],
  },
  {
    category: 'disability',
    strongPatterns: [
      /\bdisability[_\-\s]?(?:status)?\b/i,
      /\bform[_\-\s]?cc-?305\b/i,
      /\bphysical[_\-\s]?or[_\-\s]?mental[_\-\s]?impairment\b/i,
    ],
    mediumPatterns: [
      /\bhandicap\b/i,
    ],
  },
  {
    category: 'disability_signature_name',
    strongPatterns: [
      /\byour[_\-\s]?name\b.*disability/i,
      /\bsignature[_\-\s]?(?:name)?\b/i,
      /\btype[_\-\s]?(?:your)?[_\-\s]?full[_\-\s]?name\b/i,
    ],
    mediumPatterns: [
      /electronic[_\-\s]?signature/i,
    ],
  },
  {
    category: 'disability_signature_date',
    strongPatterns: [
      /\btoday'?s?[_\-\s]?date\b/i,
      /\bdate[_\-\s]?(?:of[_\-\s]?signature)?\b/i,
      /\bsignature[_\-\s]?date\b/i,
    ],
    mediumPatterns: [
      /date$/i,
    ],
  },

  // 7. General Questions
  {
    category: 'hear_about_us',
    strongPatterns: [
      /\bhow[_\-\s]?did[_\-\s]?you[_\-\s]?(?:hear|learn)[_\-\s]?about[_\-\s]?(?:us|this[_\-\s]?role|position)\b/i,
      /\breferral[_\-\s]?source\b/i,
      /\bsource[_\-\s]?(?:of[_\-\s]?application)?\b/i,
    ],
    mediumPatterns: [
      /where[_\-\s]?did[_\-\s]?you[_\-\s]?find/i,
    ],
  },
  {
    category: 'referral_name',
    strongPatterns: [
      /\breferred[_\-\s]?by\b/i,
      /\breferrer[_\-\s]?(?:name)?\b/i,
      /\bemployee[_\-\s]?referral[_\-\s]?(?:name)?\b/i,
    ],
    mediumPatterns: [
      /who[_\-\s]?referred[_\-\s]?you/i,
    ],
  },
  {
    category: 'cover_letter',
    strongPatterns: [
      /\bcover[_\-\s]?letter\b/i,
      /\bwhy[_\-\s]?(?:do[_\-\s]?you[_\-\s]?want[_\-\s]?to[_\-\s]?work|join)\b/i,
      /\badditional[_\-\s]?information\b/i,
      /\bstatement[_\-\s]?of[_\-\s]?interest\b/i,
    ],
    mediumPatterns: [
      /message[_\-\s]?to[_\-\s]?hiring[_\-\s]?manager/i,
    ],
  },
];

/**
 * Instant field classification matching name, id, placeholder, label, and aria-labels.
 */
export function classifyAtsField(descriptor: {
  name?: string;
  id?: string;
  placeholder?: string;
  label?: string;
  ariaLabel?: string;
}): FieldClassificationResult {
  const parts = [
    { text: descriptor.name || '', source: 'name' as const },
    { text: descriptor.id || '', source: 'id' as const },
    { text: descriptor.label || '', source: 'label' as const },
    { text: descriptor.ariaLabel || '', source: 'aria' as const },
    { text: descriptor.placeholder || '', source: 'placeholder' as const },
  ];

  const fullText = parts.map(p => p.text).filter(Boolean).join(' ');

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.negativePatterns && rule.negativePatterns.some(np => np.test(fullText))) {
      continue;
    }

    // Check strong patterns per source
    for (const p of parts) {
      if (!p.text) continue;
      for (const sp of rule.strongPatterns) {
        if (sp.test(p.text)) {
          return {
            category: rule.category,
            confidence: p.source === 'name' || p.source === 'id' ? 0.98 : 0.92,
            matchedKeyword: sp.source,
            source: p.source,
          };
        }
      }
    }

    // Check medium patterns across full combined text
    for (const mp of rule.mediumPatterns) {
      if (mp.test(fullText)) {
        return {
          category: rule.category,
          confidence: 0.82,
          matchedKeyword: mp.source,
          source: 'fuzzy',
        };
      }
    }
  }

  return {
    category: 'unknown',
    confidence: 0.0,
    source: 'fuzzy',
  };
}

/**
 * Resolves appropriate value from CandidateExtendedProfile based on classified category.
 */
export function resolveExtendedProfileValue(
  category: ExtendedFieldCategory,
  profile: CandidateExtendedProfile
): string | boolean | number | undefined {
  const p = profile.personal;
  const edu = profile.education[0];
  const prof = profile.professional;
  const auth = profile.workAuthorization;
  const eeo = profile.eeo;

  switch (category) {
    case 'first_name': return p.firstName;
    case 'last_name': return p.lastName;
    case 'full_name': return p.fullName || `${p.firstName} ${p.lastName}`.trim();
    case 'preferred_name': return p.preferredName || p.firstName;
    case 'email': return p.email;
    case 'phone': return p.phone;
    case 'phone_country_code': return p.phoneCountryCode || '+91';
    case 'address': return p.address;
    case 'address_line_2': return p.addressLine2;
    case 'city': return p.city;
    case 'state': return p.state;
    case 'postal_code': return p.postalCode;
    case 'country': return p.country;

    case 'linkedin': return p.linkedinUrl;
    case 'github': return p.githubUrl;
    case 'website': return p.portfolioUrl;
    case 'twitter': return p.twitterUrl;
    case 'leetcode': return p.leetcodeUrl;

    case 'school': return edu?.school;
    case 'degree': return edu?.degree;
    case 'discipline': return edu?.fieldOfStudy;
    case 'gpa': return edu?.gpa;
    case 'graduation_year': return edu?.graduationYear;
    case 'start_year': return edu?.startYear;
    case 'date_year': return edu?.graduationYear || '2026';
    case 'date_month': return '05';
    case 'date_day': return '15';

    case 'current_company': return prof.currentCompany;
    case 'current_title': return prof.currentTitle;
    case 'total_experience': return prof.totalYearsExperience;
    case 'notice_period': return `${prof.noticePeriodDays} days`;
    case 'current_salary': return prof.currentSalary;
    case 'expected_salary': return prof.expectedSalary;
    case 'salary_currency': return prof.salaryCurrency || 'INR';
    case 'relocate': return prof.willingToRelocate;
    case 'work_preference': return prof.workPreference;

    case 'work_authorization': return auth.authorizedInCountry;
    case 'sponsorship': return auth.requiresSponsorshipNowOrFuture;
    case 'former_employee': return auth.formerEmployee;
    case 'non_compete': return auth.hasNonCompete;
    case 'security_clearance': return auth.hasSecurityClearance;
    case 'felony_conviction': return auth.felonyConviction;

    case 'gender': return eeo.gender;
    case 'race': return eeo.raceOrEthnicity;
    case 'hispanic_latino': return eeo.isHispanicLatino;
    case 'veteran': return eeo.veteranStatus;
    case 'disability': return eeo.disabilityStatus;
    case 'disability_signature_name': return eeo.legalSignatureName || `${p.firstName} ${p.lastName}`.trim();
    case 'disability_signature_date': return eeo.signatureDate || new Date().toISOString().slice(0, 10);

    case 'hear_about_us': return 'LinkedIn';
    case 'referral_name': return '';
    case 'cover_letter': return '';
    default: return undefined;
  }
}
