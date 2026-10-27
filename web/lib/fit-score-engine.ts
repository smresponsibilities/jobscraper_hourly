// Recruiter Quality Audit & Fit Score Engine
// Faithfully implementing Soor 24-Evaluator Architecture & Bryan Creely's Resume Rocketfuel inspection methodology

import type { TargetedResume, FitScoreBreakdown, FitRuleAudit, ExperienceRole } from './career-types';

const STRONG_ACTION_VERBS = new Set([
  'accelerated', 'achieved', 'administered', 'analyzed', 'architected', 'automated',
  'built', 'centralized', 'championed', 'collaborated', 'consolidated', 'constructed',
  'created', 'decreased', 'delivered', 'deployed', 'designed', 'developed',
  'devised', 'directed', 'documented', 'eliminated', 'engineered', 'enhanced',
  'established', 'executed', 'expanded', 'expedited', 'formulated', 'generated',
  'guided', 'implemented', 'improved', 'increased', 'initiated', 'inspected',
  'installed', 'instituted', 'integrated', 'invented', 'launched', 'led',
  'maximized', 'mentored', 'migrated', 'minimized', 'modernized', 'negotiated',
  'operated', 'optimized', 'orchestrated', 'overhauled', 'pioneered', 'planned',
  'prepared', 'produced', 'programmed', 'published', 're-architected', 'reduced',
  'refactored', 'remodeled', 'reorganized', 'resolved', 'restructured', 'revamped',
  'revitalized', 'saved', 'scaled', 'scheduled', 'secured', 'simplified',
  'spearheaded', 'standardized', 'streamlined', 'strengthened', 'structured',
  'supervised', 'trained', 'transformed', 'upgraded', 'validated', 'yielded'
]);

const WEAK_PHRASES = [
  'responsible for', 'duties included', 'helped with', 'worked on',
  'assisted in', 'handled', 'was tasked with', 'participated in',
  'served as', 'took part in'
];

export function parseDate(str?: string): number | null {
  if (!str) return null;
  const trimmed = str.trim();
  if (/^present$/i.test(trimmed)) return Date.now();
  const mmyyyy = trimmed.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmyyyy) {
    const month = parseInt(mmyyyy[1], 10) - 1;
    const year = parseInt(mmyyyy[2], 10);
    return new Date(year, month, 1).getTime();
  }
  const yyyymm = trimmed.match(/^(\d{4})[-/](\d{1,2})$/);
  if (yyyymm) {
    const year = parseInt(yyyymm[1], 10);
    const month = parseInt(yyyymm[2], 10) - 1;
    return new Date(year, month, 1).getTime();
  }
  const yyyy = trimmed.match(/^(\d{4})$/);
  if (yyyy) {
    return new Date(parseInt(yyyy[1], 10), 0, 1).getTime();
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function roleLabel(role: ExperienceRole): string {
  return [role.title?.trim(), role.companyName?.trim()].filter(Boolean).join(' · ') || 'Experience';
}

export function auditResume(resume: TargetedResume): FitScoreBreakdown {
  const { profile, targetJobDescription, isTargeted } = resume;
  const { personalDetails, summary, experiences, education, skills, projects } = profile;

  const rules: FitRuleAudit[] = [];

  // ==========================================
  // 1. Personal Details Audits (Soor: heading.*.exists)
  // ==========================================
  rules.push({
    id: 'heading.full_name.exists',
    section: 'PERSONAL_DETAILS',
    coachingCategory: 'needs-attention',
    category: 'Contact',
    title: 'Add your name',
    description: 'Recruiters and hiring systems need a clear name to identify whose experience they’re reviewing.',
    passed: Boolean(personalDetails.fullName && personalDetails.fullName.trim().length > 1),
    severity: 'error',
    recommendation: 'Provide your professional first and last name.'
  });

  rules.push({
    id: 'heading.email.exists',
    section: 'PERSONAL_DETAILS',
    coachingCategory: 'needs-attention',
    category: 'Contact',
    title: 'Add a contact email',
    description: 'An email address gives recruiters a reliable way to contact you about an opportunity.',
    passed: Boolean(personalDetails.email && personalDetails.email.includes('@') && personalDetails.email.includes('.')),
    severity: 'error',
    recommendation: 'Use a clean, professional email (e.g. firstname.lastname@gmail.com).'
  });

  rules.push({
    id: 'heading.phone.exists',
    section: 'PERSONAL_DETAILS',
    coachingCategory: 'worth-strengthening',
    category: 'Contact',
    title: 'Add another way to reach you',
    description: 'Including a phone number gives recruiters another direct way to contact you.',
    passed: Boolean(personalDetails.phoneNumber && personalDetails.phoneNumber.trim().length >= 8),
    severity: 'warning',
    recommendation: 'Include a direct mobile number with country code.'
  });

  rules.push({
    id: 'heading.location.exists',
    section: 'PERSONAL_DETAILS',
    coachingCategory: 'worth-strengthening',
    category: 'Contact',
    title: 'Clarify where you’re based',
    description: 'Adding your city and state can help recruiters quickly understand whether the opportunity may be a practical fit.',
    passed: Boolean(personalDetails.location && personalDetails.location.trim().length > 3),
    severity: 'warning',
    recommendation: 'Add City, State/Country (e.g., Bengaluru, India).'
  });

  rules.push({
    id: 'heading.linkedin.exists',
    section: 'PERSONAL_DETAILS',
    coachingCategory: 'worth-strengthening',
    category: 'Contact',
    title: 'Add your LinkedIn profile',
    description: 'A LinkedIn profile can provide additional context and help reinforce your professional story.',
    passed: Boolean(personalDetails.linkedInUrl && personalDetails.linkedInUrl.toLowerCase().includes('linkedin.com/')),
    severity: 'info',
    recommendation: 'Link your customized LinkedIn vanity URL.'
  });

  // ==========================================
  // 2. Career Profile / Summary Audits (Soor: summary.*)
  // ==========================================
  const summaryLength = summary ? summary.trim().length : 0;
  const wordCount = summary ? summary.trim().split(/\s+/).filter(Boolean).length : 0;

  rules.push({
    id: 'summary.exists',
    section: 'CAREER_PROFILE',
    coachingCategory: 'worth-strengthening',
    category: 'Summary',
    title: 'Introduce the value you bring',
    description: 'Without a career profile, recruiters must infer your focus from the rest of the resume. A concise introduction can frame what follows.',
    passed: summaryLength > 20,
    severity: 'warning',
    recommendation: 'Write a 3-4 sentence professional summary highlighting your specialization and key achievements.'
  });

  rules.push({
    id: 'summary.length',
    section: 'CAREER_PROFILE',
    coachingCategory: 'worth-strengthening',
    category: 'Summary',
    title: 'Make your career profile easier to scan',
    description: summaryLength > 400
      ? `Your career profile is ${summaryLength} characters and may be trying to communicate too much at once. Bring the most important positioning forward and trim details.`
      : 'A concise summary keeps recruiter attention focused on your core value proposition (under 400 characters, ~30–80 words).',
    passed: summaryLength <= 400 && wordCount <= 85,
    severity: 'warning',
    recommendation: summaryLength > 400
      ? `Your summary is ${summaryLength} characters (${wordCount} words). Trim down to under 400 characters (~30–80 words).`
      : 'Maintain a concise summary under 400 characters.'
  });

  const hasWeakObjective = /objective|looking for a role where I can|seeking a position to utilize/i.test(summary || '');
  rules.push({
    id: 'summary.no_cliche_objective',
    section: 'CAREER_PROFILE',
    coachingCategory: 'worth-strengthening',
    category: 'Summary',
    title: 'Avoid outdated objective statements',
    description: 'Recruiters want to see what value you deliver to the company, not what you want the company to give you.',
    passed: !hasWeakObjective,
    severity: 'warning',
    recommendation: 'Focus on your capabilities, technical scope, and demonstrated impact rather than personal objectives.'
  });

  // Active and primary roles
  const activeRoles = experiences.filter(e => e.displayType !== 'INACTIVE');
  const primaryRoles = experiences.filter(e => e.displayType === 'EXPERIENCE');

  // ==========================================
  // 3. Experience Structural Audits
  // ==========================================
  rules.push({
    id: 'experience.exists',
    section: 'EXPERIENCE',
    coachingCategory: 'needs-attention',
    category: 'Experience',
    title: 'Include experience that supports your story',
    description: 'This resume does not yet show where you developed your skills or how you’ve applied them professionally.',
    passed: activeRoles.length > 0,
    severity: 'error',
    recommendation: 'Add your current or past software engineering roles, internships, or open source technical work.'
  });

  // Rule 9: experience.location.exists
  const missingLocationRoles = activeRoles.filter(e => !e.location || !e.location.trim());
  rules.push({
    id: 'experience.location.exists',
    section: 'EXPERIENCE',
    coachingCategory: 'worth-strengthening',
    category: 'Experience',
    title: 'Add a location for this role',
    description: missingLocationRoles.length > 0
      ? `${roleLabel(missingLocationRoles[0])} does not include a location, so it may be unclear where the work was performed or whether it was remote.`
      : 'All active roles specify a location or remote status.',
    passed: missingLocationRoles.length === 0,
    severity: 'warning',
    recommendation: missingLocationRoles.length > 0
      ? `Add location (e.g. City, Country or Remote) for: ${missingLocationRoles.map(r => r.title || 'Role').join(', ')}.`
      : 'Location specified across all roles.'
  });

  // Rule 10: experience.company_name.exists
  const missingCompanyRoles = activeRoles.filter(e => !e.companyName || !e.companyName.trim());
  rules.push({
    id: 'experience.company_name.exists',
    section: 'EXPERIENCE',
    coachingCategory: 'needs-attention',
    category: 'Experience',
    title: 'Identify the employer',
    description: missingCompanyRoles.length > 0
      ? `${missingCompanyRoles[0].title?.trim() || 'This role'} does not identify an employer, making the setting and context of the experience difficult to understand.`
      : 'All roles identify an employer or organization.',
    passed: missingCompanyRoles.length === 0,
    severity: 'error',
    recommendation: missingCompanyRoles.length > 0
      ? 'Fill in employer names for all listed positions.'
      : 'All roles have company names.'
  });

  // Rule 11: job_titles.title.exists
  const missingTitleRoles = activeRoles.filter(e => !e.title || !e.title.trim());
  rules.push({
    id: 'job_titles.title.exists',
    section: 'EXPERIENCE',
    coachingCategory: 'needs-attention',
    category: 'Experience',
    title: 'Clarify your role',
    description: missingTitleRoles.length > 0
      ? `Your experience at ${missingTitleRoles[0].companyName?.trim() || 'an organization'} does not include a job title, so recruiters cannot quickly understand the work you performed.`
      : 'All experiences clearly specify your operating title.',
    passed: missingTitleRoles.length === 0,
    severity: 'error',
    recommendation: missingTitleRoles.length > 0
      ? 'Add job titles for all listed experiences.'
      : 'Job titles present on all experiences.'
  });

  // Rule 12: job_titles.dates.exist
  const missingDatesRoles = activeRoles.filter(e => !e.startDate?.trim() || (!e.isCurrent && !e.endDate?.trim()));
  rules.push({
    id: 'job_titles.dates.exist',
    section: 'EXPERIENCE',
    coachingCategory: 'needs-attention',
    category: 'Experience',
    title: 'Complete this role’s timeline',
    description: missingDatesRoles.length > 0
      ? `${roleLabel(missingDatesRoles[0])} is missing its ${!missingDatesRoles[0].startDate?.trim() && !missingDatesRoles[0].endDate?.trim() ? 'start and end dates' : !missingDatesRoles[0].startDate?.trim() ? 'start date' : 'end date'}, leaving part of your career timeline unclear.`
      : 'All roles have complete date ranges.',
    passed: missingDatesRoles.length === 0,
    severity: 'error',
    recommendation: 'Provide start and end dates (or mark Current) for all experiences.'
  });

  // Rule 13: job_titles.dates.chronological
  const invertedDateRoles = activeRoles.filter(e => {
    if (e.isCurrent) return false;
    const start = parseDate(e.startDate);
    const end = parseDate(e.endDate);
    return start !== null && end !== null && start > end;
  });
  rules.push({
    id: 'job_titles.dates.chronological',
    section: 'EXPERIENCE',
    coachingCategory: 'needs-attention',
    category: 'Experience',
    title: 'Correct the date order',
    description: invertedDateRoles.length > 0
      ? `${roleLabel(invertedDateRoles[0])} currently ends before it starts, making the timeline appear incorrect.`
      : 'All role timelines are in correct chronological order.',
    passed: invertedDateRoles.length === 0,
    severity: 'error',
    recommendation: invertedDateRoles.length > 0
      ? `Ensure start date precedes end date for: ${invertedDateRoles.map(r => roleLabel(r)).join(', ')}.`
      : 'Dates are chronological.'
  });

  // Rule 14: job_titles.dates.older_than_15_years (Gated on isTargeted per Soor chunk 1289)
  if (Boolean(isTargeted)) {
    const fifteenYearsAgo = new Date();
    fifteenYearsAgo.setFullYear(fifteenYearsAgo.getFullYear() - 15);
    const fifteenYearsAgoTime = fifteenYearsAgo.getTime();

    const olderThan15Roles = primaryRoles.filter(e => {
      if (e.isCurrent) return false;
      const end = parseDate(e.endDate);
      return end !== null && end < fifteenYearsAgoTime;
    });

    rules.push({
      id: 'job_titles.dates.older_than_15_years',
      section: 'EXPERIENCE',
      coachingCategory: 'worth-strengthening',
      category: 'Experience',
      title: 'Decide whether this older role still earns its space',
      description: olderThan15Roles.length > 0
        ? `${roleLabel(olderThan15Roles[0])} ended more than 15 years ago and may draw attention away from experience that better reflects your current level. Keep it if it provides important evidence for this opportunity.`
        : 'Experience is concentrated within the relevant 10–15 year recruiting window.',
      passed: olderThan15Roles.length === 0,
      severity: 'warning',
      recommendation: olderThan15Roles.length > 0
        ? 'In targeted resumes, consider moving roles older than 15 years to Other Relevant Experience or omitting them.'
        : 'No obsolete roles detected.'
    });
  }

  // Rule 15: job_titles.dates.overlap (Be ready to explain overlapping roles)
  const parsedRoles = activeRoles.map(e => ({
    ...e,
    parsedStart: parseDate(e.startDate),
    parsedEnd: e.isCurrent ? Number.MAX_SAFE_INTEGER : parseDate(e.endDate)
  }));
  const overlappingPairs: string[] = [];
  for (let i = 0; i < parsedRoles.length; i++) {
    for (let j = i + 1; j < parsedRoles.length; j++) {
      const r1 = parsedRoles[i];
      const r2 = parsedRoles[j];
      if (
        r1.id !== r2.id &&
        r1.parsedStart !== null && r1.parsedEnd !== null &&
        r2.parsedStart !== null && r2.parsedEnd !== null &&
        r1.parsedStart < r2.parsedEnd && r2.parsedStart < r1.parsedEnd
      ) {
        overlappingPairs.push(`${roleLabel(r1)} & ${roleLabel(r2)}`);
      }
    }
  }

  rules.push({
    id: 'job_titles.dates.overlap',
    section: 'EXPERIENCE',
    coachingCategory: 'be-ready-to-explain',
    category: 'Experience',
    title: 'Be ready to explain overlapping roles',
    description: overlappingPairs.length > 0
      ? `${overlappingPairs[0]} have overlapping dates. If you held them simultaneously, the timeline may be accurate—just be prepared to explain the relationship clearly.`
      : 'No unexpected date overlaps found between roles.',
    passed: true, // Info-level coaching in Soor ("be-ready-to-explain"), does not penalize score
    severity: 'info',
    recommendation: overlappingPairs.length > 0
      ? `Simultaneous dates detected for ${overlappingPairs.join('; ')}. Be prepared to discuss in interviews.`
      : 'Clean non-overlapping timeline.'
  });

  // Rule 16: job_titles.primary_focus.exists (Scope & Scale)
  const missingScopeScale = primaryRoles.filter(e => {
    if (e.scopeScale?.primaryFocus && e.scopeScale.primaryFocus.trim().length > 15) return false;
    const firstAch = e.achievements[0];
    return !(firstAch && (firstAch.isScopeScale || firstAch.text.length > 40));
  });

  rules.push({
    id: 'job_titles.primary_focus.exists',
    section: 'EXPERIENCE',
    coachingCategory: 'worth-strengthening',
    category: 'Scope & Scale',
    title: 'Show the level and reach of this role',
    description: missingScopeScale.length > 0
      ? `${roleLabel(missingScopeScale[0])} moves directly into achievements without establishing the size, reach, or complexity of the work.`
      : 'All primary roles establish operational scope, throughput, or team scale before bullet achievements.',
    passed: primaryRoles.length === 0 || missingScopeScale.length === 0,
    severity: 'warning',
    recommendation: missingScopeScale.length > 0
      ? `Add a Scope & Scale statement establishing team size, user volume, or system complexity for: ${missingScopeScale.map(r => roleLabel(r)).join(', ')}.`
      : 'Scope & scale established on all roles.'
  });

  // Rule 17: experience.achievements.missing (Roles with 0 bullets)
  const zeroBulletRoles = primaryRoles.filter(e => !e.achievements || e.achievements.length === 0);
  rules.push({
    id: 'experience.achievements.missing',
    section: 'ACHIEVEMENTS',
    coachingCategory: 'worth-strengthening',
    category: 'Achievements',
    title: 'Show what you accomplished',
    description: zeroBulletRoles.length > 0
      ? `${roleLabel(zeroBulletRoles[0])} does not include an achievement, so recruiters cannot see concrete evidence of your contribution or impact.`
      : 'Every experience features concrete achievements.',
    passed: zeroBulletRoles.length === 0,
    severity: 'warning',
    recommendation: zeroBulletRoles.length > 0
      ? `Add 2–4 accomplishment bullets for: ${zeroBulletRoles.map(r => roleLabel(r)).join(', ')}.`
      : 'All roles have achievement bullets.'
  });

  // ==========================================
  // 4. Bullet-Level Achievement Metrics & Phrasing
  // ==========================================
  const allAchievements = experiences.flatMap(e => e.achievements);
  const totalBullets = allAchievements.length;

  // Metric check (contains numbers, %, $, ms, k, M, B, etc.)
  const metricRegex = /\d+(?:\.\d+)?%?|\$\d+|\b\d+\s*(?:k|m|million|billion|users|queries|ms|s|hours|days|x|percent)\b/i;
  const bulletsWithMetrics = allAchievements.filter(a => metricRegex.test(a.text));
  const metricRatio = totalBullets > 0 ? (bulletsWithMetrics.length / totalBullets) : 0;

  rules.push({
    id: 'achievements.metrics',
    section: 'ACHIEVEMENTS',
    coachingCategory: 'worth-strengthening',
    category: 'Achievements',
    title: 'Quantify your impact with metrics',
    description: 'Recruiters read hundreds of resumes. Bullets with concrete numbers (%, $, latency, throughput, users) stand out immediately.',
    passed: totalBullets > 0 && metricRatio >= 0.6,
    severity: 'warning',
    recommendation: `${Math.round(metricRatio * 100)}% of bullets currently have numbers. Target at least 60% with measurable outcomes.`
  });

  // Action verb check
  const bulletsStartingWithActionVerb = allAchievements.filter(a => {
    const firstWord = a.text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
    return Boolean(firstWord && STRONG_ACTION_VERBS.has(firstWord));
  });
  const actionVerbRatio = totalBullets > 0 ? (bulletsStartingWithActionVerb.length / totalBullets) : 0;

  rules.push({
    id: 'achievements.action_verbs',
    section: 'ACHIEVEMENTS',
    coachingCategory: 'worth-strengthening',
    category: 'Achievements',
    title: 'Start bullets with strong action verbs',
    description: 'Lead each bullet with an active verb (e.g. Engineered, Architected, Automated, Reduced) instead of passive phrasing.',
    passed: totalBullets > 0 && actionVerbRatio >= 0.6,
    severity: 'warning',
    recommendation: `${Math.round(actionVerbRatio * 100)}% of bullets start with strong verbs. Avoid starting with "Responsible for" or "Assisted in".`
  });

  // Passive / weak phrase check
  const bulletsWithWeakPhrases = allAchievements.filter(a =>
    WEAK_PHRASES.some(phrase => a.text.toLowerCase().includes(phrase))
  );

  rules.push({
    id: 'achievements.no_passive_voice',
    section: 'ACHIEVEMENTS',
    coachingCategory: 'needs-attention',
    category: 'Achievements',
    title: 'Eliminate passive responsibility language',
    description: 'Phrases like "responsible for" or "duties included" describe job postings, not accomplishments.',
    passed: bulletsWithWeakPhrases.length === 0,
    severity: 'error',
    recommendation: bulletsWithWeakPhrases.length > 0
      ? `Replace "${WEAK_PHRASES.find(p => bulletsWithWeakPhrases[0].text.toLowerCase().includes(p))}" with active accomplishment verbs.`
      : 'All bullets use active phrasing.'
  });

  // ==========================================
  // 5. Skills Section (Soor: skills.exist)
  // ==========================================
  const activeSkills = skills.filter(s => s.included);
  rules.push({
    id: 'skills.exist',
    section: 'SKILLS',
    coachingCategory: 'worth-strengthening',
    category: 'Skills',
    title: 'Add skills that support this resume',
    description: 'A focused skills section gives recruiters and hiring systems more context about the capabilities you bring.',
    passed: activeSkills.length >= 6,
    severity: 'warning',
    recommendation: activeSkills.length === 0
      ? 'Add a skills section highlighting your technical stack and core competencies.'
      : 'Maintain 6–15 focused skills directly relevant to your target engineering roles.'
  });

  // ==========================================
  // 6. Projects Section (Soor: projects.maximum.targeted_resume & projects.relevance.target_job)
  // ==========================================
  const includedProjects = projects.filter(p => p.included);

  // Rule 22: projects.maximum.targeted_resume (Gated on isTargeted per Soor chunk 1289)
  if (Boolean(isTargeted)) {
    const tooManyProjects = includedProjects.length > 3;
    rules.push({
      id: 'projects.maximum.targeted_resume',
      section: 'PROJECTS',
      coachingCategory: 'worth-strengthening',
      category: 'Targeting',
      title: 'Focus on your strongest projects',
      description: tooManyProjects
        ? `This resume includes ${includedProjects.length} projects. Prioritizing the most relevant ones can make your strongest evidence easier to find.`
        : 'Project section maintains strong focus without diluting attention.',
      passed: !tooManyProjects,
      severity: 'warning',
      recommendation: tooManyProjects
        ? 'In a targeted resume, limit projects to 2–3 of your strongest demonstrations.'
        : 'Project count is well balanced.'
    });
  }

  // Rule 23: projects.relevance.target_job (Only when JD has terms per Soor chunk 1289)
  let jdTokens = new Set<string>();
  if (targetJobDescription && targetJobDescription.trim().length > 20) {
    const rawWords = targetJobDescription.toLowerCase().match(/[a-z0-9+#.-]{3,}/g) || [];
    jdTokens = new Set(rawWords);
  }

  if (jdTokens.size > 0 && includedProjects.length > 0) {
    const irrelevantProjects = includedProjects.filter(p => {
      const pText = `${p.title} ${p.technologies.join(' ')} ${p.description} ${p.bullets.join(' ')}`.toLowerCase();
      const pWords = pText.match(/[a-z0-9+#.-]{3,}/g) || [];
      return !pWords.some(w => jdTokens.has(w));
    });

    rules.push({
      id: 'projects.relevance.target_job',
      section: 'PROJECTS',
      coachingCategory: 'worth-strengthening',
      category: 'Targeting',
      title: 'Make this project’s relevance clearer',
      description: irrelevantProjects.length > 0
        ? `The connection between ${irrelevantProjects[0].title} and the opportunity is not immediately clear. Add context that shows what relevant capability or outcome it demonstrates.`
        : 'Listed projects share clear terminology and skills with the target opportunity.',
      passed: irrelevantProjects.length === 0,
      severity: 'warning',
      recommendation: irrelevantProjects.length > 0
        ? `Align project descriptions with requisition keywords for: ${irrelevantProjects.map(p => p.title).join(', ')}.`
        : 'Projects are well aligned with target requisition.'
    });
  }

  // ==========================================
  // 7. Education Section (Soor: education.exists, education.institution.exists, education.degree.exists)
  // ==========================================
  rules.push({
    id: 'education.exists',
    section: 'EDUCATION',
    coachingCategory: 'worth-strengthening',
    category: 'Education',
    title: 'Consider whether education belongs here',
    description: 'If your education strengthens your fit or provides expected credentials, including it may make the resume more complete.',
    passed: education.length > 0,
    severity: 'warning',
    recommendation: 'Add your degree, university name, and graduation year.'
  });

  const missingInstitution = education.filter(e => !e.school || !e.school.trim());
  rules.push({
    id: 'education.institution.exists',
    section: 'EDUCATION',
    coachingCategory: 'needs-attention',
    category: 'Education',
    title: 'Identify the institution',
    description: missingInstitution.length > 0
      ? `${missingInstitution[0].credential?.trim() || 'This education record'} does not name the school or institution that awarded the credential.`
      : 'All education records identify the institution.',
    passed: education.length === 0 || missingInstitution.length === 0,
    severity: 'error',
    recommendation: 'Name the university or issuing institution for all education entries.'
  });

  const missingDegree = education.filter(e => !e.credential || !e.credential.trim());
  rules.push({
    id: 'education.degree.exists',
    section: 'EDUCATION',
    coachingCategory: 'needs-attention',
    category: 'Education',
    title: 'Clarify the credential',
    description: missingDegree.length > 0
      ? `Your education at ${missingDegree[0].school?.trim() || 'the institution'} does not identify the degree, certificate, or program you completed.`
      : 'All education records specify the degree or credential awarded.',
    passed: education.length === 0 || missingDegree.length === 0,
    severity: 'error',
    recommendation: 'Specify the degree, program, or major (e.g. B.Tech Computer Science).'
  });

  // ==========================================
  // 8. Length & Page Count (Soor: resume.length.maximum)
  // ==========================================
  const estimatedLines =
    4 + // Header & contact
    Math.ceil(wordCount / 12) + // Summary
    activeRoles.length * 3 + // Role headers
    totalBullets * 2 + // Bullet wraps
    Math.ceil(activeSkills.length / 4) + // Skills rows
    includedProjects.length * 4 + // Projects
    education.length * 2; // Education

  const estimatedPages = Math.ceil(estimatedLines / 44);

  // Soor threshold is 3 pages (renderedPageCount <= 3)
  rules.push({
    id: 'resume.length.maximum',
    section: 'EXPERIENCE',
    coachingCategory: 'worth-strengthening',
    category: 'Length',
    title: 'Resume Longer Than 3 Pages',
    description: estimatedPages > 3
      ? `This resume is ${estimatedPages} pages long. Trim lower-priority content so your strongest, most relevant material is easier to find.`
      : `Resume length is ~${estimatedPages} page(s), well within the 1–3 page recruiter tolerance standard.`,
    passed: estimatedPages <= 3,
    severity: estimatedPages > 3 ? 'error' : (estimatedPages > 2 ? 'warning' : 'info'),
    recommendation: estimatedPages > 3
      ? `Currently ~${estimatedPages} pages. Cut bullet lengths and remove older or less relevant projects to bring under 2–3 pages.`
      : estimatedPages === 2
      ? '2 pages is standard for experienced engineers; keep it to 1 page if under 3 years experience.'
      : '1 page is optimal for rapid scanning.'
  });

  // ==========================================
  // 9. Keyword Match against Target Requisition
  // ==========================================
  let matchedKeywords: string[] = [];
  let missingKeywords: string[] = [];
  let targetMatchPercent = 100;

  if (targetJobDescription && targetJobDescription.trim().length > 30) {
    const jdWords = extractKeywords(targetJobDescription);
    const resumeText = [
      summary,
      ...experiences.map(e => `${e.title} ${e.companyName} ${e.location} ${e.achievements.map(a => a.text).join(' ')}`),
      ...skills.map(s => s.name),
      ...projects.map(p => `${p.title} ${p.technologies.join(' ')} ${p.description}`)
    ].join(' ').toLowerCase();

    matchedKeywords = jdWords.filter(kw => resumeText.includes(kw.toLowerCase()));
    missingKeywords = jdWords.filter(kw => !resumeText.includes(kw.toLowerCase()));

    if (jdWords.length > 0) {
      targetMatchPercent = Math.round((matchedKeywords.length / jdWords.length) * 100);
    }

    rules.push({
      id: 'targeting.jd_alignment',
      section: 'PROJECTS',
      coachingCategory: 'worth-strengthening',
      category: 'Targeting',
      title: 'Align resume with target job description',
      description: 'Aligning your demonstrated skills and terminology with the job requisition improves recruiter keyword fit.',
      passed: targetMatchPercent >= 60,
      severity: 'warning',
      recommendation: targetMatchPercent < 60
        ? `Keyword match is ${targetMatchPercent}%. Incorporate relevant target terms: ${missingKeywords.slice(0, 5).join(', ')}.`
        : `Strong keyword match (${targetMatchPercent}%).`
    });
  }

  // Calculate overall score (0 - 100)
  const passedCount = rules.filter(r => r.passed).length;
  const totalCount = rules.length;

  let penalty = 0;
  for (const r of rules) {
    if (!r.passed) {
      if (r.severity === 'error') penalty += 10;
      else if (r.severity === 'warning') penalty += 4;
      else penalty += 1;
    }
  }

  const baseScore = Math.max(20, Math.min(100, 100 - penalty));
  const finalScore = targetJobDescription && targetJobDescription.trim().length > 30
    ? Math.round(baseScore * 0.75 + targetMatchPercent * 0.25)
    : baseScore;

  return {
    score: finalScore,
    passedCount,
    totalCount,
    rules,
    targetMatchPercent,
    matchedKeywords,
    missingKeywords
  };
}

// Broad multi-domain keyword extractor (Tech, Systems, Cloud, Finance, Consulting, Data)
export function extractKeywords(text: string): string[] {
  const domainTerms = [
    // Languages
    'typescript', 'javascript', 'python', 'golang', 'go', 'java', 'c++', 'c#', 'rust', 'scala', 'sql', 'bash',
    // Web & Frameworks
    'react', 'next.js', 'vue', 'angular', 'svelte', 'node.js', 'express', 'fastapi', 'spring boot', 'django', 'graphql', 'rest', 'grpc', 'websocket',
    // Databases & Storage
    'postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'opensearch', 'cassandra', 'dynamodb', 'sqlite',
    // Infrastructure & Cloud
    'docker', 'kubernetes', 'k8s', 'aws', 'gcp', 'azure', 'terraform', 'ci/cd', 'github actions', 'helm', 'linux', 'serverless', 'lambda',
    // Distributed Systems & Architecture
    'kafka', 'rabbitmq', 'microservices', 'distributed systems', 'concurrency', 'multithreading', 'caching', 'rate limiting', 'latency', 'high availability',
    // Testing & Quality
    'playwright', 'cypress', 'jest', 'vitest', 'unit test', 'e2e test', 'integration test',
    // Data & AI
    'etl', 'elt', 'pipeline', 'spark', 'airflow', 'snowflake', 'databricks', 'llm', 'rag', 'embeddings', 'machine learning',
    // Finance & Quant
    'fintech', 'portfolio', 'algorithmic trading', 'risk management', 'options', 'derivatives', 'equities', 'order execution', 'pnl', 'compliance', 'ledger',
    // Consulting & Product
    'stakeholder management', 'client delivery', 'roadmap', 'digital transformation', 'system design', 'scalability', 'security'
  ];

  const lower = text.toLowerCase();
  return domainTerms.filter(term => lower.includes(term));
}
