/**
 * Resume Worded "Score My Resume" Reverse-Engineered Engine.
 * Evaluates resumes across 4 core pillars: Impact (35), Brevity (25), Style (25), Structure (15).
 * Generates an overall score out of 100, line-by-line feedback, verb repetition checks, and actionable rewrites.
 */

export interface LineIssue {
  line: string;
  lineNumber: number;
  category: 'impact' | 'brevity' | 'style' | 'structure';
  severity: 'red' | 'yellow';
  message: string;
  suggestion?: string;
}

export interface PillarScore {
  score: number;
  maxScore: number;
  rating: 'Good' | 'Needs Improvement' | 'Critical';
}

export interface ResumeWordedReport {
  overallScore: number; // 0 - 100
  ratingTier: 'Top 5% (Exceptional)' | 'Top 15% (Competitive)' | 'Average' | 'Needs Major Improvement';
  pillars: {
    impact: PillarScore & {
      metricRatio: number;
      quantifiedBulletsCount: number;
      totalBulletsCount: number;
      repeatedVerbs: Record<string, number>;
      weakVerbCount: number;
    };
    brevity: PillarScore & {
      totalWords: number;
      idealWordRange: [number, number];
      bulletLengthIssues: number;
      bulletsPerRoleIssues: number;
    };
    style: PillarScore & {
      pronounOccurrences: string[];
      buzzwordsDetected: string[];
      passiveVoiceOccurrences: string[];
      consistentPunctuation: boolean;
    };
    structure: PillarScore & {
      essentialSectionsPresent: string[];
      unnecessarySectionsFound: string[];
      contactGaps: string[];
    };
  };
  lineByLineIssues: LineIssue[];
  topFixes: string[];
}

const BUZZWORDS = [
  'team player',
  'hard worker',
  'hardworking',
  'go-getter',
  'results-oriented',
  'detail-oriented',
  'self-motivated',
  'think outside the box',
  'out of the box',
  'synergy',
  'thought leader',
  'dynamic',
  'proven track record',
  'fast learner',
  'strategic thinker',
  'highly motivated',
  'work ethic',
];

const PRONOUN_REGEX = /\b(i|me|my|myself|we|our|us)\b/i;
const PASSIVE_VOICE_REGEX = /\b(?:was|were|is|are|been)\s+(?:assigned|responsible|given|tasked|asked|required|made|selected)\b/i;
const WEAK_VERBS_REGEX = /(?:^|\b(?:i\s+)?(?:was|were|been)?\s*)(?:responsible\s+for|assisted\s+with|worked\s+on|helped\s+with|tasked\s+with|participated\s+in|handled)\b/i;
const METRIC_REGEX = /\b(?:\d+[\d,]*(?:\.\d+)?%|\$\d+[\d,]*(?:\.\d+)?|\b\d+[\d,]*\s*(?:users|clients|requests|ms|seconds|minutes|hours|days|weeks|months|years|x|k|m|b|gb|tb|lpa|lakhs)\b|\b\d+\b)/i;

const STRONG_VERBS = new Set([
  'architected', 'accelerated', 'authored', 'automated', 'built', 'centralized',
  'collaborated', 'composed', 'consolidated', 'constructed', 'converted', 'created',
  'debugged', 'decreased', 'delivered', 'deployed', 'designed', 'developed',
  'devised', 'diagnosed', 'directed', 'eliminated', 'engineered', 'enhanced',
  'established', 'executed', 'expanded', 'expedited', 'formulated', 'generated',
  'guided', 'implemented', 'improved', 'increased', 'initiated', 'inspected',
  'instituted', 'integrated', 'launched', 'led', 'maximized', 'migrated',
  'minimized', 'modernized', 'negotiated', 'optimized', 'orchestrated', 'overhauled',
  'pioneered', 'planned', 'produced', 'programmed', 'reduced', 'refactored',
  'remodeled', 'reorganized', 'resolved', 'restructured', 'revamped', 'scaled',
  'simplified', 'spearheaded', 'standardized', 'streamlined', 'strengthened',
  'supervised', 'trained', 'transformed', 'upgraded',
]);

const VERB_SYNONYMS: Record<string, string[]> = {
  developed: ['engineered', 'architected', 'constructed', 'implemented'],
  created: ['authored', 'formulated', 'devised', 'pioneered'],
  managed: ['spearheaded', 'orchestrated', 'directed', 'guided'],
  improved: ['optimized', 'streamlined', 'boosted', 'enhanced'],
  led: ['orchestrated', 'directed', 'guided', 'spearheaded'],
};

/**
 * Evaluates a resume according to Resume Worded's 4-pillar rubric.
 */
export function scoreResumeWorded(resumeText: string): ResumeWordedReport {
  const lines = resumeText.split(/\r?\n/).map(l => l.trim());
  const words = resumeText.trim().split(/\s+/).filter(Boolean);
  const totalWords = words.length;

  const lineIssues: LineIssue[] = [];

  // -------------------------------------------------------------
  // Pillar 1: Impact (35 points)
  // -------------------------------------------------------------
  const bullets: Array<{ text: string; lineNum: number; verb?: string }> = [];
  const verbCounts: Record<string, number> = {};
  let weakVerbCount = 0;
  let quantifiedBulletsCount = 0;

  lines.forEach((line, idx) => {
    if (!line) return;
    const isBullet = /^[\s•\-\*]/.test(line) || (line.length > 25 && !line.endsWith(':') && !/^[A-Z\s]{3,25}$/.test(line));

    if (isBullet) {
      const clean = line.replace(/^[\s•\-\*]+/, '').trim();
      const firstWordMatch = clean.match(/^([a-zA-Z]+)\b/);
      const firstWord = firstWordMatch && firstWordMatch[1] ? firstWordMatch[1].toLowerCase() : '';

      if (firstWord && STRONG_VERBS.has(firstWord)) {
        verbCounts[firstWord] = (verbCounts[firstWord] || 0) + 1;
      }

      if (WEAK_VERBS_REGEX.test(clean)) {
        weakVerbCount++;
        lineIssues.push({
          line: clean,
          lineNumber: idx + 1,
          category: 'impact',
          severity: 'red',
          message: `Weak or passive opener "${clean.slice(0, 20)}...".`,
          suggestion: 'Replace with an active past-tense power verb (e.g., "Engineered", "Optimized", "Spearheaded").',
        });
      }

      const hasMetric = METRIC_REGEX.test(clean);
      if (hasMetric) {
        quantifiedBulletsCount++;
      } else {
        lineIssues.push({
          line: clean,
          lineNumber: idx + 1,
          category: 'impact',
          severity: 'yellow',
          message: 'Lacks quantifiable metric or measurable outcome.',
          suggestion: 'Add scale, percentages (e.g. +30%), dollar amounts, or latency reduction (e.g. reduced by 40ms) to demonstrate impact.',
        });
      }

      bullets.push({ text: clean, lineNum: idx + 1, verb: firstWord });
    }
  });

  const totalBullets = bullets.length;
  const metricRatio = totalBullets > 0 ? quantifiedBulletsCount / totalBullets : 0;

  // Verb repetition check
  const repeatedVerbs: Record<string, number> = {};
  for (const [verb, count] of Object.entries(verbCounts)) {
    if (count > 2) {
      repeatedVerbs[verb] = count;
      const syns = VERB_SYNONYMS[verb]?.join(', ') || 'alternative action verbs';
      lineIssues.push({
        line: `Action verb "${verb}" repeated ${count} times`,
        lineNumber: 0,
        category: 'impact',
        severity: 'yellow',
        message: `Verb repetition: "${verb}" is used ${count} times across your resume.`,
        suggestion: `Use synonyms to keep your descriptions engaging (e.g. ${syns}).`,
      });
    }
  }

  // Calculate Impact Score
  let impactScore = 35;
  if (metricRatio < 0.35) {
    const penalty = Math.round((0.35 - metricRatio) * 30);
    impactScore -= penalty;
  }
  impactScore -= weakVerbCount * 4;
  impactScore -= Object.keys(repeatedVerbs).length * 3;
  impactScore = Math.max(0, Math.min(35, impactScore));

  const impactRating: PillarScore['rating'] = impactScore >= 28 ? 'Good' : impactScore >= 20 ? 'Needs Improvement' : 'Critical';

  // -------------------------------------------------------------
  // Pillar 2: Brevity (25 points)
  // -------------------------------------------------------------
  let brevityScore = 25;
  let bulletLengthIssues = 0;

  // Word count check (400 - 800 words is ideal)
  if (totalWords < 350) {
    brevityScore -= 10;
    lineIssues.push({
      line: `Total Word Count: ${totalWords} words`,
      lineNumber: 0,
      category: 'brevity',
      severity: 'red',
      message: `Resume is too brief (${totalWords} words). Recruiters look for 400-800 words for early career candidates.`,
      suggestion: 'Expand your project details, tools, and technical contributions.',
    });
  } else if (totalWords > 1000) {
    brevityScore -= 10;
    lineIssues.push({
      line: `Total Word Count: ${totalWords} words`,
      lineNumber: 0,
      category: 'brevity',
      severity: 'red',
      message: `Resume is overly verbose (${totalWords} words). Recruiters skim in under 10 seconds.`,
      suggestion: 'Trim bullet points and condense descriptions to fit a concise 1-page format.',
    });
  }

  // Bullet point word count check (12 - 35 words per bullet is ideal)
  bullets.forEach(b => {
    const bWords = b.text.split(/\s+/).length;
    if (bWords > 35) {
      bulletLengthIssues++;
      lineIssues.push({
        line: b.text,
        lineNumber: b.lineNum,
        category: 'brevity',
        severity: 'yellow',
        message: `Bullet point is too long (${bWords} words; ideal is 12-35). Long sentences read like paragraphs.`,
        suggestion: 'Split into two distinct achievements or prune filler phrases.',
      });
    } else if (bWords < 12) {
      bulletLengthIssues++;
      lineIssues.push({
        line: b.text,
        lineNumber: b.lineNum,
        category: 'brevity',
        severity: 'yellow',
        message: `Bullet point is too short (${bWords} words; ideal is 12-35). Lacks context and result.`,
        suggestion: 'Elaborate on what tools you used and what the final outcome was.',
      });
    }
  });

  brevityScore -= Math.min(12, bulletLengthIssues * 2);
  brevityScore = Math.max(0, Math.min(25, brevityScore));
  const brevityRating: PillarScore['rating'] = brevityScore >= 20 ? 'Good' : brevityScore >= 14 ? 'Needs Improvement' : 'Critical';

  // -------------------------------------------------------------
  // Pillar 3: Style & Tone (25 points)
  // -------------------------------------------------------------
  let styleScore = 25;
  const pronounOccurrences: string[] = [];
  const buzzwordsDetected: string[] = [];
  const passiveVoiceOccurrences: string[] = [];

  // Punctuation check: all bullets end with period, or none do
  let withPeriod = 0;
  let withoutPeriod = 0;

  lines.forEach((line, idx) => {
    if (!line) return;

    // Pronouns
    const pMatch = line.match(PRONOUN_REGEX);
    if (pMatch && pMatch[0]) {
      pronounOccurrences.push(pMatch[0]);
      lineIssues.push({
        line,
        lineNumber: idx + 1,
        category: 'style',
        severity: 'red',
        message: `Personal pronoun "${pMatch[0]}" detected.`,
        suggestion: 'Resumes must omit personal pronouns. Write in implied third-person active voice ("Engineered...", not "I engineered...").',
      });
    }

    // Buzzwords
    const lowerLine = line.toLowerCase();
    for (const bw of BUZZWORDS) {
      if (lowerLine.includes(bw)) {
        buzzwordsDetected.push(bw);
        lineIssues.push({
          line,
          lineNumber: idx + 1,
          category: 'style',
          severity: 'yellow',
          message: `Cliché / Buzzword "${bw}" detected.`,
          suggestion: 'Replace generic buzzwords with concrete examples of work and technical skills.',
        });
      }
    }

    // Passive voice
    const passMatch = line.match(PASSIVE_VOICE_REGEX);
    if (passMatch && passMatch[0]) {
      passiveVoiceOccurrences.push(passMatch[0]);
      lineIssues.push({
        line,
        lineNumber: idx + 1,
        category: 'style',
        severity: 'yellow',
        message: `Passive construction "${passMatch[0]}" detected.`,
        suggestion: 'Rewrite in active voice to highlight your personal agency.',
      });
    }

    if (/^[\s•\-\*]/.test(line)) {
      if (line.endsWith('.')) withPeriod++;
      else withoutPeriod++;
    }
  });

  const consistentPunctuation = (withPeriod === 0 || withoutPeriod === 0) || (withPeriod / (withPeriod + withoutPeriod) > 0.85);
  if (!consistentPunctuation && withPeriod + withoutPeriod > 3) {
    styleScore -= 5;
    lineIssues.push({
      line: 'Bullet Point Punctuation',
      lineNumber: 0,
      category: 'style',
      severity: 'yellow',
      message: 'Inconsistent bullet punctuation. Some bullets end with periods while others do not.',
      suggestion: 'Choose one format (e.g. all ending with a period) and apply it consistently.',
    });
  }

  styleScore -= pronounOccurrences.length * 6;
  styleScore -= buzzwordsDetected.length * 3;
  styleScore -= passiveVoiceOccurrences.length * 4;
  styleScore = Math.max(0, Math.min(25, styleScore));
  const styleRating: PillarScore['rating'] = styleScore >= 20 ? 'Good' : styleScore >= 14 ? 'Needs Improvement' : 'Critical';

  // -------------------------------------------------------------
  // Pillar 4: Structure & Contact (15 points)
  // -------------------------------------------------------------
  let structureScore = 15;
  const essentialSectionsPresent: string[] = [];
  const unnecessarySectionsFound: string[] = [];
  const contactGaps: string[] = [];

  const lowerAll = resumeText.toLowerCase();

  // Essential sections
  if (/experience|work history|employment history/.test(lowerAll)) essentialSectionsPresent.push('Experience');
  else structureScore -= 5;

  if (/education|academic/.test(lowerAll)) essentialSectionsPresent.push('Education');
  else structureScore -= 4;

  if (/skills|technical skills|technologies/.test(lowerAll)) essentialSectionsPresent.push('Skills');
  else structureScore -= 3;

  // Unnecessary / outdated sections
  if (/references\s+available\s+upon\s+request|references:/i.test(resumeText)) {
    unnecessarySectionsFound.push('References');
    structureScore -= 3;
    lineIssues.push({
      line: 'References Section',
      lineNumber: 0,
      category: 'structure',
      severity: 'yellow',
      message: '"References available upon request" wastes valuable resume space.',
      suggestion: 'Remove this section. Employers will request references during background checks.',
    });
  }

  if (/\bobjective\b/i.test(resumeText) && !/\bsummary\b/i.test(resumeText)) {
    unnecessarySectionsFound.push('Objective');
    structureScore -= 2;
    lineIssues.push({
      line: 'Objective Section',
      lineNumber: 0,
      category: 'structure',
      severity: 'yellow',
      message: 'Old-fashioned "Objective" statement detected.',
      suggestion: 'Replace with a modern 2-3 line Professional Summary or omit entirely.',
    });
  }

  // Contact checks
  if (!/@/.test(resumeText)) {
    contactGaps.push('Email');
    structureScore -= 5;
  }
  if (!/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\+\d{1,3}\s*\d{8,12}/.test(resumeText)) {
    contactGaps.push('Phone Number');
    structureScore -= 3;
  }
  if (!/linkedin\.com/i.test(resumeText)) {
    contactGaps.push('LinkedIn URL');
    structureScore -= 2;
  }

  structureScore = Math.max(0, Math.min(15, structureScore));
  const structureRating: PillarScore['rating'] = structureScore >= 12 ? 'Good' : structureScore >= 8 ? 'Needs Improvement' : 'Critical';

  // Overall Score (out of 100)
  const overallScore = Math.round(impactScore + brevityScore + styleScore + structureScore);

  let ratingTier: ResumeWordedReport['ratingTier'] = 'Needs Major Improvement';
  if (overallScore >= 90) ratingTier = 'Top 5% (Exceptional)';
  else if (overallScore >= 80) ratingTier = 'Top 15% (Competitive)';
  else if (overallScore >= 70) ratingTier = 'Average';

  // Top Fixes
  const topFixes: string[] = [];
  if (metricRatio < 0.4) {
    topFixes.push(`Quantify more bullet points: only ${Math.round(metricRatio * 100)}% of bullets include metrics (aim for ≥40%).`);
  }
  if (pronounOccurrences.length > 0) {
    topFixes.push(`Remove ${pronounOccurrences.length} personal pronoun(s) (${Array.from(new Set(pronounOccurrences)).join(', ')}).`);
  }
  if (weakVerbCount > 0) {
    topFixes.push(`Replace ${weakVerbCount} passive/weak openers with punchy technical action verbs.`);
  }
  if (buzzwordsDetected.length > 0) {
    topFixes.push(`Eliminate fluff buzzwords: "${Array.from(new Set(buzzwordsDetected)).slice(0, 3).join('", "')}".`);
  }
  if (totalWords < 350 || totalWords > 1000) {
    topFixes.push(`Adjust resume length: currently ${totalWords} words (ideal target: 400 - 800 words).`);
  }
  if (topFixes.length === 0) {
    topFixes.push('Resume adheres cleanly to top-tier hiring manager benchmarks. Focus on role-specific technical keyword alignment.');
  }

  return {
    overallScore,
    ratingTier,
    pillars: {
      impact: {
        score: impactScore,
        maxScore: 35,
        rating: impactRating,
        metricRatio,
        quantifiedBulletsCount,
        totalBulletsCount: totalBullets,
        repeatedVerbs,
        weakVerbCount,
      },
      brevity: {
        score: brevityScore,
        maxScore: 25,
        rating: brevityRating,
        totalWords,
        idealWordRange: [400, 800],
        bulletLengthIssues,
        bulletsPerRoleIssues: 0,
      },
      style: {
        score: styleScore,
        maxScore: 25,
        rating: styleRating,
        pronounOccurrences: Array.from(new Set(pronounOccurrences)),
        buzzwordsDetected: Array.from(new Set(buzzwordsDetected)),
        passiveVoiceOccurrences: Array.from(new Set(passiveVoiceOccurrences)),
        consistentPunctuation,
      },
      structure: {
        score: structureScore,
        maxScore: 15,
        rating: structureRating,
        essentialSectionsPresent,
        unnecessarySectionsFound,
        contactGaps,
      },
    },
    lineByLineIssues: lineIssues,
    topFixes,
  };
}
