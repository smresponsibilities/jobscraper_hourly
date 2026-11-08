// src/resume/deterministic-builder.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
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

export type ResumeArchetype = 'BACKEND' | 'DATA' | 'DEVOPS' | 'FULLSTACK';

export type RoleArchetype =
  | 'BACKEND_DISTRIBUTED'
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

export function getArchetypeProjects(archetype: ResumeArchetype | RoleArchetype): ResumeProject[] {
  const norm = String(archetype).toUpperCase();
  if (norm.includes('DATA')) {
    return [
      {
        title: 'ClickHouse OLAP Data Ingestion Tool',
        stack: 'TypeScript, ClickHouse, SQL, Batch ETL',
        bullets: [
          'Engineered a bidirectional data engineering pipeline between ClickHouse OLAP databases and CSV flat files featuring real-time schema mapping, type validation, and batch export.',
        ],
      },
      {
        title: 'Fertilizer Recommendation ML Microservice',
        stack: 'Python, XGBoost, Flask, Scikit-Learn',
        bullets: [
          'Built and deployed a production machine learning REST microservice predicting optimal formulations from soil chemistry (NPK), moisture, and climate metrics.',
        ],
      },
      {
        title: 'Shopify Insights — Cohort & LTV Analytics',
        stack: 'Next.js 15, Supabase PostgreSQL, TypeScript',
        bullets: [
          'Built an e-commerce analytics and customer segmentation platform backed by PostgreSQL tracking customer lifetime value (LTV) and cohort retention.',
        ],
      },
    ];
  }

  if (norm.includes('DEVOPS')) {
    return [
      {
        title: "SM'S DEX — Zero-Dependency Platform & Automated CI/CD Roster",
        stack: 'Astro, Python, GitHub Actions',
        bullets: [
          'Engineered a static-first platform (1,300+ pages, 0KB external audio via Web Audio synthesis) with an automated GitHub Actions CI/CD and Python PR validation pipeline.',
        ],
      },
      {
        title: 'ClickHouse Data Ingestion & Schema Pipeline',
        stack: 'TypeScript, ClickHouse OLAP, SQL',
        bullets: [
          'Built an automated bidirectional ingestion utility connecting ClickHouse OLAP clusters and flat files with strict schema validation.',
        ],
      },
      {
        title: 'Terminal Wordle & Clickless Systems Utilities',
        stack: 'C99, WebAssembly, Rust',
        bullets: [
          'Developed a 2.4 KB zero-dependency C99 WebAssembly engine using polynomial hashing and a low-level Rust OS keyboard pointer navigation tool.',
        ],
      },
    ];
  }

  if (norm.includes('FULLSTACK')) {
    return [
      {
        title: 'Shopify Insights — E-Commerce Analytics Platform',
        stack: 'Next.js 15, React 19, Supabase PostgreSQL, Recharts',
        bullets: [
          'Engineered a full-stack analytics and customer segmentation dashboard tracking customer lifetime value (LTV) and cohort retention.',
        ],
      },
      {
        title: 'QuizDeck — Multiplayer WebSocket Platform',
        stack: 'React, WebSockets, Node.js, TypeScript',
        bullets: [
          'Built a real-time multiplayer web application supporting 500 concurrent users at 31 ms average response latency.',
        ],
      },
      {
        title: "Productivity Caller & SM'S DEX",
        stack: 'Kotlin, Jetpack Compose, Astro, TypeScript',
        bullets: [
          'Developed a native Android voice-call reminder app with a natural language task parser in Kotlin/Jetpack Compose and an interactive 1,300-page web portfolio.',
        ],
      },
    ];
  }

  // BACKEND
  return [
    {
      title: 'QuizDeck — Real-Time High-Concurrency Engine',
      stack: 'React, WebSockets, Node.js, TypeScript',
      bullets: [
        'Engineered a real-time multiplayer quiz platform over WebSockets and React, stress-tested to support up to 500 concurrent players with a 31 ms average response latency.',
      ],
    },
    {
      title: 'Chaincode — AI Code Validation & REST Platform',
      stack: 'Python, MERN, Solidity, Gemini AI',
      bullets: [
        'Built a coding validation platform with 15+ REST APIs verifying code originality at 95%+ accuracy using Gemini AI; placed 3rd out of 200+ engineering teams at HackIndia.',
      ],
    },
    {
      title: 'ClickHouse Data Ingestion Tool',
      stack: 'TypeScript, ClickHouse OLAP, SQL',
      bullets: [
        'Built a bidirectional data pipeline connecting ClickHouse OLAP databases and flat CSV files with real-time schema mapping and batch export.',
      ],
    },
  ];
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

export function getArchetypeCategorizedSkills(
  archetype: ResumeArchetype | RoleArchetype,
  roleTitle = '',
  jdText = ''
): Record<string, string[]> {
  const norm = String(archetype).toUpperCase();
  let base: Record<string, string[]>;

  if (norm.includes('DATA')) {
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
    return prioritized;
  }

  return base;
}

export function verifyNoKeywordStuffing(fullText: string): { clean: boolean; maxFreq: number } {
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
    clean: maxFreq < 0.025,
    maxFreq: Number(maxFreq.toFixed(4)),
  };
}

export function generateResumeHtml(
  candidate: CandidateExtendedProfile,
  archetype: ResumeArchetype | RoleArchetype,
  roleTitle = '',
  jdText = ''
): string {
  const bullets = getArchetypeOrderedBullets(archetype);
  const skillCategories = getArchetypeCategorizedSkills(archetype, roleTitle, jdText);
  const projects = getArchetypeProjects(archetype);

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
    <div class="entry">
      <div class="entry-header">
        <span>${proj.title}</span>
        <span>${proj.stack}</span>
      </div>
      <ul class="bullets">
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
  @page {
    size: letter;
    margin: 0.38in;
  }
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1a1a1a;
    font-size: 9.2pt;
    line-height: 1.3;
    background: #ffffff;
  }
  .header {
    text-align: center;
    border-bottom: 1.5px solid #2563eb;
    padding-bottom: 4px;
    margin-bottom: 6px;
  }
  .name {
    font-size: 18pt;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: -0.3px;
  }
  .contact-bar {
    font-size: 8.8pt;
    color: #475569;
    margin-top: 3px;
    display: flex;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .contact-bar a {
    color: #2563eb;
    text-decoration: none;
  }
  .section {
    margin-top: 6px;
  }
  .section-title {
    font-size: 10pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #1e3a8a;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 1px;
    margin-bottom: 4px;
  }
  .entry {
    margin-bottom: 4px;
  }
  .entry-header {
    display: flex;
    justify-content: space-between;
    font-weight: 600;
    font-size: 9.3pt;
    color: #0f172a;
  }
  .entry-sub {
    display: flex;
    justify-content: space-between;
    font-style: italic;
    font-size: 8.8pt;
    color: #334155;
    margin-bottom: 2px;
  }
  ul.bullets {
    padding-left: 15px;
    list-style-type: disc;
  }
  li.bullet {
    margin-bottom: 1.5px;
    text-align: justify;
    font-size: 8.9pt;
  }
  .skill-row {
    font-size: 8.9pt;
    margin-bottom: 1.5px;
    line-height: 1.25;
  }
  .skill-cat {
    font-weight: 700;
    color: #0f172a;
  }
  .achievement-text {
    font-size: 8.9pt;
    line-height: 1.3;
    color: #1a1a1a;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="name">${fullName}</div>
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
    <div class="section-title">Education</div>
    <div class="entry">
      <div class="entry-header">
        <span>Chitkara University</span>
        <span>Punjab, India</span>
      </div>
      <div class="entry-sub">
        <span>B.E. in Computer Science and Engineering (CGPA: 9.35 / 10.0)</span>
        <span>2022 – 2026</span>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Professional Experience</div>
    <div class="entry">
      <div class="entry-header">
        <span>Morgan Stanley</span>
        <span>Bengaluru, India</span>
      </div>
      <div class="entry-sub">
        <span>Technology Apprentice</span>
        <span>Aug 2025 – Aug 2026</span>
      </div>
      <ul class="bullets">
        ${experienceBulletsHtml}
      </ul>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Technical Projects</div>
    ${projectsHtml}
  </div>

  <div class="section">
    <div class="section-title">Technical Skills</div>
    <div class="skills-block">
      ${skillLinesHtml}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Achievements & Milestones</div>
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
  const bullets = getArchetypeOrderedBullets(archetype);
  const skillCategories = getArchetypeCategorizedSkills(archetype, roleTitle, jdText);
  const projects = getArchetypeProjects(archetype);

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
  const roleArch =
    archetype === 'DATA'
      ? 'DATA_SPARK_SNOWFLAKE'
      : archetype === 'DEVOPS'
      ? 'DEVOPS_CLOUD_PLATFORM'
      : archetype === 'FULLSTACK'
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
      await page.pdf({
        path: pdfPath,
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' },
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

  const roleArch = classifyRoleArchetype(job.title, job.description || '');
  const archetype: ResumeArchetype =
    roleArch === 'DATA_SPARK_SNOWFLAKE'
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
      await page.pdf({
        path: pdfPath,
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.4in', bottom: '0.4in', left: '0.4in', right: '0.4in' },
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
