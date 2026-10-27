/**
 * Teal Job Application Likeness Scoring Engine.
 * Reverse-engineered from Teal's jobAppLikeness detector.
 * Determines if a webpage or DOM fragment is an active job application form.
 */

export const TEAL_KNOWN_URLS: RegExp[] = [
  /.*\.breezy\.hr\/p\/.*\/apply/i,
  /app\.dover\.io\/apply\/.*/i,
  /apply\.workable\.com\/.*\/j\/.*\/apply/i,
  /boards(?:\.eu)?\.greenhouse\.io\/.*\/jobs\/.*/i,
  /careers\.hireology\.com\/.*\/.*\/description/i,
  /jobs\.jobvite\.com\/.*\/job\/.*/i,
  /jobs\.smartrecruiters\.com\/oneclick-ui\/company\/.*\/publication\/.*/i,
  /.*\.bamboohr\.com\/jobs\/view\.php\?id=.*/i,
  /dynamitejobs\.com\/apply\/.*/i,
];

export const TEAL_PREVENT_ON: RegExp[] = [
  /linkedin\.com\/jobs/i,
];

export interface JobLikenessResult {
  score: number;
  threshold: number;
  isJobApplication: boolean;
  pageType: 'application_form' | 'job_posting' | 'search_or_feed' | 'other';
  matchedRules: Array<{ rule: string; points: number }>;
}

interface LikenessRule {
  name: string;
  score: number;
  patterns: RegExp[];
  isPenalty?: boolean;
}

const LIKENESS_RULES: LikenessRule[] = [
  {
    name: 'goodHeading',
    score: 10,
    patterns: [
      /apply\s+for\s+this\s+(?:job|position|role)/i,
      /submit(?:\s+your)?\s+application/i,
      /job\s+application\s+for/i,
    ],
  },
  {
    name: 'okayHeading',
    score: 5,
    patterns: [
      /^\s*apply\s*$/i,
      /\bapplication\s+form\b/i,
    ],
  },
  {
    name: 'contactFields',
    score: 5,
    patterns: [
      /(?:(?:first|last|full)\s+)?name/i,
      /\bemail\s+address\b/i,
      /\bphone\s+number\b/i,
    ],
  },
  {
    name: 'commonFields',
    score: 10,
    patterns: [
      /work\s+(?:history|experience)/i,
      /cover\s+letter/i,
      /employment\s+history/i,
    ],
  },
  {
    name: 'linkedInField',
    score: 5,
    patterns: [
      /linkedin\s+(?:profile|url)/i,
    ],
  },
  {
    name: 'resumeUploadMatch',
    score: 10,
    patterns: [
      /\b(?:resume|cv)\b/i,
      /attach\s+(?:resume|cv)/i,
      /upload\s+(?:resume|cv)/i,
    ],
  },
  {
    name: 'goodSubmitBtn',
    score: 10,
    patterns: [
      /(?:send|submit)\s+(?:(?:your)\s+)?application/i,
      /apply\s+now/i,
    ],
  },
  {
    name: 'okaySubmitBtn',
    score: 5,
    patterns: [
      /^\s*apply\s*$/i,
      /(?:save\s+(?:and\s+)?continue|continue|next)/i,
    ],
  },
  {
    name: 'feedOrSearchPenalty',
    score: -15,
    isPenalty: true,
    patterns: [
      /search\s+(?:for\s+)?jobs/i,
      /filter\s+by\s+(?:location|department)/i,
      /view\s+all\s+(?:open\s+)?jobs/i,
      /jobs\s+found/i,
      /refine\s+your\s+search/i,
    ],
  },
];

const THRESHOLD = 15;

/**
 * Evaluates HTML text or DOM string for Job Application Likeness.
 */
export function evaluateJobLikeness(html: string, url?: string): JobLikenessResult {
  if (url && TEAL_PREVENT_ON.some(reg => reg.test(url))) {
    return {
      score: 0,
      threshold: THRESHOLD,
      isJobApplication: false,
      pageType: 'search_or_feed',
      matchedRules: [{ rule: 'preventOn', points: 0 }],
    };
  }

  let totalScore = 0;
  const matchedRules: Array<{ rule: string; points: number }> = [];

  if (url && TEAL_KNOWN_URLS.some(reg => reg.test(url))) {
    totalScore += 15;
    matchedRules.push({ rule: 'knownUrl', points: 15 });
  }

  for (const rule of LIKENESS_RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(html)) {
        totalScore += rule.score;
        matchedRules.push({ rule: rule.name, points: rule.score });
        break; // Count each rule group at most once
      }
    }
  }

  const isPenalty = matchedRules.some(r => r.rule === 'feedOrSearchPenalty');
  let pageType: JobLikenessResult['pageType'] = 'other';

  if (isPenalty && totalScore < 10) {
    pageType = 'search_or_feed';
  } else if (totalScore >= 20) {
    pageType = 'application_form';
  } else if (totalScore >= 10) {
    pageType = 'job_posting';
  }

  return {
    score: Math.max(0, totalScore),
    threshold: THRESHOLD,
    isJobApplication: totalScore >= THRESHOLD,
    pageType,
    matchedRules,
  };
}
