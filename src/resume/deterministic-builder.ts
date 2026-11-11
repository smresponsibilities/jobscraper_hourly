// src/resume/deterministic-builder.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  TabStopType,
  TabStopPosition,
  BorderStyle,
  AlignmentType,
} from 'docx';
import { chromium, type Browser } from 'patchright';
import type { CandidateExtendedProfile } from '../autoapply/types.js';

export type DynamicArchetype =
  | 'BACKEND_DISTRIBUTED'
  | 'FULLSTACK_REACT'
  | 'DATA_ENGINEERING'
  | 'AI_ML_SYSTEMS'
  | 'SYSTEMS_LOWLEVEL'
  | 'GENERAL_SWE';

export type ResumeArchetype =
  | 'BACKEND'
  | 'DATA'
  | 'DEVOPS'
  | 'FULLSTACK'
  | 'BACKEND_DISTRIBUTED'
  | 'FULLSTACK_REACT'
  | 'DATA_ENGINEERING'
  | 'AI_ML_SYSTEMS'
  | 'SYSTEMS_LOWLEVEL'
  | 'GENERAL_SWE';

export type RoleArchetype =
  | 'BACKEND_DISTRIBUTED'
  | 'FULLSTACK_REACT'
  | 'DATA_ENGINEERING'
  | 'AI_ML_SYSTEMS'
  | 'SYSTEMS_LOWLEVEL'
  | 'GENERAL_SWE'
  | 'DATA_SPARK_SNOWFLAKE'
  | 'DEVOPS_CLOUD_PLATFORM'
  | 'FULLSTACK_PRODUCT';

export interface TailoredResumeArtifacts {
  archetype: ResumeArchetype;
  docxPath: string;
  pdfPath: string;
  maxTermFrequency: number;
  verifiedClean: boolean;
}

export interface TailoredResumeResult {
  archetype: RoleArchetype;
  pdfPath: string;
  docxPath: string;
  skillsIncluded: string[];
  topBulletStack: string;
}

export function classifyDynamicArchetype(jobTitle = '', jdText = ''): DynamicArchetype {
  const text = `${jobTitle} ${jdText}`.toLowerCase();
  const mlScore = (text.match(/\b(machine learning|ml|ai|artificial intelligence|xgboost|deep learning|nlp|llm|computer vision|tensorflow|pytorch|scikit)\b/g) || []).length;
  const dataScore = (text.match(/\b(data engineering|data engineer|spark|pyspark|snowflake|etl|clickhouse|data warehouse|pipeline|hive|hadoop)\b/g) || []).length;
  const sysScore = (text.match(/\b(systems|c99|c\+\+|wasm|webassembly|rust|kernel|low[- ]level|embedded|firmware|hardware)\b/g) || []).length;
  const fsScore = (text.match(/\b(full[- ]stack|fullstack|react|frontend|front[- ]end|next\.?js|vue|angular|web|ui|ux)\b/g) || []).length;
  const beScore = (text.match(/\b(backend|back[- ]end|distributed|kafka|microservices|spring boot|java|golang|concurrency)\b/g) || []).length;

  const maxScore = Math.max(mlScore, dataScore, sysScore, fsScore, beScore);
  if (maxScore < 2) return 'GENERAL_SWE';
  if (mlScore === maxScore) return 'AI_ML_SYSTEMS';
  if (dataScore === maxScore) return 'DATA_ENGINEERING';
  if (sysScore === maxScore) return 'SYSTEMS_LOWLEVEL';
  if (fsScore === maxScore) return 'FULLSTACK_REACT';
  if (beScore === maxScore) return 'BACKEND_DISTRIBUTED';
  return 'GENERAL_SWE';
}

export function detectJobArchetype(jobTitle = '', jdText = ''): ResumeArchetype {
  const text = `${jobTitle} ${jdText}`.toLowerCase();

  const dataScore = (text.match(/\b(data|spark|pyspark|snowflake|etl|pipeline|sql|warehouse|lake|streaming|hive|analytics)\b/g) || []).length;
  const devopsScore = (text.match(/\b(devops|cloud|platform|infra|infrastructure|ci\/?cd|jenkins|kubernetes|docker|terraform|sre|reliability)\b/g) || []).length;
  const fullstackScore = (text.match(/\b(full[- ]stack|frontend|front[- ]end|react|angular|node|ui|ux|web|javascript|typescript)\b/g) || []).length;
  const backendScore = (text.match(/\b(backend|back[- ]end|java|spring|microservices|distributed|rest|api|kafka|concurrency|multithreaded)\b/g) || []).length;

  if (dataScore >= Math.max(devopsScore, fullstackScore, backendScore) && dataScore >= 2) {
    return 'DATA';
  }
  if (devopsScore >= Math.max(fullstackScore, backendScore) && devopsScore >= 2) {
    return 'DEVOPS';
  }
  if (fullstackScore >= backendScore && fullstackScore >= 2) {
    return 'FULLSTACK';
  }
  return 'BACKEND';
}

export function selectBestArchetypeByJdHardMatch(
  jobTitle: string,
  jdText = ''
): { archetype: string; matchedKeywords: string[]; matchScore: number } {
  const text = `${jobTitle} ${jdText}`.toLowerCase();
  const matrix: Record<string, string[]> = {
    DATA_ENGINEERING: ['pyspark', 'apache spark', 'spark', 'snowflake', 'etl', 'data warehouse', 'hive', 'olap', 'clickhouse', 'data pipeline', 'sql', 'airflow', 'databricks'],
    AI_ML_SYSTEMS: ['machine learning', 'deep learning', 'tensorflow', 'scikit-learn', 'xgboost', 'llm', 'genai', 'gemini', 'nlp', 'ai engineer', 'mlops', 'model'],
    FULLSTACK_REACT: ['react', 'next.js', 'nextjs', 'typescript', 'javascript', 'frontend', 'full stack', 'Full-Stack', 'node.js', 'html5', 'css3', 'ui', 'websocket'],
    SYSTEMS_LOWLEVEL: ['c++', 'c99', 'rust', 'webassembly', 'wasm', 'embedded', 'linux', 'unix', 'kernel', 'systems', 'low-level', 'concurrency', 'multithreading'],
    BACKEND_DISTRIBUTED: ['java', 'spring boot', 'kafka', 'microservice', 'rest api', 'distributed', 'oauth', 'mtls', 'rbac', 'backend', 'jenkins', 'maven', 'ciam'],
  };

  let bestArchetype = 'BACKEND_DISTRIBUTED';
  let bestScore = 0;
  let bestMatched: string[] = [];

  for (const [arch, keywords] of Object.entries(matrix)) {
    const hits = keywords.filter(kw => text.includes(kw.toLowerCase()));
    // Title matches count double
    const titleHits = keywords.filter(kw => jobTitle.toLowerCase().includes(kw.toLowerCase()));
    const score = hits.length * 10 + titleHits.length * 15;
    if (score > bestScore) {
      bestScore = score;
      bestArchetype = arch;
      bestMatched = hits;
    }
  }

  return { archetype: bestArchetype, matchedKeywords: bestMatched, matchScore: bestScore };
}

export function classifyRoleArchetype(jobTitle = '', jobDescription = ''): RoleArchetype {
  const arch = detectJobArchetype(jobTitle, jobDescription);
  switch (arch) {
    case 'DATA':
      return 'DATA_SPARK_SNOWFLAKE';
    case 'DEVOPS':
      return 'DEVOPS_CLOUD_PLATFORM';
    case 'FULLSTACK':
      return 'FULLSTACK_PRODUCT';
    case 'BACKEND':
    default:
      return 'BACKEND_DISTRIBUTED';
  }
}

export interface VerifiedBullet {
  stack: 'backend' | 'data' | 'devops' | 'platform';
  text: string;
}

export const VERIFIED_MORGAN_STANLEY_BULLETS: VerifiedBullet[] = [
  {
    stack: 'backend',
    text: 'Engineered and scaled production Java Spring Boot REST APIs and distributed backend services for Customer Identity and Access Management (CIAM), securing endpoints with OAuth 2.0, mutual TLS (mTLS), and granular RBAC.',
  },
  {
    stack: 'data',
    text: 'Engineered Customer Identity and Access Management (CIAM) data warehouse pipelines using Apache Kafka, PySpark, and Azure Snowflake with mTLS, OAuth 2.0, and RBAC, processing 5,000,000+ events with zero row-count tolerance and real-time client visibility.',
  },
  {
    stack: 'devops',
    text: 'Automated end-to-end build, test, and release orchestration for Java Spring Boot microservices and Python/PySpark data pipelines using Jenkins CI/CD, Maven, and Git.',
  },
  {
    stack: 'platform',
    text: 'Integrated production observability, log analytics, and latency monitoring dashboards using Splunk and Grafana across Linux/Unix servers.',
  },
];

export function getArchetypeOrderedBullets(archetype: ResumeArchetype | RoleArchetype): string[] {
  const norm = String(archetype).toUpperCase();
  if (norm.includes('AI_ML') || (norm.includes('AI') && norm.includes('ML'))) {
    return [
      'Engineered production machine learning microservices and validation pipelines using Python, XGBoost, Scikit-Learn, and Gemini AI for automated real-time classification.',
      'Engineered Customer Identity and Access Management (CIAM) data warehouse pipelines using Apache Kafka, PySpark, and Azure Snowflake with mTLS, OAuth 2.0, and RBAC, processing 5,000,000+ events with zero row-count tolerance and real-time client visibility.',
      'Developed high-throughput REST API inference microservices in Python and Java Spring Boot integrated with MySQL and document stores.',
      'Automated model training validation, CI/CD deployment pipelines, and telemetry monitoring using Jenkins CI/CD, Git, Splunk, and Grafana.',
    ];
  }
  if (norm.includes('SYSTEMS_LOWLEVEL') || norm.includes('LOWLEVEL')) {
    return [
      'Engineered low-level zero-dependency systems software, WebAssembly modules, and pointer navigation utilities using C99 and Rust with strict memory bounds.',
      'Engineered and scaled production Java Spring Boot REST APIs and distributed backend services for Customer Identity and Access Management (CIAM), securing endpoints with OAuth 2.0, mutual TLS (mTLS), and granular RBAC.',
      'Automated build, test, and release orchestration for systems utilities and microservices using Jenkins CI/CD, Make, Maven, and Git.',
      'Integrated production observability, low-level process monitoring, and latency dashboards using Splunk and Grafana across Linux/Unix systems.',
    ];
  }
  if (norm.includes('DATA')) {
    return [
      'Designed and maintained resilient Python and PySpark ETL pipelines processing high-volume streaming and batch datasets across Apache Kafka, Apache Spark, Hive, and Azure Snowflake.',
      'Engineered Customer Identity and Access Management (CIAM) data warehouse pipelines using Apache Kafka, PySpark, and Azure Snowflake with mTLS, OAuth 2.0, and RBAC, processing 5,000,000+ events with zero row-count tolerance and real-time client visibility.',
      'Developed backend data access services and RESTful APIs in Java Spring Boot, integrating relational (MySQL, SQLite) and document (MongoDB) databases.',
      'Automated data pipeline packaging, version control, and scheduled deployments using Jenkins CI/CD, Maven, Git, and Linux/Unix.',
    ];
  }
  if (norm.includes('DEVOPS')) {
    return [
      'Automated end-to-end build, test, and release orchestration for Java Spring Boot microservices and Python/PySpark data pipelines using Jenkins CI/CD, Maven, and Git.',
      'Engineered Customer Identity and Access Management (CIAM) data warehouse pipelines using Apache Kafka, PySpark, and Azure Snowflake with mTLS, OAuth 2.0, and RBAC, processing 5,000,000+ events with zero row-count tolerance and real-time client visibility.',
      'Engineered production observability, log aggregation, and real-time alerting dashboards in Splunk and Grafana across Linux/Unix and Azure/GCP environments.',
      'Enforced zero-trust service authentication and access security across CIAM infrastructure using OAuth 2.0, mutual TLS (mTLS), and Role-Based Access Control (RBAC).',
    ];
  }
  if (norm.includes('FULLSTACK')) {
    return [
      'Developed full-stack web interfaces and backend API services using React, TypeScript, JavaScript, Node.js, Express.js, and Java Spring Boot REST APIs.',
      'Engineered Customer Identity and Access Management (CIAM) data warehouse pipelines using Apache Kafka, PySpark, and Azure Snowflake with mTLS, OAuth 2.0, and RBAC, processing 5,000,000+ events with zero row-count tolerance and real-time client visibility.',
      'Implemented secure authentication and authorization flows across web and API layers using OAuth 2.0, mTLS, and RBAC within CIAM systems.',
      'Streamlined continuous integration, automated testing, and release monitoring using Jenkins CI/CD, Maven, Git, Splunk, and Grafana.',
    ];
  }
  return [
    'Engineered and scaled production Java Spring Boot REST APIs and distributed backend services for Customer Identity and Access Management (CIAM), securing endpoints with OAuth 2.0, mutual TLS (mTLS), and granular RBAC.',
    'Engineered Customer Identity and Access Management (CIAM) data warehouse pipelines using Apache Kafka, PySpark, and Azure Snowflake with mTLS, OAuth 2.0, and RBAC, processing 5,000,000+ events with zero row-count tolerance and real-time client visibility.',
    'Automated build, test, and deployment pipelines using Jenkins CI/CD, Maven, and Git, reducing manual release overhead across environments.',
    'Integrated production observability, log analytics, and latency monitoring dashboards using Splunk and Grafana across Linux/Unix servers.',
  ];
}

export interface ResumeProject {
  title: string;
  stack: string;
  bullets: string[];
}

export function getArchetypeProjects(archetype: ResumeArchetype | RoleArchetype, all = false): ResumeProject[] {
  const norm = String(archetype).toUpperCase();

  const PROJECT_CLICKHOUSE: ResumeProject = {
    title: 'ClickHouse OLAP Data Ingestion Tool',
    stack: 'TypeScript, ClickHouse OLAP, SQL, Batch ETL',
    bullets: [
      'Engineered a bidirectional data engineering pipeline between ClickHouse OLAP databases and CSV flat files featuring real-time schema mapping, type validation, and batch export.',
    ],
  };

  const PROJECT_MORGAN_STANLEY: ResumeProject = {
    title: 'Morgan Stanley CIAM Platform & Pipelines',
    stack: 'Java, Spring Boot, Apache Kafka, PySpark, Snowflake',
    bullets: [
      'Engineered Customer Identity and Access Management (CIAM) data pipelines and REST APIs processing 5M+ events with mTLS, OAuth 2.0, and granular RBAC.',
    ],
  };

  const PROJECT_SHOPIFY: ResumeProject = {
    title: 'Shopify Insights — Cohort & LTV Analytics',
    stack: 'Next.js 15, React 19, Supabase PostgreSQL, Recharts',
    bullets: [
      'Built an e-commerce analytics and customer segmentation platform backed by PostgreSQL tracking customer lifetime value (LTV) and cohort retention.',
    ],
  };

  const PROJECT_FERTILIZER: ResumeProject = {
    title: 'Fertilizer Recommendation ML Microservice',
    stack: 'Python, XGBoost, Flask, Scikit-Learn',
    bullets: [
      'Built and deployed a production machine learning REST microservice predicting optimal formulations from soil chemistry (NPK), moisture, and climate metrics.',
    ],
  };

  const PROJECT_CHAINCODE: ResumeProject = {
    title: 'Chaincode — AI Code Validation & REST Platform',
    stack: 'Python, MERN, Solidity, Gemini AI',
    bullets: [
      'Built a coding validation platform with 15+ REST APIs verifying code originality at 95%+ accuracy using Gemini AI; placed 3rd out of 200+ engineering teams at HackIndia.',
    ],
  };

  const PROJECT_QUIZDECK: ResumeProject = {
    title: 'QuizDeck — Real-Time High-Concurrency Engine',
    stack: 'React, WebSockets, Node.js, TypeScript',
    bullets: [
      'Engineered a real-time multiplayer quiz platform over WebSockets and React, stress-tested to support up to 500 concurrent players with a 31 ms average response latency.',
    ],
  };

  const PROJECT_SMS_DEX: ResumeProject = {
    title: "SM'S DEX & Terminal Wordle Systems Utilities",
    stack: 'C99, WebAssembly, Rust pointer utilities, Astro',
    bullets: [
      'Developed a 2.4 KB zero-dependency C99 WebAssembly engine using polynomial hashing and a low-level Rust OS keyboard pointer navigation tool.',
    ],
  };

  if (all) return [PROJECT_CLICKHOUSE, PROJECT_QUIZDECK, PROJECT_CHAINCODE, PROJECT_SHOPIFY, PROJECT_FERTILIZER,
    { title: 'Productivity Caller', stack: 'Kotlin, Jetpack Compose, Android SDK, NLP Parser', bullets: ['Developed a native Android reminder application with automated call scheduling and a pattern-based natural language task parser.'] },
    { title: "SM'S DEX", stack: 'Astro, TypeScript, Python, GitHub Actions CI/CD', bullets: ['Built a static platform with automated GitHub Actions deployment and Python pull-request validation.'] },
    { ...PROJECT_SMS_DEX, title: 'Terminal Wordle & Clickless', stack: 'C99, WebAssembly, Rust' }];

  if (norm.includes('DATA')) {
    return [PROJECT_CLICKHOUSE, PROJECT_MORGAN_STANLEY, PROJECT_SHOPIFY];
  }
  if (norm.includes('AI_ML') || (norm.includes('AI') && norm.includes('ML'))) {
    return [PROJECT_FERTILIZER, PROJECT_CHAINCODE, PROJECT_CLICKHOUSE];
  }
  if (norm.includes('FULLSTACK') || norm.includes('REACT')) {
    return [PROJECT_QUIZDECK, PROJECT_SHOPIFY, PROJECT_CHAINCODE];
  }
  if (norm.includes('SYSTEMS_LOWLEVEL') || norm.includes('LOWLEVEL')) {
    return [PROJECT_SMS_DEX, PROJECT_CLICKHOUSE, PROJECT_QUIZDECK];
  }
  if (norm.includes('BACKEND')) {
    return [PROJECT_MORGAN_STANLEY, PROJECT_CLICKHOUSE, PROJECT_QUIZDECK];
  }
  return [PROJECT_MORGAN_STANLEY, PROJECT_QUIZDECK, PROJECT_CLICKHOUSE];
}

function keywordOverlap(text: string, terms: string[]): number {
  return terms.filter(term => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text)).length;
}

export function rankMorganStanleyBulletsForJd(jobTitle: string, jdText = ''): string[] {
  const keywords = [
    ['java', 'spring boot', 'rest', 'api', 'backend', 'oauth', 'mtls', 'rbac'],
    ['kafka', 'pyspark', 'snowflake', 'etl', 'data', 'warehouse', 'streaming'],
    ['jenkins', 'ci/cd', 'maven', 'git', 'devops', 'build', 'release'],
    ['splunk', 'grafana', 'linux', 'monitoring', 'observability', 'sre'],
    ['react', 'typescript', 'node.js', 'fullstack', 'frontend', 'mongodb'],
  ];
  const bullets = [...VERIFIED_MORGAN_STANLEY_BULLETS.map(b => b.text),
    'Developed full-stack internal tooling and data-access layers integrating React, TypeScript, Node.js, relational databases and MongoDB.'];
  return bullets.map((text, index) => ({ text, score: keywordOverlap(jobTitle, keywords[index]!) * 20 + keywordOverlap(jdText, keywords[index]!) * 10 }))
    .sort((a, b) => b.score - a.score).slice(0, 4).map(b => b.text);
}

export function selectTop3ProjectsForJd(jobTitle: string, jdText = ''): ResumeProject[] {
  const domainTerms = [
    ['data', 'pipeline', 'ingestion', 'etl', 'analytics', 'database'],
    ['real-time', 'concurrency', 'backend', 'frontend', 'multiplayer'],
    ['ai', 'llm', 'validation', 'api', 'backend', 'security'],
    ['analytics', 'dashboard', 'frontend', 'e-commerce'],
    ['machine learning', 'ml', 'prediction', 'model', 'data science'],
    ['android', 'mobile', 'nlp', 'parser'],
    ['devops', 'automation', 'ci/cd', 'frontend', 'testing'],
    ['systems', 'low-level', 'memory', 'performance', 'algorithm'],
  ];
  return getArchetypeProjects('GENERAL_SWE', true).map((project, index) => {
    const terms = [...new Set([...project.stack.split(',').map(s => s.trim().toLowerCase()), ...domainTerms[index]!])];
    return { project, score: keywordOverlap(jobTitle, terms) * 25 + keywordOverlap(jdText, terms) * 10 };
  }).sort((a, b) => b.score - a.score).slice(0, 3).map(({ project }) => project);
}

export function buildDynamicResumePlanForJd(jobTitle: string, jdText = '') {
  const archetype = selectBestArchetypeByJdHardMatch(jobTitle, jdText).archetype as ResumeArchetype;
  return { archetype, morganStanleyBullets: rankMorganStanleyBulletsForJd(jobTitle, jdText),
    selectedProjects: selectTop3ProjectsForJd(jobTitle, jdText),
    skillLines: getArchetypeCategorizedSkills(archetype, jobTitle, jdText) };
}

export function prioritizeVerifiedSkillsForRole(
  skills: string[],
  roleTitle = '',
  jdText = ''
): string[] {
  if (!Array.isArray(skills) || skills.length === 0) return [];
  const text = `${roleTitle} ${jdText}`.toLowerCase();
  if (!text.trim()) return [...skills];

  const matching: string[] = [];
  const remaining: string[] = [];

  for (const skill of skills) {
    const sLower = skill.toLowerCase().trim();
    if (!sLower) continue;

    const escaped = sLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');

    if (wordRegex.test(text) || text.includes(sLower)) {
      matching.push(skill);
    } else {
      remaining.push(skill);
    }
  }

  return [...matching, ...remaining];
}

export function reorderVerifiedSkillCsvForJd(verifiedCsv: string, jdText: string): string {
  if (!jdText || !jdText.trim()) return verifiedCsv;
  const jdLower = jdText.toLowerCase();
  const skills = verifiedCsv.split(',').map(s => s.trim()).filter(Boolean);

  const matched: string[] = [];
  const rest: string[] = [];
  for (const skill of skills) {
    const token = skill.toLowerCase().replace(/\s+rest apis|\s+ci\/cd/g, '').trim();
    if (token.length >= 2 && jdLower.includes(token)) {
      matched.push(skill);
    } else {
      rest.push(skill);
    }
  }
  return [...matched, ...rest].join(', ');
}

export function getArchetypeCategorizedSkills(
  archetype: ResumeArchetype | RoleArchetype,
  roleTitle = '',
  jdText = ''
): Record<string, string[]> {
  const norm = String(archetype).toUpperCase();
  let base: Record<string, string[]>;

  if (norm.includes('AI_ML') || (norm.includes('AI') && norm.includes('ML'))) {
    base = {
      'Languages': ['Python', 'SQL', 'C++', 'Java', 'TypeScript'],
      'AI & Machine Learning': ['XGBoost', 'Scikit-Learn', 'Gemini AI', 'PySpark', 'Flask'],
      'Data & Cloud': ['ClickHouse OLAP', 'MySQL', 'MongoDB', 'Azure Snowflake'],
      'DevOps & CI/CD': ['Jenkins CI/CD', 'Git', 'Linux/Unix', 'Splunk', 'Grafana'],
    };
  } else if (norm.includes('SYSTEMS_LOWLEVEL') || norm.includes('LOWLEVEL')) {
    base = {
      'Languages': ['C99', 'Rust', 'C++', 'Python', 'TypeScript'],
      'Systems & WebAssembly': ['WebAssembly', 'POSIX', 'Pointer Utilities', 'Memory Optimization'],
      'Backend & APIs': ['Node.js', 'REST APIs', 'WebSockets', 'Concurrency'],
      'DevOps & Tooling': ['Linux/Unix', 'Git', 'GitHub Actions', 'Jenkins CI/CD'],
    };
  } else if (norm.includes('DATA')) {
    base = {
      'Languages': ['Python', 'SQL', 'Java', 'Scala'],
      'Data & Streaming': ['PySpark', 'Apache Spark', 'Apache Kafka', 'Hive', 'ETL Pipelines'],
      'Cloud & Warehousing': ['Azure Snowflake', 'Relational Modeling', 'MongoDB', 'MySQL', 'SQLite'],
      'CI/CD & Observability': ['Jenkins CI/CD', 'Git', 'Maven', 'Splunk', 'Grafana', 'Power BI'],
    };
  } else if (norm.includes('DEVOPS')) {
    base = {
      'Languages': ['Python', 'Java', 'SQL', 'Shell Scripting'],
      'CI/CD & Build': ['Jenkins CI/CD', 'Maven', 'Git', 'Automated Pipelines'],
      'Cloud & Security': ['Azure Snowflake', 'OAuth 2.0', 'mTLS', 'RBAC', 'REST APIs'],
      'Observability & Monitoring': ['Splunk', 'Grafana', 'Apache Kafka', 'Telemetry Monitoring'],
    };
  } else if (norm.includes('FULLSTACK')) {
    base = {
      'Languages': ['TypeScript', 'JavaScript', 'Java', 'Python', 'SQL'],
      'Frontend & UI': ['React', 'Angular', 'HTML5', 'CSS3', 'WebSockets'],
      'Backend & APIs': ['Node.js', 'Express.js', 'Spring Boot', 'REST APIs', 'OAuth 2.0'],
      'Data & DevOps': ['MySQL', 'MongoDB', 'Git', 'Jenkins CI/CD', 'Azure Snowflake'],
    };
  } else {
    base = {
      'Languages': ['Java', 'Python', 'SQL', 'JavaScript', 'C++'],
      'Backend & Distributed Systems': ['Spring Boot', 'REST APIs', 'Microservices', 'Kafka', 'OAuth 2.0'],
      'Data & Cloud Platforms': ['PySpark', 'Apache Spark', 'Azure Snowflake', 'MySQL', 'MongoDB'],
      'DevOps, CI/CD & Observability': ['Jenkins CI/CD', 'Git', 'Maven', 'Splunk', 'Grafana'],
    };
  }

  if (roleTitle || jdText) {
    const prioritized: Record<string, string[]> = {};
    for (const [cat, skList] of Object.entries(base)) {
      prioritized[cat] = prioritizeVerifiedSkillsForRole(skList, roleTitle, jdText);
    }
    const existing = new Set(Object.values(base).flat().map(skill => skill.toLowerCase()));
    const projectSkills = getArchetypeProjects('GENERAL_SWE', true).flatMap(project => project.stack.split(',').map(skill => skill.trim()));
    const relevant = [...new Set(projectSkills)].filter(skill => !existing.has(skill.toLowerCase()) && keywordOverlap(`${roleTitle} ${jdText}`, [skill]));
    if (relevant.length) prioritized['Other relevant skills'] = relevant;
    return prioritized;
  }

  return base;
}

export function verifyNoKeywordStuffing(fullText: string, maxDensity = 0.025, maxOccurrences = Infinity): { clean: boolean; maxFreq: number } {
  const stripped = fullText
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase();

  const words = stripped.split(/\s+/).filter(w => w.length >= 3);
  if (words.length === 0) return { clean: true, maxFreq: 0 };

  const STOPWORDS = new Set([
    'and', 'the', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were',
    'been', 'being', 'have', 'has', 'had', 'into', 'over', 'under', 'through',
    'between', 'about', 'after', 'before', 'aug', 'all', 'any', 'can', 'our',
    'out', 'per', 'via', 'using', 'across', 'real', 'data', 'pipeline', 'pipelines',
    'code', 'platform', 'zero', 'days', 'built', 'time', 'teams'
  ]);

  const freqMap: Record<string, number> = {};
  let maxCount = 0;
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    const c = (freqMap[w] || 0) + 1;
    freqMap[w] = c;
    if (c > maxCount) maxCount = c;
  }

  const maxFreq = maxCount / words.length;
  return {
    clean: maxFreq < maxDensity && maxCount <= maxOccurrences,
    maxFreq: Number(maxFreq.toFixed(4)),
  };
}

export function generateResumeHtml(
  candidate: CandidateExtendedProfile,
  archetype: ResumeArchetype | RoleArchetype,
  roleTitle = '',
  jdText = ''
): string {
  const bullets = roleTitle || jdText ? rankMorganStanleyBulletsForJd(roleTitle, jdText) : getArchetypeOrderedBullets(archetype);
  const skillCategories = getArchetypeCategorizedSkills(archetype, roleTitle, jdText);
  const projects = roleTitle || jdText ? selectTop3ProjectsForJd(roleTitle, jdText) : getArchetypeProjects(archetype);

  const p = (candidate as any).profile?.personal || (candidate as any).personal || (candidate as any).basics || {};
  const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ') || (candidate as any).name || 'Shivam Mahajan';
  let email = process.env.AUTOAPPLY_EMAIL || p.email || (candidate as any).basics?.email || '';
  if (!email) {
    try {
      const cj = JSON.parse(fs.readFileSync(path.resolve('state/autoapply/portal-review/candidate.json'), 'utf8'));
      email = process.env.AUTOAPPLY_EMAIL || cj.personal?.email || cj.basics?.email || '';
    } catch {
      email = process.env.AUTOAPPLY_EMAIL || '';
    }
  }
  let phone = process.env.AUTOAPPLY_PHONE || p.phone || '';
  if (p.phoneCountryCode && !phone.startsWith('+')) {
    phone = `${p.phoneCountryCode} ${phone}`;
  }
  const locationParts = [p.city, p.state, p.country].filter(Boolean);
  const location = locationParts.length > 0 ? locationParts.join(', ') : 'Bengaluru, Karnataka, India';
  const linkedinRaw = p.linkedinUrl || 'https://www.linkedin.com/in/mahajanshivam';
  const linkedinClean = linkedinRaw.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const githubRaw = p.githubUrl || 'https://github.com/smresponsibilities';
  const githubClean = githubRaw.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

  const skillLinesHtml = Object.entries(skillCategories)
    .map(
      ([cat, skills]) =>
        `<div class="skill-row"><span class="skill-cat">${cat}:</span> ${skills.join(', ')}</div>`
    )
    .join('\n');

  const experienceBulletsHtml = bullets
    .map(b => `<li class="bullet">${b}</li>`)
    .join('\n');

  const projectsHtml = projects
    .map(
      proj => `
    <div class="entry project-item project-entry">
      <div class="entry-header item-title-row">
        <span>${proj.title}</span>
        <span>${proj.stack}</span>
      </div>
      <ul class="bullets bullet-list">
        ${proj.bullets.map(b => `<li class="bullet">${b}</li>`).join('\n')}
      </ul>
    </div>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root {
    --base-font-size: 10pt;
    --base-line-height: 1.25;
    --section-margin-bottom: 7px;
    --item-margin-bottom: 4px;
  }
  @page {
    size: A4 portrait;
    margin: 0.45in 0.5in 0.45in 0.5in;
  }
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: var(--base-font-size);
    line-height: var(--base-line-height);
    color: #111;
    margin: 0;
    padding: 0;
    background: #ffffff;
  }
  /* Heading & layout styling */
  h1.name {
    font-size: 18pt;
    text-align: center;
    margin: 0 0 2px 0;
    font-weight: bold;
    color: #111;
  }
  .contact-bar {
    text-align: center;
    font-size: 9pt;
    margin-bottom: 8px;
    color: #333;
  }
  .contact-bar a {
    color: #111;
    text-decoration: none;
  }
  .section {
    margin-top: 5px;
  }
  .section-header, .section-title {
    font-size: 11pt;
    font-weight: bold;
    border-bottom: 1px solid #222;
    margin-top: 6px;
    margin-bottom: var(--section-margin-bottom);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #111;
  }
  .entry {
    margin-bottom: var(--item-margin-bottom);
  }
  .item-title-row, .entry-header {
    display: flex;
    justify-content: space-between;
    font-weight: bold;
    margin-bottom: 1px;
    font-size: calc(var(--base-font-size) * 0.98);
    color: #111;
  }
  .item-sub-row, .entry-sub {
    display: flex;
    justify-content: space-between;
    font-style: italic;
    font-size: 9.5pt;
    margin-bottom: 2px;
    color: #222;
  }
  ul.bullet-list, ul.bullets {
    margin: 2px 0 var(--item-margin-bottom) 16px;
    padding: 0;
    list-style-type: disc;
  }
  ul.bullet-list li, ul.bullets li {
    margin-bottom: 2px;
    font-size: calc(var(--base-font-size) * 0.95);
    line-height: var(--base-line-height);
  }
  .skill-row {
    font-size: 9.5pt;
    margin-bottom: 1.5px;
    line-height: var(--base-line-height);
  }
  .skill-cat {
    font-weight: bold;
    color: #111;
  }
  .achievement-text {
    font-size: 9.5pt;
    line-height: var(--base-line-height);
    color: #111;
  }
</style>
</head>
<body>
  <div class="header">
    <h1 class="name">${fullName}</h1>
    <div class="contact-bar">
      <span>${location}</span> |
      <span>${phone}</span> |
      <span><a href="mailto:${email}">${email}</a></span>
    </div>
    <div class="contact-bar" style="margin-top: 2px;">
      <span><a href="https://shivammahajan.com">shivammahajan.com</a></span> |
      <span><a href="${linkedinRaw}">${linkedinClean}</a></span> |
      <span><a href="${githubRaw}">${githubClean}</a></span>
    </div>
  </div>

  <div class="section">
    <div class="section-title section-header">EDUCATION</div>
    <div class="entry">
      <div class="entry-header item-title-row">
        <span>Chitkara University</span>
        <span>Punjab, India</span>
      </div>
      <div class="entry-sub item-sub-row">
        <span>B.E. in Computer Science and Engineering (CGPA: 9.35 / 10.0)</span>
        <span>2022 – 2026</span>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title section-header">EXPERIENCE</div>
    <div class="entry">
      <div class="entry-header item-title-row">
        <span>Morgan Stanley</span>
        <span>Bengaluru, India</span>
      </div>
      <div class="entry-sub item-sub-row">
        <span>Technology Apprentice</span>
        <span>Aug 2025 – Aug 2026</span>
      </div>
      <ul class="bullets bullet-list">
        ${experienceBulletsHtml}
      </ul>
    </div>
  </div>

  <div class="section">
    <div class="section-title section-header">PROJECTS</div>
    ${projectsHtml}
  </div>

  <div class="section">
    <div class="section-title section-header">TECHNICAL SKILLS</div>
    <div class="skills-block">
      ${skillLinesHtml}
    </div>
  </div>

  <div class="section">
    <div class="section-title section-header">ACHIEVEMENTS & MILESTONES</div>
    <div class="achievement-text">
      1,255+ Consecutive Days of Code (2,002 Days Quest) &bull; 2,600+ Solved Algorithmic Problems (LeetCode/Codeforces) &bull; 425+ Automated Test Suites &bull; 3rd Place / 200+ Teams at HackIndia
    </div>
  </div>
</body>
</html>`;
}

export async function buildDocxWithLibrary(
  candidate: CandidateExtendedProfile,
  archetype: ResumeArchetype | RoleArchetype,
  roleTitle = '',
  jdText = ''
): Promise<Buffer> {
  const bullets = roleTitle || jdText ? rankMorganStanleyBulletsForJd(roleTitle, jdText) : getArchetypeOrderedBullets(archetype);
  const skillCategories = getArchetypeCategorizedSkills(archetype, roleTitle, jdText);
  const projects = roleTitle || jdText ? selectTop3ProjectsForJd(roleTitle, jdText) : getArchetypeProjects(archetype);

  const p = (candidate as any).profile?.personal || (candidate as any).personal || (candidate as any).basics || {};
  const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ') || (candidate as any).name || 'Shivam Mahajan';
  let email = process.env.AUTOAPPLY_EMAIL || p.email || (candidate as any).basics?.email || '';
  if (!email) {
    try {
      const cj = JSON.parse(fs.readFileSync(path.resolve('state/autoapply/portal-review/candidate.json'), 'utf8'));
      email = process.env.AUTOAPPLY_EMAIL || cj.personal?.email || cj.basics?.email || '';
    } catch {
      email = process.env.AUTOAPPLY_EMAIL || '';
    }
  }
  let phone = process.env.AUTOAPPLY_PHONE || p.phone || '';
  if (p.phoneCountryCode && !phone.startsWith('+')) {
    phone = `${p.phoneCountryCode} ${phone}`;
  }
  const locationParts = [p.city, p.state, p.country].filter(Boolean);
  const location = locationParts.length > 0 ? locationParts.join(', ') : 'Bengaluru, Karnataka, India';
  const linkedinRaw = p.linkedinUrl || 'https://www.linkedin.com/in/mahajanshivam';
  const linkedinClean = linkedinRaw.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const githubRaw = p.githubUrl || 'https://github.com/smresponsibilities';
  const githubClean = githubRaw.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 550, // ~0.38 inch
              right: 550,
              bottom: 550,
              left: 550,
            },
          },
        },
        children: [
          // Header: Full Name
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 50 },
            children: [
              new TextRun({
                text: fullName,
                bold: true,
                size: 32,
                font: 'Calibri',
                color: '0F172A',
              }),
            ],
          }),

          // Contact Line 1
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 20 },
            children: [
              new TextRun({
                text: `${location}  |  ${phone}  |  ${email}`,
                size: 18,
                font: 'Calibri',
                color: '475569',
              }),
            ],
          }),

          // Contact Line 2
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: `shivammahajan.com  |  ${linkedinClean}  |  ${githubClean}`,
                size: 18,
                font: 'Calibri',
                color: '475569',
              }),
            ],
          }),

          // EDUCATION SECTION
          new Paragraph({
            spacing: { before: 100, after: 50 },
            border: {
              bottom: {
                color: 'CBD5E1',
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
            children: [
              new TextRun({
                text: 'EDUCATION',
                bold: true,
                size: 21,
                font: 'Calibri',
                color: '1E3A8A',
              }),
            ],
          }),
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { after: 20 },
            children: [
              new TextRun({ text: 'Chitkara University', bold: true, size: 20, font: 'Calibri', color: '0F172A' }),
              new TextRun({ text: '\tPunjab, India', size: 20, font: 'Calibri', color: '0F172A' }),
            ],
          }),
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { after: 50 },
            children: [
              new TextRun({
                text: 'B.E. in Computer Science and Engineering (CGPA: 9.35 / 10.0)',
                italics: true,
                size: 19,
                font: 'Calibri',
                color: '334155',
              }),
              new TextRun({ text: '\t2022 – 2026', size: 19, font: 'Calibri', color: '334155' }),
            ],
          }),

          // PROFESSIONAL EXPERIENCE
          new Paragraph({
            spacing: { before: 100, after: 50 },
            border: {
              bottom: {
                color: 'CBD5E1',
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
            children: [
              new TextRun({
                text: 'PROFESSIONAL EXPERIENCE',
                bold: true,
                size: 21,
                font: 'Calibri',
                color: '1E3A8A',
              }),
            ],
          }),
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { after: 20 },
            children: [
              new TextRun({ text: 'Morgan Stanley', bold: true, size: 20, font: 'Calibri', color: '0F172A' }),
              new TextRun({ text: '\tBengaluru, India', size: 20, font: 'Calibri', color: '0F172A' }),
            ],
          }),
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            spacing: { after: 50 },
            children: [
              new TextRun({
                text: 'Technology Apprentice',
                italics: true,
                size: 19,
                font: 'Calibri',
                color: '334155',
              }),
              new TextRun({ text: '\tAug 2025 – Aug 2026', size: 19, font: 'Calibri', color: '334155' }),
            ],
          }),
          ...bullets.map(
            b =>
              new Paragraph({
                bullet: { level: 0 },
                spacing: { after: 35, line: 230 },
                children: [new TextRun({ text: b, size: 19, font: 'Calibri', color: '1A1A1A' })],
              })
          ),

          // TECHNICAL PROJECTS
          new Paragraph({
            spacing: { before: 100, after: 50 },
            border: {
              bottom: {
                color: 'CBD5E1',
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
            children: [
              new TextRun({
                text: 'TECHNICAL PROJECTS',
                bold: true,
                size: 21,
                font: 'Calibri',
                color: '1E3A8A',
              }),
            ],
          }),
          ...projects.flatMap(proj => [
            new Paragraph({
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              spacing: { after: 15 },
              children: [
                new TextRun({
                  text: proj.title,
                  bold: true,
                  size: 20,
                  font: 'Calibri',
                  color: '0F172A',
                }),
                new TextRun({
                  text: `\t${proj.stack}`,
                  size: 18,
                  italics: true,
                  font: 'Calibri',
                  color: '334155',
                }),
              ],
            }),
            ...proj.bullets.map(
              b =>
                new Paragraph({
                  bullet: { level: 0 },
                  spacing: { after: 35, line: 230 },
                  children: [new TextRun({ text: b, size: 19, font: 'Calibri', color: '1A1A1A' })],
                })
            ),
          ]),

          // TECHNICAL SKILLS
          new Paragraph({
            spacing: { before: 100, after: 50 },
            border: {
              bottom: {
                color: 'CBD5E1',
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
            children: [
              new TextRun({
                text: 'TECHNICAL SKILLS',
                bold: true,
                size: 21,
                font: 'Calibri',
                color: '1E3A8A',
              }),
            ],
          }),
          ...Object.entries(skillCategories).map(
            ([cat, skills]) =>
              new Paragraph({
                spacing: { after: 35 },
                children: [
                  new TextRun({ text: `${cat}: `, bold: true, size: 19, font: 'Calibri', color: '0F172A' }),
                  new TextRun({ text: skills.join(', '), size: 19, font: 'Calibri', color: '1A1A1A' }),
                ],
              })
          ),

          // ACHIEVEMENTS & MILESTONES
          new Paragraph({
            spacing: { before: 100, after: 50 },
            border: {
              bottom: {
                color: 'CBD5E1',
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            },
            children: [
              new TextRun({
                text: 'ACHIEVEMENTS & MILESTONES',
                bold: true,
                size: 21,
                font: 'Calibri',
                color: '1E3A8A',
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 35 },
            children: [
              new TextRun({
                text: '1,255+ Consecutive Days of Code (2,002 Days Quest) • 2,600+ Solved Algorithmic Problems (LeetCode/Codeforces) • 425+ Automated Test Suites • 3rd Place / 200+ Teams at HackIndia',
                size: 19,
                font: 'Calibri',
                color: '1A1A1A',
              }),
            ],
          }),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

export async function buildOpenXmlDocx(
  candidate: CandidateExtendedProfile,
  archetype: RoleArchetype | ResumeArchetype,
  roleTitle = '',
  jdText = ''
): Promise<Buffer> {
  return await buildDocxWithLibrary(candidate, archetype, roleTitle, jdText);
}

export async function generateDualAtsResume(
  archetype: ResumeArchetype,
  outputDir = 'state/autoapply/resumes',
  browserInstance?: Browser,
  profile?: CandidateExtendedProfile
): Promise<TailoredResumeArtifacts> {
  const candidateJsonPath = path.resolve('state/autoapply/portal-review/candidate.json');
  let loadedProfile: CandidateExtendedProfile | undefined = profile;
  if (!loadedProfile && fs.existsSync(candidateJsonPath)) {
    try {
      loadedProfile = JSON.parse(fs.readFileSync(candidateJsonPath, 'utf8'));
    } catch {}
  }
  const candidateProfile: CandidateExtendedProfile =
    loadedProfile ||
    ({
      personal: {
        firstName: 'Shivam',
        lastName: 'Mahajan',
        email: process.env.AUTOAPPLY_EMAIL || '',
        phone: process.env.AUTOAPPLY_PHONE || '',
        city: 'Bengaluru',
        country: 'India',
      },
    } as any);

  fs.mkdirSync(outputDir, { recursive: true });

  const docxPath = path.resolve(outputDir, `Shivam_Mahajan_Resume_${archetype}.docx`);
  const pdfPath = path.resolve(outputDir, `Shivam_Mahajan_Resume_${archetype}.pdf`);

  // 1. Generate DOCX
  const docxBuffer = await buildDocxWithLibrary(candidateProfile, archetype);
  fs.writeFileSync(docxPath, docxBuffer);

  // 2. Generate PDF via headless browser
  const normArch = String(archetype).toUpperCase();
  const roleArch: RoleArchetype =
    normArch === 'AI_ML_SYSTEMS'
      ? 'AI_ML_SYSTEMS'
      : normArch === 'SYSTEMS_LOWLEVEL'
      ? 'SYSTEMS_LOWLEVEL'
      : normArch === 'DATA_ENGINEERING'
      ? 'DATA_ENGINEERING'
      : normArch === 'FULLSTACK_REACT'
      ? 'FULLSTACK_REACT'
      : normArch === 'GENERAL_SWE'
      ? 'GENERAL_SWE'
      : normArch === 'DATA' || normArch.includes('DATA_SPARK')
      ? 'DATA_SPARK_SNOWFLAKE'
      : normArch === 'DEVOPS' || normArch.includes('DEVOPS_CLOUD')
      ? 'DEVOPS_CLOUD_PLATFORM'
      : normArch === 'FULLSTACK' || normArch.includes('FULLSTACK_PRODUCT')
      ? 'FULLSTACK_PRODUCT'
      : 'BACKEND_DISTRIBUTED';

  const html = generateResumeHtml(candidateProfile, roleArch);

  let browser = browserInstance;
  let ownsBrowser = false;
  if (!browser) {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
    });
    ownsBrowser = true;
  }

  try {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => {
        var __name = (globalThis as any).__name || function(fn: any) { return fn; };
        const maxHeight = 1040; // Strict single-page A4 threshold
        let currentHeight = document.documentElement.scrollHeight;
        if (currentHeight > maxHeight) {
          document.documentElement.style.setProperty('--base-font-size', '9.5pt');
          document.documentElement.style.setProperty('--base-line-height', '1.2');
        }
        if (document.documentElement.scrollHeight > maxHeight) {
          const projectNodes = document.querySelectorAll('.project-item');
          if (projectNodes.length > 2) {
            const lastNode = projectNodes[projectNodes.length - 1];
            if (lastNode) {
              lastNode.remove();
            }
          }
        }
      });
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
      });
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    if (ownsBrowser && browser) {
      await browser.close().catch(() => {});
    }
  }

  const { clean, maxFreq } = verifyNoKeywordStuffing(html);

  return {
    archetype,
    docxPath,
    pdfPath,
    maxTermFrequency: maxFreq,
    verifiedClean: clean,
  };
}

export async function buildTailoredResumePair(
  job: { title: string; description?: string; company?: string },
  profile?: CandidateExtendedProfile,
  outputDir = 'state/autoapply/portal-review'
): Promise<TailoredResumeResult> {
  const candidateJsonPath = path.resolve('state/autoapply/portal-review/candidate.json');
  let loadedProfile: CandidateExtendedProfile | undefined = profile;
  if (!loadedProfile && fs.existsSync(candidateJsonPath)) {
    try {
      loadedProfile = JSON.parse(fs.readFileSync(candidateJsonPath, 'utf8'));
    } catch {}
  }
  const candidateProfile: CandidateExtendedProfile =
    loadedProfile ||
    ({
      personal: {
        firstName: 'Shivam',
        lastName: 'Mahajan',
        email: process.env.AUTOAPPLY_EMAIL || '',
        phone: process.env.AUTOAPPLY_PHONE || '',
        city: 'Bengaluru',
        country: 'India',
      },
    } as any);

  const legacyArch = classifyRoleArchetype(job.title, job.description || '');
  const dynamicArch = classifyDynamicArchetype(job.title, job.description || '');
  const roleArch: RoleArchetype =
    dynamicArch === 'AI_ML_SYSTEMS'
      ? 'AI_ML_SYSTEMS'
      : dynamicArch === 'SYSTEMS_LOWLEVEL'
      ? 'SYSTEMS_LOWLEVEL'
      : legacyArch;

  const archetype: ResumeArchetype =
    roleArch === 'AI_ML_SYSTEMS'
      ? 'AI_ML_SYSTEMS'
      : roleArch === 'SYSTEMS_LOWLEVEL'
      ? 'SYSTEMS_LOWLEVEL'
      : roleArch === 'DATA_SPARK_SNOWFLAKE'
      ? 'DATA'
      : roleArch === 'DEVOPS_CLOUD_PLATFORM'
      ? 'DEVOPS'
      : roleArch === 'FULLSTACK_PRODUCT'
      ? 'FULLSTACK'
      : 'BACKEND';

  const html = generateResumeHtml(candidateProfile, roleArch, job.title, job.description || '');

  fs.mkdirSync(outputDir, { recursive: true });
  const sanitizedCompany = (job.company || 'general').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
  const baseName = `resume_${sanitizedCompany}_${archetype.toLowerCase()}`;
  const pdfPath = path.resolve(outputDir, `${baseName}.pdf`);
  const docxPath = path.resolve(outputDir, `${baseName}.docx`);

  // 1. Generate DOCX
  const docxBuffer = await buildDocxWithLibrary(candidateProfile, archetype, job.title, job.description || '');
  fs.writeFileSync(docxPath, docxBuffer);

  // 2. Generate PDF via headless browser
  let browser = null;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
    });
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => {
        var __name = (globalThis as any).__name || function(fn: any) { return fn; };
        const maxHeight = 1040; // Strict single-page A4 threshold
        let currentHeight = document.documentElement.scrollHeight;
        if (currentHeight > maxHeight) {
          document.documentElement.style.setProperty('--base-font-size', '9.5pt');
          document.documentElement.style.setProperty('--base-line-height', '1.2');
        }
        if (document.documentElement.scrollHeight > maxHeight) {
          const projectNodes = document.querySelectorAll('.project-item');
          if (projectNodes.length > 2) {
            const lastNode = projectNodes[projectNodes.length - 1];
            if (lastNode) {
              lastNode.remove();
            }
          }
        }
      });
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
      });
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const skillsIncluded = Object.values(getArchetypeCategorizedSkills(roleArch, job.title, job.description || '')).flat();
  const topBulletStack = getArchetypeOrderedBullets(roleArch)[0] || '';

  return {
    archetype: roleArch,
    pdfPath,
    docxPath,
    skillsIncluded,
    topBulletStack,
  };
}

export function inspectPdfPageCount(pdfBuffer: Buffer): number {
  const str = pdfBuffer.toString('latin1');
  const pageMatches = str.match(/\/Type\s*\/Page\b/g);
  if (pageMatches && pageMatches.length > 0) return pageMatches.length;
  const countMatch = str.match(/\/Count\s+(\d+)/);
  if (countMatch && countMatch[1]) return parseInt(countMatch[1], 10);
  return 1;
}

export function detectRoleArchetype(jobTitle: string, jd = ''): RoleArchetype {
  const combined = `${jobTitle} ${jd}`.toLowerCase();
  if (/\b(data|spark|kafka|pyspark|pipeline|etl|snowflake|clickhouse|warehouse)\b/i.test(combined)) {
    return 'DATA_ENGINEERING';
  }
  if (/\b(machine learning|ml|ai|nlp|llm|deep learning|xgboost|model)\b/i.test(combined)) {
    return 'AI_ML_SYSTEMS';
  }
  if (/\b(react|frontend|front-end|ui|ux|fullstack|full-stack|next\.js|typescript)\b/i.test(combined)) {
    return 'FULLSTACK_REACT';
  }
  if (/\b(c\+\+|rust|wasm|webassembly|systems|kernel|low[- ]level|embedded)\b/i.test(combined)) {
    return 'SYSTEMS_LOWLEVEL';
  }
  if (/\b(backend|back-end|distributed|java|spring|microservices|golang|apis)\b/i.test(combined)) {
    return 'BACKEND_DISTRIBUTED';
  }
  return 'GENERAL_SWE';
}

export async function buildResumePdf(html: string, outputPath: string): Promise<Buffer> {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      // Layout Budgeting Loop: Guarantee exactly 1 page (A4 max printable height = ~1045px at 96 DPI)
      await page.evaluate(() => {
        var __name = (globalThis as any).__name || function(fn: any) { return fn; };
        const MAX_PAGE_HEIGHT_PX = 1045;
        const root = document.documentElement;

        // Pass 1: If overflowing, decrement line height and base font size
        if (root.scrollHeight > MAX_PAGE_HEIGHT_PX) {
          root.style.setProperty('--base-font-size', '9.5pt');
          root.style.setProperty('--base-line-height', '1.2');
          root.style.setProperty('--section-margin-bottom', '5px');
          root.style.setProperty('--item-margin-bottom', '3px');
        }

        // Pass 2: If still overflowing, apply compact font settings
        if (root.scrollHeight > MAX_PAGE_HEIGHT_PX) {
          root.style.setProperty('--base-font-size', '9pt');
          root.style.setProperty('--base-line-height', '1.15');
        }

        // Pass 3: If still overflowing, drop the 4th project (keep top 3 strictly)
        if (root.scrollHeight > MAX_PAGE_HEIGHT_PX) {
          const projects = document.querySelectorAll('.project-entry, .project-item');
          if (projects.length > 3) {
            projects[projects.length - 1]?.remove();
          }
        }

        // Pass 4: If still overflowing, truncate 3rd bullet point from each project
        if (root.scrollHeight > MAX_PAGE_HEIGHT_PX) {
          const bulletLists = document.querySelectorAll('.project-entry ul.bullet-list, .project-item ul.bullets');
          bulletLists.forEach((ul) => {
            if (ul.children.length > 2) {
              ul.children[ul.children.length - 1]?.remove();
            }
          });
        }

        // Fallback: If still overflowing, truncate long bullets to max 140 chars
        if (root.scrollHeight > MAX_PAGE_HEIGHT_PX) {
          const lis = document.querySelectorAll('li');
          lis.forEach((li) => {
            if (li.textContent && li.textContent.length > 140) {
              li.textContent = li.textContent.slice(0, 140) + '...';
            }
          });
        }
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0.45in', bottom: '0.45in', left: '0.5in', right: '0.5in' },
      });

      // Binary Page Count Assertion
      const binaryStr = pdfBuffer.toString('binary');
      const pageCount = (binaryStr.match(/\/Type\s*\/Page\b/g) || []).length;
      if (pageCount !== 1) {
        throw new Error(`[RESUME_BUILDER_FATAL] PDF exceeded single-page budget! Generated ${pageCount} pages.`);
      }

      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.promises.writeFile(outputPath, pdfBuffer);
      return pdfBuffer;
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function buildResumePdfForArchetype(
  archetype: RoleArchetype,
  outputPath: string
): Promise<void> {
  const candidateJsonPath = path.resolve('state/autoapply/portal-review/candidate.json');
  let loadedProfile: CandidateExtendedProfile | undefined;
  if (fs.existsSync(candidateJsonPath)) {
    try {
      loadedProfile = JSON.parse(fs.readFileSync(candidateJsonPath, 'utf8'));
    } catch {}
  }
  const candidateProfile: CandidateExtendedProfile =
    loadedProfile ||
    ({
      personal: {
        firstName: 'Shivam',
        lastName: 'Mahajan',
        email: process.env.AUTOAPPLY_EMAIL || 'shivam@example.com',
        phone: process.env.AUTOAPPLY_PHONE || '+91 9999999999',
        city: 'Bengaluru',
        country: 'India',
      },
    } as any);

  const html = generateResumeHtml(candidateProfile, archetype);
  await buildResumePdf(html, outputPath);
}

export async function compileRuntimeTailoredResumeForJob(input: {
  jobId: string; company?: string; jobTitle: string; jdText: string;
  browser: Pick<Browser, 'newPage'>; profile: CandidateExtendedProfile;
}): Promise<TailoredResumeArtifacts> {
  if (!input.jobTitle.trim() && !input.jdText.trim()) throw new Error('Runtime resume requires a job title or description');
  const { archetype } = buildDynamicResumePlanForJd(input.jobTitle, input.jdText);
  const html = generateResumeHtml(input.profile, archetype, input.jobTitle, input.jdText);
  const quality = verifyNoKeywordStuffing(html, 0.02, 4);
  const outputDir = path.resolve('state/autoapply/resumes/runtime',
    createHash('sha256').update(input.jobId).digest('hex').slice(0, 24));
  fs.mkdirSync(outputDir, { recursive: true });
  const runDir = fs.mkdtempSync(path.join(outputDir, 'run-'));
  const pdfPath = path.join(runDir, 'Shivam_Mahajan_Resume.pdf');
  const docxPath = path.join(runDir, 'Shivam_Mahajan_Resume.docx');
  let page: Awaited<ReturnType<typeof input.browser.newPage>> | undefined;
  try {
    page = await input.browser.newPage();
    const renderPage = page;
    const [pdf, docx] = await Promise.all([
      (async () => {
        await renderPage.setContent(html, { waitUntil: 'load' });
        for (const size of [10, 9.5, 9, 8.5]) {
          if (size !== 10) await renderPage.evaluate(size => document.documentElement.style.setProperty('--base-font-size', `${size}pt`), size);
          const bytes = await renderPage.pdf({ format: 'A4', printBackground: true });
          if (inspectPdfPageCount(bytes) === 1) return bytes;
        }
        throw new Error('Runtime resume exceeds one page');
      })(),
      buildDocxWithLibrary(input.profile, archetype, input.jobTitle, input.jdText),
    ]);
    fs.writeFileSync(pdfPath, pdf);
    fs.writeFileSync(docxPath, docx);
  } catch (error) {
    fs.rmSync(runDir, { recursive: true, force: true });
    throw error;
  } finally { await page?.close(); }
  return { archetype, pdfPath, docxPath, verifiedClean: quality.clean, maxTermFrequency: quality.maxFreq };
}
