/**
 * Simplify Profile Mapping & Form Field Resolution Engine.
 * Reverse-engineered from Simplify's normalizedProfile & trackedInputSelectors.
 */

export interface CandidateProfile {
  personal: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    linkedinUrl?: string;
    githubUrl?: string;
    portfolioUrl?: string;
  };
  education: Array<{
    school: string;
    degree: string;
    fieldOfStudy: string;
    gpa?: string;
    graduationYear?: string;
  }>;
  experience: Array<{
    title: string;
    company: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    description?: string;
  }>;
  workAuthorization: {
    authorizedInCountry: boolean;
    requiresSponsorshipNowOrFuture: boolean;
  };
  eeo?: {
    gender?: string;
    raceOrEthnicity?: string;
    veteranStatus?: string;
    disabilityStatus?: string;
  };
}

export type FieldCategory =
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'email'
  | 'phone'
  | 'linkedin'
  | 'github'
  | 'website'
  | 'address'
  | 'city'
  | 'state'
  | 'country'
  | 'postal_code'
  | 'school'
  | 'degree'
  | 'discipline'
  | 'gpa'
  | 'work_authorization'
  | 'sponsorship'
  | 'gender'
  | 'race'
  | 'veteran'
  | 'disability'
  | 'unknown';

interface FieldRule {
  category: FieldCategory;
  patterns: RegExp[];
}

const FIELD_RULES: FieldRule[] = [
  {
    category: 'first_name',
    patterns: [
      /first[_\-\s]?name/i,
      /given[_\-\s]?name/i,
      /\bfname\b/i,
    ],
  },
  {
    category: 'last_name',
    patterns: [
      /last[_\-\s]?name/i,
      /family[_\-\s]?name/i,
      /surname/i,
      /\blname\b/i,
    ],
  },
  {
    category: 'full_name',
    patterns: [
      /full[_\-\s]?name/i,
      /candidate[_\-\s]?name/i,
      /^name$/i,
    ],
  },
  {
    category: 'email',
    patterns: [
      /email/i,
      /e-mail/i,
    ],
  },
  {
    category: 'phone',
    patterns: [
      /phone/i,
      /mobile/i,
      /telephone/i,
      /contact[_\-\s]?number/i,
    ],
  },
  {
    category: 'linkedin',
    patterns: [
      /linkedin/i,
    ],
  },
  {
    category: 'github',
    patterns: [
      /github/i,
    ],
  },
  {
    category: 'website',
    patterns: [
      /portfolio/i,
      /website/i,
      /personal[_\-\s]?(?:site|url|link)/i,
    ],
  },
  {
    category: 'address',
    patterns: [
      /(?:street\s+)?address/i,
      /\baddress[_\-\s]?line/i,
    ],
  },
  {
    category: 'city',
    patterns: [
      /(?:^|[^a-zA-Z0-9])city(?:[^a-zA-Z0-9]|$)/i,
      /\bmunicipality\b/i,
      /\btown\b/i,
    ],
  },
  {
    category: 'country',
    patterns: [
      /(?:^|[^a-zA-Z0-9])country(?:[^a-zA-Z0-9]|$)/i,
      /\bnationality\b/i,
    ],
  },
  {
    category: 'state',
    patterns: [
      /(?:^|[^a-zA-Z0-9])state(?:[^a-zA-Z0-9]|$)/i,
      /\bprovince\b/i,
      /\bregion\b/i,
    ],
  },
  {
    category: 'postal_code',
    patterns: [
      /\bpostal[_\-\s]?code\b/i,
      /\bzip[_\-\s]?code\b/i,
      /(?:^|[^a-zA-Z0-9])zip(?:[^a-zA-Z0-9]|$)/i,
      /\bpincode\b/i,
    ],
  },
  {
    category: 'school',
    patterns: [
      /school/i,
      /university/i,
      /college/i,
      /institution/i,
    ],
  },
  {
    category: 'degree',
    patterns: [
      /degree/i,
      /education[_\-\s]?level/i,
    ],
  },
  {
    category: 'discipline',
    patterns: [
      /field[_\-\s]?of[_\-\s]?study/i,
      /major/i,
      /discipline/i,
      /department/i,
    ],
  },
  {
    category: 'gpa',
    patterns: [
      /\bgpa\b/i,
      /grade[_\-\s]?point/i,
    ],
  },
  {
    category: 'work_authorization',
    patterns: [
      /legally\s+(?:authorized|eligible)\s+to\s+work/i,
      /authorized\s+to\s+work/i,
      /right\s+to\s+work/i,
      /work\s+auth(?:orization)?/i,
    ],
  },
  {
    category: 'sponsorship',
    patterns: [
      /(?:require|need)\s+(?:sponsorship|visa)/i,
      /future\s+sponsorship/i,
      /visa\s+sponsorship/i,
    ],
  },
  {
    category: 'gender',
    patterns: [
      /\bgender\b/i,
      /\bsex\b/i,
    ],
  },
  {
    category: 'race',
    patterns: [
      /\brace\b/i,
      /\bethnicity\b/i,
    ],
  },
  {
    category: 'veteran',
    patterns: [
      /\bveteran\b/i,
      /\bmilitary[_\-\s]?status\b/i,
    ],
  },
  {
    category: 'disability',
    patterns: [
      /\bdisability\b/i,
      /\bhandicap\b/i,
    ],
  },
];

/**
 * Classifies an ATS form input based on name, label, id, and placeholder.
 */
export function classifyFormField(descriptor: {
  name?: string;
  label?: string;
  id?: string;
  placeholder?: string;
}): FieldCategory {
  const combined = [
    descriptor.name || '',
    descriptor.label || '',
    descriptor.id || '',
    descriptor.placeholder || '',
  ].join(' ');

  for (const rule of FIELD_RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(combined)) {
        return rule.category;
      }
    }
  }

  return 'unknown';
}

/**
 * Resolves a profile value given an ATS field descriptor.
 */
export function resolveProfileValue(
  descriptor: {
    name?: string;
    label?: string;
    id?: string;
    placeholder?: string;
    type?: string;
  },
  profile: CandidateProfile
): string | boolean | undefined {
  const category = classifyFormField(descriptor);
  const primaryEdu = profile.education[0];

  switch (category) {
    case 'first_name':
      return profile.personal.firstName;
    case 'last_name':
      return profile.personal.lastName;
    case 'full_name':
      return `${profile.personal.firstName} ${profile.personal.lastName}`.trim();
    case 'email':
      return profile.personal.email;
    case 'phone':
      return profile.personal.phone;
    case 'linkedin':
      return profile.personal.linkedinUrl;
    case 'github':
      return profile.personal.githubUrl;
    case 'website':
      return profile.personal.portfolioUrl;
    case 'address':
      return profile.personal.address;
    case 'city':
      return profile.personal.city;
    case 'state':
      return profile.personal.state;
    case 'country':
      return profile.personal.country;
    case 'postal_code':
      return profile.personal.postalCode;
    case 'school':
      return primaryEdu?.school;
    case 'degree':
      return primaryEdu?.degree;
    case 'discipline':
      return primaryEdu?.fieldOfStudy;
    case 'gpa':
      return primaryEdu?.gpa;
    case 'work_authorization':
      return profile.workAuthorization.authorizedInCountry;
    case 'sponsorship':
      return profile.workAuthorization.requiresSponsorshipNowOrFuture;
    case 'gender':
      return profile.eeo?.gender;
    case 'race':
      return profile.eeo?.raceOrEthnicity;
    case 'veteran':
      return profile.eeo?.veteranStatus;
    case 'disability':
      return profile.eeo?.disabilityStatus;
    default:
      return undefined;
  }
}
