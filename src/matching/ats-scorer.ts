/**
 * ATS Hard Match & Scoring Engine.
 * Reverse-engineered from Jobscan ATS parser and Simplify ResumeScores engine.
 */

export interface KeywordMatch {
  keyword: string;
  category: 'tools' | 'languages' | 'hardSkills' | 'softSkills';
  frequencyInJd: number;
  frequencyInResume: number;
  matched: boolean;
}

export interface AtsScoreReport {
  overallPercentage: number;
  weightedScore: number;
  rating: 'Needs Work' | 'Strong' | 'Excellent' | 'No Keywords Found';
  totalKeywords: number;
  matchedCount: number;
  coreSkills: {
    matching: string[];
    missing: string[];
  };
  highPriority: {
    matching: string[];
    missing: string[];
    percentage: number;
  };
  lowPriority: {
    matching: string[];
    missing: string[];
    percentage: number;
  };
  breakdown: KeywordMatch[];
  recommendations: string[];
}

export const SKILL_TAXONOMY = {
  languages: [
    'python', 'typescript', 'javascript', 'java', 'c++', 'golang', 'go', 'rust',
    'sql', 'scala', 'c#', 'kotlin', 'ruby', 'php', 'swift', 'r', 'html', 'css',
  ],
  toolsAndFrameworks: [
    'react', 'node.js', 'nodejs', 'express', 'next.js', 'vue', 'angular', 'django',
    'fastapi', 'flask', 'spring boot', 'docker', 'kubernetes', 'aws', 'gcp', 'azure',
    'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch',
    'kafka', 'rabbitmq', 'graphql', 'rest api', 'git', 'github', 'ci/cd', 'linux',
    'pytorch', 'tensorflow', 'scikit-learn', 'pandas', 'numpy', 'spark', 'airflow',
  ],
  hardSkills: [
    'system design', 'data structures', 'algorithms', 'microservices', 'distributed systems',
    'object-oriented programming', 'oop', 'automated testing', 'unit testing', 'api design',
    'database design', 'data modeling', 'machine learning', 'deep learning', 'cloud computing',
    'concurrency', 'asynchronous programming', 'front-end development', 'backend development',
    'full-stack development', 'code review', 'performance optimization',
  ],
  softSkills: [
    'communication', 'problem-solving', 'collaboration', 'teamwork', 'leadership',
    'critical thinking', 'adaptability', 'attention to detail', 'mentorship',
    'cross-functional collaboration', 'agile', 'scrum',
  ],
};

const DELIMITERS = '\\s\\-_/.';
const DELIM_REGEX = new RegExp(`[${DELIMITERS}]+`);
const TRIM_REGEX = new RegExp(`^([${DELIMITERS}]*)([\\s\\S]*?)([${DELIMITERS}]*)$`);
const Y_SUFFIX = /[b-df-hj-np-tv-xz]y$/i;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds an inflection-aware regex for a keyword.
 * Handles pluralization ('y' -> 'ies', 's'/'es') and delimiter variations.
 */
export function buildKeywordRegex(keyword: string): RegExp {
  const [, leading = '', core = '', trailing = ''] = keyword.match(TRIM_REGEX) || [];
  const tokens = core.split(DELIM_REGEX).filter(Boolean);
  if (!tokens.length) return /(?!)/;

  const hasNoTrailing = !trailing;
  const lastToken = tokens[tokens.length - 1] || '';
  const canInflect = hasNoTrailing && lastToken.length >= 3;

  const escapedTokens = tokens.map(escapeRegex);
  if (canInflect && escapedTokens.length > 0) {
    const lastIdx = escapedTokens.length - 1;
    const rawLast = tokens[lastIdx] || '';
    escapedTokens[lastIdx] = Y_SUFFIX.test(rawLast)
      ? `${escapedTokens[lastIdx]?.slice(0, -1)}(?:y|ies)`
      : `${escapedTokens[lastIdx]}(?:e?s)?`;
  }

  const joined = escapedTokens.join(`[${DELIMITERS}]*`);
  return new RegExp(`(^|\\W)${escapeRegex(leading)}${joined}${escapeRegex(trailing)}($|\\W)`, 'gi');
}

/**
 * Counts occurrences of a keyword in text using the inflection regex.
 */
export function countMatches(text: string, regex: RegExp): number {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Extracts recognized keywords from job description text.
 */
export function extractJdKeywords(jdText: string): Array<{
  keyword: string;
  category: 'tools' | 'languages' | 'hardSkills' | 'softSkills';
  count: number;
}> {
  const results: Array<{
    keyword: string;
    category: 'tools' | 'languages' | 'hardSkills' | 'softSkills';
    count: number;
  }> = [];

  const categories = [
    { cat: 'languages' as const, items: SKILL_TAXONOMY.languages },
    { cat: 'tools' as const, items: SKILL_TAXONOMY.toolsAndFrameworks },
    { cat: 'hardSkills' as const, items: SKILL_TAXONOMY.hardSkills },
    { cat: 'softSkills' as const, items: SKILL_TAXONOMY.softSkills },
  ];

  for (const { cat, items } of categories) {
    for (const kw of items) {
      const reg = buildKeywordRegex(kw);
      const count = countMatches(jdText, reg);
      if (count > 0) {
        results.push({ keyword: kw, category: cat, count });
      }
    }
  }

  return results;
}

/**
 * Calculates ATS Hard Match Score between Resume and Job Description.
 */
export function scoreResumeAgainstJd(resumeText: string, jdText: string): AtsScoreReport {
  const jdKeywords = extractJdKeywords(jdText);
  if (jdKeywords.length === 0) {
    return {
      overallPercentage: 0,
      weightedScore: 0,
      rating: 'No Keywords Found',
      totalKeywords: 0,
      matchedCount: 0,
      coreSkills: { matching: [], missing: [] },
      highPriority: { matching: [], missing: [], percentage: 0 },
      lowPriority: { matching: [], missing: [], percentage: 0 },
      breakdown: [],
      recommendations: ['Job description contains no recognized technical keywords from the ATS taxonomy.'],
    };
  }

  // Partition high vs low priority per Simplify/Jobscan rule
  const isSmallSet = jdKeywords.length < 16;
  const highPriorityJd: typeof jdKeywords = [];
  const lowPriorityJd: typeof jdKeywords = [];

  for (const item of jdKeywords) {
    if (isSmallSet) {
      if (item.category === 'softSkills') {
        lowPriorityJd.push(item);
      } else {
        highPriorityJd.push(item);
      }
    } else {
      if (item.category === 'languages' || item.category === 'tools') {
        highPriorityJd.push(item);
      } else {
        lowPriorityJd.push(item);
      }
    }
  }

  const breakdown: KeywordMatch[] = [];
  const highMatching: string[] = [];
  const highMissing: string[] = [];
  const lowMatching: string[] = [];
  const lowMissing: string[] = [];

  for (const item of highPriorityJd) {
    const reg = buildKeywordRegex(item.keyword);
    const resumeCount = countMatches(resumeText, reg);
    const matched = resumeCount > 0;
    if (matched) {
      highMatching.push(item.keyword);
    } else {
      highMissing.push(item.keyword);
    }
    breakdown.push({
      keyword: item.keyword,
      category: item.category,
      frequencyInJd: item.count,
      frequencyInResume: resumeCount,
      matched,
    });
  }

  for (const item of lowPriorityJd) {
    const reg = buildKeywordRegex(item.keyword);
    const resumeCount = countMatches(resumeText, reg);
    const matched = resumeCount > 0;
    if (matched) {
      lowMatching.push(item.keyword);
    } else {
      lowMissing.push(item.keyword);
    }
    breakdown.push({
      keyword: item.keyword,
      category: item.category,
      frequencyInJd: item.count,
      frequencyInResume: resumeCount,
      matched,
    });
  }

  const totalKeywords = jdKeywords.length;
  const totalMatched = highMatching.length + lowMatching.length;
  const overallPercentage = totalKeywords > 0 ? Math.round((totalMatched / totalKeywords) * 100) : 0;

  const highTotal = highMatching.length + highMissing.length;
  const lowTotal = lowMatching.length + lowMissing.length;
  const highPct = highTotal > 0 ? Math.round((highMatching.length / highTotal) * 100) : 0;
  const lowPct = lowTotal > 0 ? Math.round((lowMatching.length / lowTotal) * 100) : 0;

  // Jobscan Weighted Formula: 70% technical tools/languages, 30% supporting/soft skills
  const weightedScore = (highTotal > 0 && lowTotal > 0)
    ? Math.round((highPct * 0.70) + (lowPct * 0.30))
    : highTotal > 0 ? highPct : lowPct;

  // Identify core recurring skills (mentioned >= 2 times in JD)
  const coreMatching: string[] = [];
  const coreMissing: string[] = [];
  for (const item of jdKeywords) {
    if (item.count >= 2) {
      const reg = buildKeywordRegex(item.keyword);
      if (countMatches(resumeText, reg) > 0) {
        coreMatching.push(item.keyword);
      } else {
        coreMissing.push(item.keyword);
      }
    }
  }

  let rating: AtsScoreReport['rating'] = 'Needs Work';
  if (weightedScore >= 70) {
    rating = 'Excellent';
  } else if (weightedScore >= 50) {
    rating = 'Strong';
  }

  const recommendations: string[] = [];
  if (coreMissing.length > 0) {
    recommendations.push(
      `Critical: JD repeatedly emphasizes these missing core skills: ${coreMissing.slice(0, 5).join(', ')}.`
    );
  }
  if (highMissing.length > 0) {
    recommendations.push(
      `Add critical high-priority technical skills missing from resume: ${highMissing.slice(0, 5).join(', ')}.`
    );
  }
  if (weightedScore < 70) {
    recommendations.push(
      'Target at least a 70% weighted keyword match to consistently clear initial ATS screening filters.'
    );
  }
  if (highPct < lowPct && highMissing.length > 0) {
    recommendations.push(
      'Your resume scores higher on soft skills than core technical tools/languages. Prioritize technical keywords.'
    );
  }

  return {
    overallPercentage,
    weightedScore,
    rating,
    totalKeywords,
    matchedCount: totalMatched,
    coreSkills: {
      matching: coreMatching,
      missing: coreMissing,
    },
    highPriority: {
      matching: highMatching,
      missing: highMissing,
      percentage: highPct,
    },
    lowPriority: {
      matching: lowMatching,
      missing: lowMissing,
      percentage: lowPct,
    },
    breakdown,
    recommendations,
  };
}
