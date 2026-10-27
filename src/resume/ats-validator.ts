/**
 * Rezi ATS Resume Parsing & Formatting Standards Validator.
 * Reverse-engineered from Rezi's ATS resume compliance guidelines and bullet point impact formula.
 */

export interface BulletAudit {
  text: string;
  hasActionVerb: boolean;
  hasMetric: boolean;
  actionVerb?: string;
  isWeakVerb: boolean;
  wordCount: number;
  score: 'High' | 'Medium' | 'Low';
  suggestion?: string;
}

export interface SectionAudit {
  name: string;
  standardCategory: 'contact' | 'summary' | 'experience' | 'education' | 'skills' | 'projects' | 'certifications' | 'unknown';
  isStandardHeader: boolean;
  bulletCount: number;
}

export interface ReziAuditReport {
  overallScore: number; // 0 - 100
  grade: 'A+' | 'A' | 'B' | 'C' | 'Needs Major Revision';
  sectionsFound: SectionAudit[];
  missingCrucialSections: string[];
  bulletAudits: BulletAudit[];
  formattingIssues: string[];
  passedChecks: string[];
}

const STANDARD_SECTION_HEADERS: Record<string, SectionAudit['standardCategory']> = {
  'contact': 'contact',
  'contact information': 'contact',
  'personal details': 'contact',
  'summary': 'summary',
  'professional summary': 'summary',
  'career summary': 'summary',
  'about me': 'summary',
  'objective': 'summary',
  'experience': 'experience',
  'work experience': 'experience',
  'professional experience': 'experience',
  'employment history': 'experience',
  'work history': 'experience',
  'education': 'education',
  'academic background': 'education',
  'skills': 'skills',
  'technical skills': 'skills',
  'core competencies': 'skills',
  'skills & tools': 'skills',
  'projects': 'projects',
  'personal projects': 'projects',
  'technical projects': 'projects',
  'certifications': 'certifications',
  'licenses & certifications': 'certifications',
};

const STRONG_ACTION_VERBS = new Set([
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

const WEAK_ACTION_VERBS = [
  /^(?:responsible\s+for|assisted\s+with|worked\s+on|helped\s+with|participated\s+in|tasked\s+with)\b/i,
];

const METRIC_REGEX = /\b(?:\d+[\d,]*(?:\.\d+)?%|\$\d+[\d,]*(?:\.\d+)?|\b\d+[\d,]*\s*(?:users|clients|requests|ms|seconds|minutes|hours|days|weeks|months|years|x|k|m|b|gb|tb|lpa|lakhs)\b|\b\d+\b)/i;

const DATE_REGEX = /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4})\s*(?:-|–|—|to)\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{4}|\d{4}|present|current)\b/i;

/**
 * Audits a single resume bullet point for impact according to Rezi rules.
 */
export function auditBulletPoint(bulletText: string): BulletAudit {
  const cleaned = bulletText.replace(/^[\s•\-\*]+/, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  const firstWordMatch = cleaned.match(/^([a-zA-Z]+)\b/);
  const firstWord = (firstWordMatch && firstWordMatch[1] ? firstWordMatch[1] : '').toLowerCase();

  const isWeak = WEAK_ACTION_VERBS.some(regex => regex.test(cleaned));
  const hasStrongVerb = STRONG_ACTION_VERBS.has(firstWord);
  const hasMetric = METRIC_REGEX.test(cleaned);

  let score: BulletAudit['score'] = 'Low';
  let suggestion: string | undefined;

  if (isWeak) {
    score = 'Low';
    suggestion = `Replace weak opener "${cleaned.slice(0, 20)}..." with a strong, past-tense action verb (e.g. Engineered, Accelerated, Overhauled).`;
  } else if (hasStrongVerb && hasMetric) {
    if (wordCount > 35) {
      score = 'Medium';
      suggestion = `Contains strong verb and metric, but is too long (${wordCount} words). Shorten under 35 words for ATS readability.`;
    } else if (wordCount < 8) {
      score = 'Medium';
      suggestion = `Bullet point is too brief (${wordCount} words). Add task context and scope.`;
    } else {
      score = 'High';
    }
  } else if (hasStrongVerb && !hasMetric) {
    score = 'Medium';
    suggestion = wordCount < 8
      ? `Bullet point is too brief (${wordCount} words) and lacks metrics. Add context and quantifiable impact.`
      : 'Add quantifiable metrics (e.g., % improvement, latency reduction, scale of users) to substantiate impact.';
  } else if (!hasStrongVerb && hasMetric) {
    score = 'Medium';
    suggestion = `Begin bullet with an active verb instead of "${firstWord || 'the current phrasing'}".`;
  } else {
    score = 'Low';
    suggestion = 'Restructure following Rezi Impact Formula: [Strong Action Verb] + [Context/Task] + [Quantified Result].';
  }

  return {
    text: cleaned,
    hasActionVerb: hasStrongVerb && !isWeak,
    hasMetric,
    actionVerb: firstWord || undefined,
    isWeakVerb: isWeak,
    wordCount,
    score,
    suggestion,
  };
}

/**
 * Audits an entire text-based resume against Rezi ATS compliance standards.
 */
export function auditResume(resumeText: string): ReziAuditReport {
  const lines = resumeText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const sectionsFound: SectionAudit[] = [];
  const bulletAudits: BulletAudit[] = [];
  const formattingIssues: string[] = [];
  const passedChecks: string[] = [];

  // Check 1: Multi-column or table artifacts
  if (/\|.*?\|.*?\|/.test(resumeText)) {
    formattingIssues.push('Markdown or text tables detected. ATS parsers frequently scramble table columns into garbled text.');
  } else {
    passedChecks.push('Linear single-column format preserved (no table grids).');
  }

  // Check 2: Header parsing & sections
  let currentSection: SectionAudit | null = null;

  for (const line of lines) {
    const isHeaderLine = /^[A-Z][A-Za-z\s&]{2,30}:?$/.test(line) && line.length < 35 && !line.endsWith('.');
    const cleanHeader = line.replace(/:$/, '').toLowerCase();

    if (isHeaderLine && STANDARD_SECTION_HEADERS[cleanHeader]) {
      const cat = STANDARD_SECTION_HEADERS[cleanHeader]!;
      currentSection = {
        name: line.replace(/:$/, ''),
        standardCategory: cat,
        isStandardHeader: true,
        bulletCount: 0,
      };
      sectionsFound.push(currentSection);
      continue;
    } else if (isHeaderLine) {
      currentSection = {
        name: line.replace(/:$/, ''),
        standardCategory: 'unknown',
        isStandardHeader: false,
        bulletCount: 0,
      };
      sectionsFound.push(currentSection);
      formattingIssues.push(`Non-standard section header "${line}". Standardize to "Experience", "Education", or "Skills".`);
      continue;
    }

    // Bullet detection
    if (/^[\s•\-\*]/.test(line) || (currentSection && (currentSection.standardCategory === 'experience' || currentSection.standardCategory === 'projects') && line.length > 25)) {
      if (currentSection) currentSection.bulletCount++;
      bulletAudits.push(auditBulletPoint(line));
    }
  }

  // Check 3: Crucial sections present
  const standardCats = new Set(sectionsFound.map(s => s.standardCategory));
  const crucial: Array<{ id: SectionAudit['standardCategory']; label: string }> = [
    { id: 'experience', label: 'Work Experience' },
    { id: 'education', label: 'Education' },
    { id: 'skills', label: 'Skills' },
  ];

  const missingCrucialSections: string[] = [];
  for (const c of crucial) {
    if (!standardCats.has(c.id)) {
      missingCrucialSections.push(c.label);
      formattingIssues.push(`Missing mandatory ATS section: "${c.label}".`);
    } else {
      passedChecks.push(`Standard "${c.label}" section detected.`);
    }
  }

  // Check 4: Date formats
  if (DATE_REGEX.test(resumeText)) {
    passedChecks.push('Standard chronological date ranges (e.g. Month YYYY - Present) identified.');
  } else {
    formattingIssues.push('No standard date ranges (e.g., "06/2023 - 08/2024" or "May 2024 - Present") detected in experience/education.');
  }

  // Calculate Rezi Score (0 - 100)
  let sectionScore = Math.max(0, 25 - (missingCrucialSections.length * 8));
  let formatScore = Math.max(0, 25 - (formattingIssues.length * 5));

  let bulletScore = 25;
  if (bulletAudits.length > 0) {
    const highBullets = bulletAudits.filter(b => b.score === 'High').length;
    const medBullets = bulletAudits.filter(b => b.score === 'Medium').length;
    const qualityRatio = (highBullets * 1.0 + medBullets * 0.6) / bulletAudits.length;
    bulletScore = Math.round(qualityRatio * 30);
  }

  let dateAndContactScore = 20;
  if (!DATE_REGEX.test(resumeText)) dateAndContactScore -= 10;
  if (!/@/.test(resumeText)) {
    dateAndContactScore -= 10;
    formattingIssues.push('No email address detected in contact information.');
  } else {
    passedChecks.push('Contact email validated.');
  }

  const overallScore = Math.min(100, Math.max(0, sectionScore + formatScore + bulletScore + dateAndContactScore));

  let grade: ReziAuditReport['grade'] = 'Needs Major Revision';
  if (overallScore >= 90) grade = 'A+';
  else if (overallScore >= 80) grade = 'A';
  else if (overallScore >= 70) grade = 'B';
  else if (overallScore >= 60) grade = 'C';

  return {
    overallScore,
    grade,
    sectionsFound,
    missingCrucialSections,
    bulletAudits,
    formattingIssues,
    passedChecks,
  };
}
