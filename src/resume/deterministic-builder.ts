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
import { chromium, type Browser, type Page } from 'patchright';
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
  url?: string;
}

export function getArchetypeProjects(archetype: ResumeArchetype | RoleArchetype, all = false, fullPortfolio = false): ResumeProject[] {
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

  if (all && !fullPortfolio) return [PROJECT_CLICKHOUSE, PROJECT_QUIZDECK, PROJECT_CHAINCODE, PROJECT_SHOPIFY, PROJECT_FERTILIZER,
    { title: 'Productivity Caller', stack: 'Kotlin, Jetpack Compose, Android SDK, NLP Parser', bullets: ['Developed a native Android reminder application with automated call scheduling and a pattern-based natural language task parser.'] },
    { title: "SM'S DEX", stack: 'Astro, TypeScript, Python, GitHub Actions CI/CD', bullets: ['Built a static platform with automated GitHub Actions deployment and Python pull-request validation.'] },
    { ...PROJECT_SMS_DEX, title: 'Terminal Wordle & Clickless', stack: 'C99, WebAssembly, Rust' }];

  if (all) return [
    { title: 'Productivity Caller', stack: 'Kotlin, Jetpack Compose, Android SDK, NLP Parser', bullets: ['Developed an Android reminder application with scheduled calls and a pattern-based natural language parser.'], url: 'https://shivammahajan.com/projects/productivity-caller/' },
    { title: "SM'S DEX", stack: 'Astro, TypeScript, Python, GitHub Actions CI/CD', bullets: ['Built a static platform with automated GitHub Actions deployment and Python pull-request validation.'], url: 'https://shivammahajan.com/projects/sm-dex/' },
    { ...PROJECT_CHAINCODE, url: 'https://shivammahajan.com/projects/chaincode/' },
    { ...PROJECT_QUIZDECK, url: 'https://github.com/smresponsibilities/QuizDeck' },
    { ...PROJECT_SHOPIFY, url: 'https://github.com/smresponsibilities/Xeno2' },
    { ...PROJECT_CLICKHOUSE, url: 'https://github.com/smresponsibilities/Ingestion-Tool' },
    { ...PROJECT_FERTILIZER, url: 'https://github.com/smresponsibilities/fertilizertypeapi' },
    { title: 'JobScraper Hourly', stack: 'TypeScript, Node.js, ATS Scraping', bullets: ['Built an automated crawler that sends hourly job alerts from company ATS boards.'], url: 'https://github.com/smresponsibilities/jobscraper_hourly' },
    { title: 'Flight Sun Tracker', stack: 'TypeScript, Canvas, Aviation Math', bullets: ['Built an interactive tool for flight paths and sun exposure relative to passenger seating.'], url: 'https://shivammahajan.com/projects/flight-sun-tracker/' },
    { title: 'Postie', stack: 'JavaScript, Fetch API, LocalStorage', bullets: ['Built a browser-based HTTP API client with request editing and local history.'], url: 'https://shivammahajan.com/projects/postie/' },
    { title: 'Python Game Arcade', stack: 'Python, Terminal ASCII', bullets: ['Built a command-line arcade with five mini-games.'], url: 'https://github.com/smresponsibilities/Gamehub' },
    { title: 'Clickless', stack: 'Rust, Low-Level OS Hooks', bullets: ['Built a keyboard-driven pointer navigation tool with an on-screen target grid.'], url: 'https://github.com/smresponsibilities/clickless' },
    { title: 'Terminal Wordle', stack: 'C99, WebAssembly, Terminal ANSI', bullets: ['Built a terminal Wordle game with a C99 WebAssembly engine.'], url: 'https://shivammahajan.com/projects/wordle/' },
    { title: '2002 Days of Code Challenge', stack: 'Python, Kotlin, Java, Algorithms', bullets: ['Maintained a multi-year coding and algorithm practice project.'], url: 'https://github.com/smresponsibilities/1001daysofcode' },
  ];

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

export function getPortfolioProjects(): ResumeProject[] {
  return getArchetypeProjects('BACKEND', true, true);
}

export function generateComplementaryCoverLetterText(params: { companyName: string; jobTitle: string; jdText: string; resumeSelectedProjectIds?: string[] }): { text: string; wordCount: number; citedProjects: string[]; keywordDensityOk: boolean } {
  const company = params.companyName.trim();
  const role = params.jobTitle.trim();
  if (!company || !role || company.length > 100 || role.length > 120 || /[\x00-\x1f\x7f]/.test(company + role)) throw new Error('Company and role are required');
  const normalizeId = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const firstResumeId = normalizeId(params.resumeSelectedProjectIds?.[0] || '');
  const projects = getPortfolioProjects().filter(project => {
    const id = normalizeId(project.title);
    return !firstResumeId || (id !== firstResumeId && !(firstResumeId.length >= 4 && id.startsWith(`${firstResumeId} `)));
  });
  const candidates = projects.map(project => ({ id: project.title, text: `${project.title} ${project.stack} ${project.bullets.join(' ')}`, project }));
  const weights = tokenizeJdAndExtractWeights(params.jdText, role);
  const selected = selectItemsViaSubmodularMmr(candidates, weights, 2).selected.map(candidate => candidate.project);
  if (selected.length !== 2) throw new Error('Two portfolio projects are required');
  const [first, second] = selected as [ResumeProject, ResumeProject];
  const text = [
    `Dear ${company} hiring team,`,
    `I am applying for the ${role} position at ${company}. My background combines software development with data engineering. As a Technology Apprentice at Morgan Stanley, I worked with Java Spring Boot, Apache Kafka, PySpark, Spark, Hive and Azure Snowflake on customer identity and access management, processing more than 5,000,000 events. That experience introduced me to the practical demands of handling data and building software within a large organization.`,
    `My independent work offers additional examples relevant to this application. ${first.title}: ${first.bullets[0]} ${second.title}: ${second.bullets[0]} These projects cover different parts of the development process, from understanding a problem and choosing an approach to implementing and reviewing a working result. You can explore the projects, their source code and further technical context at https://shivammahajan.com/projects/. I would be glad to discuss the design decisions and tradeoffs behind either example.`,
    `For this role, I would bring the experience gained from both the apprenticeship and these independent projects. I value clear requirements, careful implementation and the opportunity to learn from feedback. I would welcome a conversation about the work your team needs and how my background could contribute. Thank you for considering my application. I am available to start immediately and can provide further details or examples upon request.`,
    `Sincerely,\nShivam Mahajan`,
  ].join('\n\n');
  const keywords = ['java', 'python', 'pyspark', 'kafka', 'spark', 'snowflake', 'typescript', 'javascript', 'react', 'rust', 'c99', 'webassembly', 'node.js', 'next.js', 'sql', 'postgresql', 'clickhouse', 'kotlin', 'flask', 'xgboost'];
  const keywordDensityOk = keywords.every(keyword => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (text.match(new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'gi')) || []).length <= 4;
  });
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 180 || wordCount > 280) throw new Error('Cover letter word count is outside the required range');
  if (!keywordDensityOk) throw new Error('Cover letter keyword density requires review');
  return { text, wordCount, citedProjects: selected.map(project => project.title), keywordDensityOk };
}

function keywordOverlap(text: string, terms: string[]): number {
  return terms.filter(term => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text)).length;
}

const RESUME_STOPWORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were',
  'been', 'being', 'have', 'has', 'had', 'into', 'over', 'under', 'through',
  'between', 'about', 'after', 'before', 'aug', 'all', 'any', 'can', 'our',
  'out', 'per', 'via', 'using', 'across', 'real', 'code', 'days', 'built',
  'time', 'teams', 'work', 'working', 'experience', 'responsible', 'skills',
  'role', 'job', 'years', 'strong', 'knowledge', 'understanding', 'ability',
  'excellent', 'good', 'must', 'plus', 'including', 'such', 'well', 'candidate',
  'position', 'company', 'preferred', 'requirements', 'qualifications', 'duties'
]);

export function extractNormalizedTokens(text: string): string[] {
  if (!text) return [];
  const clean = text.toLowerCase()
    .replace(/[^\w\s+#.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const rawWords = clean.split(' ').filter(w => w.length >= 2 && !RESUME_STOPWORDS.has(w));
  
  const phrases: string[] = [];
  const knownPhrases = [
    'spring boot', 'machine learning', 'deep learning', 'data engineering', 'data warehouse',
    'full stack', 'front end', 'back end', 'apache kafka', 'apache spark', 'azure snowflake',
    'rest api', 'rest apis', 'restful api', 'ci/cd', 'oauth 2.0', 'oauth 2', 'mutual tls',
    'role-based access', 'rbac', 'clickhouse olap', 'web assembly', 'webassembly',
    'high concurrency', 'distributed systems', 'microservices', 'object oriented',
    'sql', 'nosql', 'unit testing', 'test driven', 'scikit-learn', 'xgboost', 'next.js',
    'react', 'typescript', 'javascript', 'python', 'java', 'golang', 'rust', 'c99', 'c++'
  ];
  for (const phrase of knownPhrases) {
    if (clean.includes(phrase)) {
      phrases.push(phrase);
    }
  }

  return [...new Set([...rawWords, ...phrases])];
}

export function tokenizeJdAndExtractWeights(jdText: string, jobTitle: string): Map<string, number> {
  const weights = new Map<string, number>();
  if (!jdText && !jobTitle) return weights;

  const jdTokens = extractNormalizedTokens(jdText);
  const titleTokens = extractNormalizedTokens(jobTitle);
  const titleSet = new Set(titleTokens);

  const STACK_TOKENS = new Set([
    'python', 'java', 'typescript', 'javascript', 'golang', 'rust', 'c++', 'c99', 'sql',
    'react', 'next.js', 'node.js', 'spring', 'spring boot', 'kafka', 'apache kafka',
    'spark', 'pyspark', 'apache spark', 'snowflake', 'azure snowflake', 'clickhouse',
    'docker', 'kubernetes', 'jenkins', 'git', 'ci/cd', 'rest', 'api', 'microservices',
    'mongodb', 'mysql', 'postgresql', 'sqlite', 'redis', 'graphql', 'aws', 'azure', 'gcp',
    'xgboost', 'scikit-learn', 'gemini', 'llm', 'ai', 'ml', 'machine learning', 'webassembly'
  ]);

  for (const token of jdTokens) {
    let weight = 1.0;
    if (titleSet.has(token)) {
      weight *= 2.5; // 2.5x weight to tokens appearing in jobTitle
    }
    if (STACK_TOKENS.has(token)) {
      weight *= 1.5; // 1.5x weight to required stack tokens
    }
    weights.set(token, weight);
  }

  for (const token of titleTokens) {
    if (!weights.has(token)) {
      let weight = 2.5;
      if (STACK_TOKENS.has(token)) weight *= 1.5;
      weights.set(token, weight);
    }
  }

  return weights;
}

export function computeJaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function selectItemsViaSubmodularMmr<T extends { id: string; text: string; tokens?: string[] }>(
  candidates: T[],
  jdWeights: Map<string, number>,
  k: number,
  lambda = 0.65,
  saturationCap = 2,
  initialTokenCounts?: Map<string, number>
): { selected: T[]; tokenCounts: Map<string, number> } {
  if (!candidates || candidates.length === 0) {
    return { selected: [], tokenCounts: new Map(initialTokenCounts || []) };
  }

  const prepared = candidates.map(c => ({
    ...c,
    tokens: c.tokens && c.tokens.length > 0 ? c.tokens : extractNormalizedTokens(c.text)
  }));

  const selected: T[] = [];
  const selectedPrepared: typeof prepared = [];
  const remaining = [...prepared];
  const tokenCounts = new Map<string, number>(initialTokenCounts || []);

  const effectiveK = Math.min(k, candidates.length);

  while (selected.length < effectiveK && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]!;

      // 1. Marginal coverage utility with saturation ceiling (tau_w = 2)
      let marginalGain = 0;
      for (const tok of cand.tokens) {
        if (jdWeights.has(tok)) {
          const currentCount = tokenCounts.get(tok) || 0;
          if (currentCount < saturationCap) {
            marginalGain += jdWeights.get(tok)!;
          }
        }
      }

      // 2. Diversity penalty against already chosen items
      let maxSim = 0;
      if (selectedPrepared.length > 0) {
        for (const s of selectedPrepared) {
          const sim = computeJaccardSimilarity(cand.tokens, s.tokens);
          if (sim > maxSim) maxSim = sim;
        }
      }

      const score = lambda * marginalGain - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      bestIdx = 0;
    }

    const chosen = remaining.splice(bestIdx, 1)[0]!;
    selected.push(chosen as unknown as T);
    selectedPrepared.push(chosen);

    for (const tok of chosen.tokens) {
      if (jdWeights.has(tok)) {
        tokenCounts.set(tok, (tokenCounts.get(tok) || 0) + 1);
      }
    }
  }

  return { selected, tokenCounts };
}

export function rankMorganStanleyBulletsForJd(jobTitle: string, jdText = ''): string[] {
  try {
    const jdWeights = tokenizeJdAndExtractWeights(jdText, jobTitle);
    const candidateBullets = [
      ...VERIFIED_MORGAN_STANLEY_BULLETS.map(b => b.text),
      'Developed full-stack internal tooling and data-access layers integrating React, TypeScript, Node.js, relational databases and MongoDB.',
      'Engineered production machine learning microservices and validation pipelines using Python, XGBoost, Scikit-Learn, and Gemini AI for automated real-time classification.',
      'Engineered low-level zero-dependency systems software, WebAssembly modules, and pointer navigation utilities using C99 and Rust with strict memory bounds.',
      'Designed and maintained resilient Python and PySpark ETL pipelines processing high-volume streaming and batch datasets across Apache Kafka, Apache Spark, Hive, and Azure Snowflake.',
    ];

    const uniqueCandidates = [...new Set(candidateBullets)].map((text, idx) => ({
      id: `bullet_${idx}`,
      text,
      tokens: extractNormalizedTokens(text)
    }));

    const result = selectItemsViaSubmodularMmr(uniqueCandidates, jdWeights, 4, 0.65, 2);
    if (result.selected.length === 4) {
      return result.selected.map(b => b.text);
    }
  } catch (err: any) {
    console.warn(`[GEN-530-FALLBACK] Submodular MMR bullet selection error: ${err?.message || err}. Falling back to default order.`);
  }

  return VERIFIED_MORGAN_STANLEY_BULLETS.map(b => b.text);
}

export function selectTop3ProjectsForJd(
  jobTitle: string,
  jdText = '',
  initialTokenCounts?: Map<string, number>
): ResumeProject[] {
  try {
    const jdWeights = tokenizeJdAndExtractWeights(jdText, jobTitle);
    const allProjects = getArchetypeProjects('GENERAL_SWE', true);
    const projectCandidates = allProjects.map((p, idx) => ({
      id: p.title,
      text: `${p.title} ${p.stack} ${p.bullets.join(' ')}`,
      tokens: extractNormalizedTokens(`${p.title} ${p.stack} ${p.bullets.join(' ')}`),
      project: p
    }));

    const result = selectItemsViaSubmodularMmr(
      projectCandidates,
      jdWeights,
      3,
      0.65,
      2,
      initialTokenCounts
    );
    if (result.selected.length === 3) {
      return result.selected.map(s => (s as any).project);
    }
  } catch (err: any) {
    console.warn(`[GEN-530-FALLBACK] Submodular MMR project selection error: ${err?.message || err}. Falling back to default order.`);
  }

  return getArchetypeProjects('BACKEND', false);
}

export function buildDynamicResumePlanForJd(jobTitle: string, jdText = '') {
  const archetype = selectBestArchetypeByJdHardMatch(jobTitle, jdText).archetype as ResumeArchetype;
  const jdWeights = tokenizeJdAndExtractWeights(jdText, jobTitle);
  
  let selectedBullets: string[] = [];
  let bulletTokenCounts = new Map<string, number>();
  try {
    const candidateBullets = [
      ...VERIFIED_MORGAN_STANLEY_BULLETS.map(b => b.text),
      'Developed full-stack internal tooling and data-access layers integrating React, TypeScript, Node.js, relational databases and MongoDB.',
      'Engineered production machine learning microservices and validation pipelines using Python, XGBoost, Scikit-Learn, and Gemini AI for automated real-time classification.',
      'Engineered low-level zero-dependency systems software, WebAssembly modules, and pointer navigation utilities using C99 and Rust with strict memory bounds.',
      'Designed and maintained resilient Python and PySpark ETL pipelines processing high-volume streaming and batch datasets across Apache Kafka, Apache Spark, Hive, and Azure Snowflake.',
    ];
    const uniqueCandidates = [...new Set(candidateBullets)].map((text, idx) => ({
      id: `bullet_${idx}`,
      text,
      tokens: extractNormalizedTokens(text)
    }));
    const res = selectItemsViaSubmodularMmr(uniqueCandidates, jdWeights, 4, 0.65, 2);
    selectedBullets = res.selected.map(b => b.text);
    bulletTokenCounts = res.tokenCounts;
  } catch {
    selectedBullets = VERIFIED_MORGAN_STANLEY_BULLETS.map(b => b.text);
  }

  const selectedProjects = selectTop3ProjectsForJd(jobTitle, jdText, bulletTokenCounts);

  return {
    archetype,
    morganStanleyBullets: selectedBullets.length === 4 ? selectedBullets : rankMorganStanleyBulletsForJd(jobTitle, jdText),
    selectedProjects,
    skillLines: getArchetypeCategorizedSkills(archetype, jobTitle, jdText)
  };
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
    'code', 'platform', 'zero', 'days', 'built', 'time', 'teams', 'com'
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

export function enforceGlobalTermFrequencyCeiling(htmlContent: string, maxLimit = 4): string {
  const SYNONYM_MAP: Record<string, string[]> = {
    'engineered': ['developed', 'architected', 'implemented', 'built'],
    'pipeline': ['system', 'workflow', 'stream', 'architecture'],
    'pipelines': ['systems', 'workflows', 'streams', 'architectures'],
    'services': ['endpoints', 'modules', 'components', 'handlers'],
    'microservices': ['backend services', 'distributed services', 'modular services'],
    'validation': ['verification', 'assurance', 'checking', 'screening'],
    'monitoring': ['observability', 'telemetry', 'analytics', 'tracking'],
    'concurrency': ['parallelism', 'throughput', 'multi-threading'],
    'databases': ['datastores', 'storage engines', 'repositories'],
    'react': ['frontend UI', 'component UI', 'web framework'],
    'webassembly': ['Wasm', 'binary format', 'compiled bytecode'],
    'python': ['scripting runtime', 'backend service', 'runtime']
  };

  let modifiedHtml = htmlContent;

  // Prune redundant "Apache" qualifiers when over ceiling
  const apacheMatches = modifiedHtml.match(/\bApache\s+(Kafka|Spark)\b/gi);
  if (apacheMatches && apacheMatches.length > maxLimit) {
    let aCount = 0;
    modifiedHtml = modifiedHtml.replace(/\bApache\s+(Kafka|Spark)\b/gi, (match, p1) => {
      aCount++;
      if (aCount > maxLimit) return p1;
      return match;
    });
  }
  for (const [term, synonyms] of Object.entries(SYNONYM_MAP)) {
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    const matches = modifiedHtml.match(regex);
    if (matches && matches.length > maxLimit) {
      let count = 0;
      let synIdx = 0;
      modifiedHtml = modifiedHtml.replace(regex, (match) => {
        count++;
        if (count > maxLimit && synIdx < synonyms.length) {
          const replacement = synonyms[synIdx++]!;
          if (match[0] === match[0]?.toUpperCase()) {
            return replacement.charAt(0).toUpperCase() + replacement.slice(1);
          }
          return replacement;
        }
        return match;
      });
    }
  }

  return modifiedHtml;
}

function verifiedResumeContacts(candidate: CandidateExtendedProfile) {
  const person = candidate.personal;
  const fullName = (person?.fullName || [person?.firstName, person?.lastName].filter(Boolean).join(' ')).trim();
  // This catalogue contains candidate-specific work and education facts.
  if (!/^shivam\s+mahajan$/i.test(fullName)) throw new Error('Candidate-specific resume requires the matching profile');
  const safeUrl = (value?: string) => {
    try { const url = new URL(value || ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  };
  const phone = person.phone || process.env.AUTOAPPLY_PHONE || '';
  return {
    fullName,
    email: person.email || process.env.AUTOAPPLY_EMAIL || '',
    phone: person.phoneCountryCode && phone && !phone.startsWith('+') ? `${person.phoneCountryCode} ${phone}` : phone,
    location: [person.city, person.state, person.country].filter(Boolean).join(', '),
    linkedin: safeUrl(person.linkedinUrl),
    github: safeUrl(person.githubUrl),
  };
}

const escapeResumeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export function generateResumeHtml(
  candidate: CandidateExtendedProfile,
  archetype: ResumeArchetype | RoleArchetype,
  roleTitle = '',
  jdText = ''
): string {
  let bullets: string[];
  let projects: ResumeProject[];
  let skillCategories: Record<string, string[]>;

  if (roleTitle || jdText) {
    const plan = buildDynamicResumePlanForJd(roleTitle, jdText);
    bullets = plan.morganStanleyBullets;
    projects = plan.selectedProjects;
    skillCategories = plan.skillLines;
  } else {
    bullets = getArchetypeOrderedBullets(archetype);
    projects = getArchetypeProjects(archetype);
    skillCategories = getArchetypeCategorizedSkills(archetype, roleTitle, jdText);
  }

  const contacts = verifiedResumeContacts(candidate);
  const fullName = escapeResumeHtml(contacts.fullName);
  const email = escapeResumeHtml(contacts.email);
  const phone = escapeResumeHtml(contacts.phone);
  const location = escapeResumeHtml(contacts.location);
  const linkedinRaw = escapeResumeHtml(contacts.linkedin);
  const linkedinClean = escapeResumeHtml(contacts.linkedin.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));
  const githubRaw = escapeResumeHtml(contacts.github);
  const githubClean = escapeResumeHtml(contacts.github.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));

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

  const htmlContent = `<!DOCTYPE html>
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
      ${[location, phone, email ? `<a href="mailto:${email}">${email}</a>` : ''].filter(Boolean).map(item => `<span>${item}</span>`).join(' | ')}
    </div>
    <div class="contact-bar" style="margin-top: 2px;">
      ${['<a href="https://shivammahajan.com">shivammahajan.com</a>', linkedinRaw ? `<a href="${linkedinRaw}">${linkedinClean}</a>` : '', githubRaw ? `<a href="${githubRaw}">${githubClean}</a>` : ''].filter(Boolean).map(item => `<span>${item}</span>`).join(' | ')}
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
  return enforceGlobalTermFrequencyCeiling(htmlContent, 4);
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

  const { fullName, email, phone, location, linkedin, github } = verifiedResumeContacts(candidate);
  const linkedinClean = linkedin.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const githubClean = github.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

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
                text: [location, phone, email].filter(Boolean).join('  |  '),
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
                text: ['shivammahajan.com', linkedinClean, githubClean].filter(Boolean).join('  |  '),
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
  if (!pdfBuffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 0;
  const str = pdfBuffer.toString('latin1');
  const pageMatches = str.match(/\/Type\s*\/Page\b/g);
  if (pageMatches && pageMatches.length > 0) return pageMatches.length;
  const countMatch = str.match(/\/Count\s+(\d+)/);
  if (countMatch && countMatch[1]) return parseInt(countMatch[1], 10);
  return 0;
}

/**
 * Ticket GEN-538: PDF Visual Bounding-Box & Margin Overflow Inspector.
 * Verifies exact 1-page count, minimum buffer size, and checks text-positioning streams
 * to ensure content does not breach the bottom margin (y < 18pt).
 */
export function verifyPdfVisualGeometry(pdfBuffer: Buffer): {
  pageCount: number;
  validSinglePage: boolean;
  byteSize: number;
  hasOverflowWarning: boolean;
  geometryVerified: boolean;
} {
  const pageCount = inspectPdfPageCount(pdfBuffer);
  const byteSize = pdfBuffer.length;
  // Raw stream inspection cannot prove the final geometry of a compressed PDF.
  let hasOverflowWarning = true;

  // 1. Hard check: page count must be 1 and size > 5000 bytes
  if (pageCount !== 1 || byteSize < 5000) {
    return {
      pageCount,
      validSinglePage: false,
      byteSize,
      hasOverflowWarning: true,
      geometryVerified: false,
    };
  }

  // 2. Scan raw or uncompressed PDF text-positioning streams
  try {
    const rawLatin = pdfBuffer.toString('latin1');
    // Look for Tm matrix or Td positioning operators with negative y-offsets below bottom threshold
    // Formats: [a b c d e f] Tm where f is y-position, or tx ty Td
    const tmRegex = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm/g;
    let match: RegExpExecArray | null;
    while ((match = tmRegex.exec(rawLatin)) !== null) {
      const yVal = parseFloat(match[2] || '0');
      // In A4 PDF (842pt height), 0 is bottom edge. Anything y < 18pt is in the margin overflow zone
      if (yVal > 0 && yVal < 18) {
        hasOverflowWarning = true;
        break;
      }
    }
  } catch {}

  return {
    pageCount,
    validSinglePage: pageCount === 1,
    byteSize,
    hasOverflowWarning,
    geometryVerified: false,
  };
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

/** Check printed text bounds in the same page used to render the PDF. */
export async function verifyPrintableResumeLayout(page: Page): Promise<{ valid: boolean; overflowCount: number }> {
  return page.evaluate(() => {
    const width = 698, height = 1035;
    const body = document.body;
    if (!body) return { valid: false, overflowCount: 1 };
    const origin = body.getBoundingClientRect();
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let overflowCount = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0 && (rect.left < origin.left - 1 || rect.right > origin.left + width + 1 || rect.top < origin.top - 1 || rect.bottom > origin.top + height + 1)) overflowCount++;
      }
      range.detach();
    }
    return { valid: overflowCount === 0, overflowCount };
  });
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
      await page.setViewportSize({ width: 698, height: 1035 });
      await page.emulateMedia({ media: 'print' });
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      await page.evaluate(async () => { await document.fonts.ready; });

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

      const layout = await verifyPrintableResumeLayout(page);
      if (!layout.valid) throw new Error(`Resume text exceeds printable bounds (${layout.overflowCount} fragments)`);
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
        await renderPage.setViewportSize({ width: 698, height: 1035 });
        await renderPage.emulateMedia({ media: 'print' });
        await renderPage.setContent(html, { waitUntil: 'load' });
        await renderPage.evaluate(async () => { await document.fonts.ready; });
        for (const size of [10, 9.5, 9, 8.5]) {
          if (size !== 10) await renderPage.evaluate(size => document.documentElement.style.setProperty('--base-font-size', `${size}pt`), size);
          const layout = await verifyPrintableResumeLayout(renderPage);
          if (!layout.valid) continue;
          const bytes = await renderPage.pdf({ format: 'A4', printBackground: true });
          if (inspectPdfPageCount(bytes) === 1 && bytes.length >= 5000) return bytes;
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
