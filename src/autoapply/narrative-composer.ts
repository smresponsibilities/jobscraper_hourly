import type { CandidateExtendedProfile } from './types.js';
import { getArchetypeProjects, getPortfolioProjects, type ResumeProject } from '../resume/deterministic-builder.js';

function projectFact(project: ResumeProject): { title: string; url: string; stack: string; metricSummary: string; factKey: string } {
  const metric = /morgan stanley/i.test(project.title) ? 'Processed more than 5,000,000 CIAM events.'
    : /quizdeck/i.test(project.title) ? 'Stress-tested with 500 concurrent players and 31 ms latency.'
    : /chaincode/i.test(project.title) ? 'Includes 15+ REST APIs and 95%+ accuracy; placed third among 200+ teams at HackIndia.'
    : /shopify/i.test(project.title) ? 'Includes customer lifetime value and cohort analytics.'
    : /sm.s dex/i.test(project.title) ? 'Includes more than 1,300 static pages.'
    : /wordle/i.test(project.title) ? 'Includes a 2.4 KB C99 WebAssembly engine.'
    : /productivity caller/i.test(project.title) ? 'Includes an Android natural-language task parser.' : '';
  return { title: project.title, url: project.url || 'https://shivammahajan.com/projects/', stack: project.stack, metricSummary: metric,
    factKey: `projectCatalog.${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}` };
}

export function lookupPortfolioProjectFact(factKey: string): ReturnType<typeof projectFact> | undefined {
  return [...getPortfolioProjects(), ...getArchetypeProjects('BACKEND')].map(projectFact).find(project => project.factKey === factKey);
}

/** Select from the existing candidate project catalogue; no invented deep links. */
export function selectBestPortfolioProjectForQuestion(questionAndJdText: string): { title: string; url: string; stack: string; metricSummary: string; factKey: string } {
  const projects = getPortfolioProjects();
  const morgan = getArchetypeProjects('BACKEND').find(project => /morgan stanley/i.test(project.title))!;
  const text = String(questionAndJdText || '').toLowerCase();
  const score = (title: string): number => {
    const rules: Array<[RegExp, RegExp, number]> = [
      [/clickhouse/i, /\b(?:clickhouse|olap|etl|data pipeline|data engineering|warehouse)\b/g, 4],
      [/quizdeck/i, /\b(?:quizdeck|websockets?|realtime|real.time|concurrency|concurrent|multiplayer)\b/g, 5],
      [/chaincode/i, /\b(?:chaincode|llm|gemini|solidity|web3|generative ai|machine learning|\bml\b)\b/g, 4],
      [/shopify/i, /\b(?:shopify|next\.js|nextjs|fullstack|full.stack|cohort|ltv|postgresql|analytics)\b/g, 4],
      [/fertilizer/i, /\b(?:fertilizer|xgboost|scikit.learn|flask|soil|formulation)\b/g, 5],
      [/productivity caller/i, /\b(?:android|kotlin|jetpack|mobile|productivity caller)\b/g, 5],
      [/sm's dex/i, /\b(?:astro|sm.s dex|static pages|static site)\b/g, 4],
      [/clickless/i, /\b(?:clickless|rust|pointer navigation|cursor|os hooks)\b/g, 5],
      [/wordle/i, /\b(?:wordle|c99|webassembly|wasm)\b/g, 5],
      [/jobscraper/i, /\b(?:jobscraper|job scraper|ats scraping|job alerts|crawler|automation|scraping|distributed queues?)\b/g, 5],
      [/flight sun/i, /\b(?:flight sun|aviation|flight paths|sun exposure|aircraft|shade)\b/g, 5],
      [/postie/i, /\b(?:postie|api testing|http client|postman)\b/g, 5],
      [/game arcade/i, /\b(?:game arcade|gamehub|hangman|dice roll)\b/g, 5],
      [/days of code/i, /\b(?:days of code|coding challenge|leetcode|algorithm practice)\b/g, 5],
    ];
    return rules.filter(([project]) => project.test(title)).reduce((total, [, terms, weight]) => total + (text.match(terms)?.length || 0) * weight, 0) + (text.includes(title.toLowerCase()) ? 20 : 0);
  };
  const ranked = projects.map(project => ({ project, score: score(project.title) })).sort((a, b) => b.score - a.score);
  const selected = ranked[0]?.score ? ranked[0].project : morgan;
  return projectFact(selected);
}

/** Return a project answer only for this catalogue's owner and an explicit project prompt. */
export function composePortfolioProjectNarrative(question: string, profile: CandidateExtendedProfile): { text: string; factKey: string } | null {
  const name = (profile.personal.fullName || [profile.personal.firstName, profile.personal.lastName].filter(Boolean).join(' ')).trim();
  if (!/^shivam\s+mahajan$/i.test(name)) return null;
  if (!/\b(?:project(?:s)?|code sample|github link|technical challenge)\b/i.test(question)) return null;
  if (/\b(?:conflict|failure|outage|mistake|disagreement|weakness|unethical|disciplinary)\b/i.test(question)) return null;
  const project = selectBestPortfolioProjectForQuestion(question);
  return { text: [project.title + '.', project.metricSummary, `Stack: ${project.stack}.`, `Project: ${project.url}`].filter(Boolean).join(' '), factKey: project.factKey };
}

/** Compose only from the candidate's provided project catalogue or experience excerpts. */
export function composeGroundedNarrative(
  question: string,
  profile: CandidateExtendedProfile,
  _companyName?: string,
  _roleTitle?: string
): string | null {
  const q = question.trim();
  if (!q || /\b(?:consent|agree|certify|attest|convict|felon|discharge|resign|license|clearance|background check|drug test|non[- ]compete|arbitrat|waive|sms|conflict|failure|outage|mistake|disagreement|weakness|not on your resume)\b/i.test(q)) return null;
  if (/^(?:are|do|have|will|can|were|did|is|would|who|when|where|how\s+many|how\s+much)\s+/i.test(q)) return null;
  if (/\b(?:release tool|release tooling)\b/i.test(q) && /\b(?:go|golang|ruby)\b/i.test(q)) return null;
  const project = composePortfolioProjectNarrative(q, profile);
  if (project) return project.text;
  const terms = q.toLowerCase().match(/jenkins|maven|git\b|ci\/?cd|continuous integration|release|deployment|build|spark|kafka|pyspark|snowflake|java\b|spring|rest|api\b|python|splunk|grafana|oauth|mtls|rbac|distributed|backend|data|etl/g) || [];
  const aliases: Record<string, string[]> = { 'ci/cd': ['continuous integration', 'jenkins'], release: ['jenkins', 'maven', 'git'], build: ['jenkins', 'maven', 'build'], deployment: ['jenkins', 'deployment'], distributed: ['kafka', 'spark'], backend: ['spring', 'rest', 'backend'], data: ['spark', 'snowflake', 'etl', 'data'] };
  const keywords = [...new Set(terms.flatMap(term => aliases[term] || [term]))];
  if (!keywords.length) return null;
  const excerpts = (profile.experience || []).flatMap(entry => (entry.description || '').split(/\n+|(?<=[.!?])\s+/).map(text => text.trim()).filter(text => text.length >= 20 && keywords.some(keyword => text.toLowerCase().includes(keyword))));
  const result = [...new Set(excerpts)].join('\n');
  return result && verifyTruthfulNarrative(result, profile) ? result : null;
}

export function verifyTruthfulNarrative(text: string, profile?: CandidateExtendedProfile): boolean {
  if (!text || text.length < 20 || text.length > 1500) return false;
  // Never claim >= 2 years of professional experience
  if (/\b([2-9]|\d{2,})\+?\s*years?\s+of\s+(professional|work|industry)\s+experience\b/i.test(text)) {
    return false;
  }
  // Never falsely claim affirmative authorship of Go/Ruby/Rust tools
  if (/\bi\s+(built|created|authored|wrote)\s+[^.]*\b(in\s+go|in\s+golang|in\s+ruby|in\s+rust)\b/i.test(text)) {
    return false;
  }
  // Never falsely claim ungrounded technologies not in candidate skills/experience
  if (/kubernetes/i.test(text) && (!profile?.skills || !profile.skills.includes('Kubernetes'))) {
    return false;
  }
  return true;
}
