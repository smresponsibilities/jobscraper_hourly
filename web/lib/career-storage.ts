// Local storage client & initial seed state for Career Profile, Resumes, Tracker, and Journal

import type {
  CareerProfile,
  TargetedResume,
  TrackedApplication,
  JournalEntry,
  ResumeSettings
} from './career-types';

const STORAGE_KEY_RESUMES = 'soor_resumes_v1';
const STORAGE_KEY_APPLICATIONS = 'soor_applications_v1';
const STORAGE_KEY_JOURNAL = 'soor_journal_v1';
const STORAGE_KEY_SETTINGS = 'soor_global_settings_v1';

export const DEFAULT_RESUME_SETTINGS: ResumeSettings = {
  groupJobTitlesByCompany: true,
  contactLinkDisplay: 'clean',
  accentColor: '#1e3a8a', // Corporate deep navy
  fontSize: 'normal',
  fontFamily: 'serif'
};

export const INITIAL_BASELINE_PROFILE: CareerProfile = {
  personalDetails: {
    fullName: 'Aditya Sharma',
    email: 'aditya.sharma.cse@gmail.com',
    phoneNumber: '+91 98765 43210',
    location: 'Bengaluru, India',
    linkedInUrl: 'https://linkedin.com/in/adityasharma-cse',
    portfolioUrl: 'https://github.com/adityasharma-cse',
    citizenshipDisplayText: 'Authorized to work in India (Open to Remote)'
  },
  summary: 'Software Engineer and Computer Science graduate specializing in distributed backend systems, high-throughput pipelines, and TypeScript/Go services. Experience delivering production-grade scrapers processing 400K+ daily postings and low-latency API integrations. Focused on clean system design, observable architectures, and measurable performance improvements.',
  experiences: [
    {
      id: 'exp-1',
      companyName: 'ScaleFlow Technologies',
      title: 'Backend Software Engineering Intern',
      location: 'Bengaluru, India (Hybrid)',
      startDate: '01/2026',
      endDate: 'Present',
      isCurrent: true,
      displayType: 'EXPERIENCE',
      scopeScale: {
        primaryFocus: 'Core backend ingestion engine processing data across 3,800+ distributed endpoints.',
        teamSize: '5 engineers',
        budgetOrVolume: '400K records/day',
        complexity: 'Sub-minute p95 SLA with rate limiting and automated bot-wall classification.'
      },
      achievements: [
        {
          id: 'ach-1-1',
          text: 'Architected high-concurrency ingestion pipeline processing ~400,000 real-time records hourly with p95 cycle latency under 24 minutes.',
          actionVerb: 'Architected',
          metric: '400,000 records/hr, <24min p95',
          impact: 'Eliminated manual board polling bottlenecks and achieved 99.4% crawl completion rate.',
          sourceType: 'ACHIEVEMENT',
          isScopeScale: true
        },
        {
          id: 'ach-1-2',
          text: 'Engineered an adaptive per-host concurrency controller and rate limiter that reduced HTTP 429/503 errors by 78% across 13,000 tracked endpoints.',
          actionVerb: 'Engineered',
          metric: '78% reduction in 429/503 errors',
          impact: 'Protected pipeline from IP blocks and ATS evictions.',
          sourceType: 'ACHIEVEMENT'
        },
        {
          id: 'ach-1-3',
          text: 'Designed an automated bot-wall and Cloudflare Turnstile detection classifier that differentiated legitimate 404s from security challenges, withholding false tenant evictions.',
          actionVerb: 'Designed',
          metric: 'Zero false evictions',
          impact: 'Preserved catalogue freshness and saved 14 days of recovery downtime per blocked board.',
          sourceType: 'ACHIEVEMENT'
        }
      ]
    },
    {
      id: 'exp-2',
      companyName: 'DataGrid Labs',
      title: 'Software Developer Intern',
      location: 'Bengaluru, India',
      startDate: '06/2025',
      endDate: '12/2025',
      isCurrent: false,
      displayType: 'EXPERIENCE',
      scopeScale: {
        primaryFocus: 'Full-stack internal developer dashboard and RESTful APIs for customer analytics.',
        teamSize: '4 developers',
        budgetOrVolume: '10K DAU',
        complexity: 'Real-time WebSocket streaming with PostgreSQL indexing.'
      },
      achievements: [
        {
          id: 'ach-2-1',
          text: 'Built high-performance Next.js and Node.js analytics dashboard handling 10,000+ daily active queries with client-side caching and optimistic UI updates.',
          actionVerb: 'Built',
          metric: '10,000+ DAU',
          impact: 'Decreased median page load time from 2.8s to 640ms.',
          sourceType: 'ACHIEVEMENT',
          isScopeScale: true
        },
        {
          id: 'ach-2-2',
          text: 'Optimized complex PostgreSQL queries and added multi-column B-tree indices, cutting database CPU utilization by 42% under peak load.',
          actionVerb: 'Optimized',
          metric: '42% CPU reduction',
          impact: 'Prevented scheduled database instance upscaling, saving $1,400/month.',
          sourceType: 'ACHIEVEMENT'
        }
      ]
    },
    {
      id: 'exp-3',
      companyName: 'Open Source & Academic Projects',
      title: 'Technical Lead & Core Contributor',
      location: 'Remote',
      startDate: '08/2024',
      endDate: '05/2025',
      isCurrent: false,
      displayType: 'OTHER_RELEVANT_EXPERIENCE',
      achievements: [
        {
          id: 'ach-3-1',
          text: 'Authored automated SMTP address validation engine and GitHub commit author extractor used to discover 8,700+ verified corporate engineering contacts with zero external API fees.',
          actionVerb: 'Authored',
          metric: '8,700+ verified addresses',
          impact: 'Enabled direct outreach pipeline with 12.6% verified corporate domain hit rate.',
          sourceType: 'ACHIEVEMENT'
        }
      ]
    }
  ],
  education: [
    {
      id: 'edu-1',
      school: 'Visvesvaraya Technological University (VTU)',
      credential: 'Bachelor of Engineering in Computer Science & Engineering',
      location: 'Bengaluru, India',
      startDate: '08/2022',
      endDate: '08/2026',
      gpa: '8.8 / 10.0'
    }
  ],
  skills: [
    { id: 'sk-1', name: 'TypeScript / JavaScript (Node.js)', category: 'Technical', included: true },
    { id: 'sk-2', name: 'Go (Golang)', category: 'Technical', included: true },
    { id: 'sk-3', name: 'Python', category: 'Technical', included: true },
    { id: 'sk-4', name: 'Distributed Systems & Microservices', category: 'Core Competency', included: true },
    { id: 'sk-5', name: 'High-Throughput Web Scraping & Crawlers', category: 'Core Competency', included: true },
    { id: 'sk-6', name: 'RESTful API Design & GraphQL', category: 'Core Competency', included: true },
    { id: 'sk-7', name: 'PostgreSQL & Redis', category: 'Framework / Tool', included: true },
    { id: 'sk-8', name: 'Docker, GitHub Actions & CI/CD', category: 'Framework / Tool', included: true },
    { id: 'sk-9', name: 'Playwright & Browser Automation', category: 'Framework / Tool', included: true },
    { id: 'sk-10', name: 'Next.js & React 19', category: 'Framework / Tool', included: true }
  ],
  projects: [
    {
      id: 'proj-1',
      title: 'Autonomous Multi-Tenant Job Radar & ATS Intelligence',
      role: 'Creator & Lead Architect',
      link: 'https://github.com/adityasharma-cse/jobradar',
      description: 'Zero-database hourly job intelligence platform polling 3,800+ employer ATS boards (Workday, Greenhouse, Lever, Ashby, Eightfold).',
      technologies: ['TypeScript', 'Node.js', 'GitHub Actions', 'Vercel'],
      bullets: [
        'Implemented custom JSON adapters for 15+ ATS systems, cataloging 2,500+ verified open junior tech roles.',
        'Engineered delta-detection algorithm keeping repository state under 3MB with zero git churn.'
      ],
      included: true
    },
    {
      id: 'proj-2',
      title: 'FastCRW Bot-Wall & WAF Fingerprinting Suite',
      role: 'Open Source Contributor',
      link: 'https://github.com/adityasharma-cse/fastcrw',
      description: 'Passive HTTP response classifier for identifying Cloudflare Turnstile, DataDome, and rate limits without browser overhead.',
      technologies: ['TypeScript', 'RegExp', 'Node.js'],
      bullets: [
        'Achieved sub-millisecond evaluation speed over raw response bodies across 20+ bot-wall signatures.'
      ],
      included: true
    }
  ],
  certifications: [
    {
      id: 'cert-1',
      name: 'AWS Certified Cloud Practitioner',
      issuer: 'Amazon Web Services',
      date: '2025',
      credentialUrl: 'https://aws.amazon.com/verification',
      included: true
    }
  ]
};

export const INITIAL_RESUMES: TargetedResume[] = [
  {
    id: 'resume-baseline',
    name: 'Master Profile (Default Baseline)',
    isDefaultBaseline: true,
    isTargeted: false,
    targetRole: 'Software Development Engineer I (Backend / Full Stack)',
    targetCompany: 'General Tech & Product Firms',
    targetJobDescription: 'Seeking a strong junior Software Engineer proficient in TypeScript/Node.js, Go, or Python. Needs solid computer science fundamentals, data structures, concurrency, REST APIs, and database design. Experience with automated pipelines, testing, and modern frontend is a plus.',
    profile: INITIAL_BASELINE_PROFILE,
    settings: DEFAULT_RESUME_SETTINGS,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

export const INITIAL_APPLICATIONS: TrackedApplication[] = [
  {
    id: 'app-1',
    company: 'Razorpay',
    role: 'Software Development Engineer - Backend (Fintech)',
    location: 'Bengaluru, India',
    url: 'https://jobs.lever.co/razorpay/sde-1',
    salary: '18-24 LPA',
    stage: 'interviewing',
    dateAdded: new Date(Date.now() - 5 * 86400000).toISOString(),
    dateApplied: new Date(Date.now() - 4 * 86400000).toISOString(),
    interviewDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    resumeId: 'resume-baseline',
    contactName: 'Sneha Patel (Tech Recruiter)',
    contactEmail: 'sneha.patel@razorpay.com',
    notes: 'Round 1 DSA scheduled for Thursday 3 PM IST. Focus on concurrency, caching patterns, and SQL transaction isolation.',
    timeline: [
      { id: 't1', date: new Date(Date.now() - 5 * 86400000).toISOString(), type: 'status_change', note: 'Role saved from Hourly Job Radar' },
      { id: 't2', date: new Date(Date.now() - 4 * 86400000).toISOString(), type: 'status_change', note: 'Submitted targeted application with customized scope & scale resume' },
      { id: 't3', date: new Date(Date.now() - 1 * 86400000).toISOString(), type: 'interview', note: 'Recruiter phone screen passed. Technical round scheduled.' }
    ]
  },
  {
    id: 'app-2',
    company: 'CRED',
    role: 'Backend Engineer (Payments & Core Platform)',
    location: 'Bengaluru, India',
    url: 'https://boards.greenhouse.io/cred/jobs/482910',
    salary: '22-30 LPA',
    stage: 'applied',
    dateAdded: new Date(Date.now() - 2 * 86400000).toISOString(),
    dateApplied: new Date(Date.now() - 2 * 86400000).toISOString(),
    resumeId: 'resume-baseline',
    notes: 'Applied with referral. Emphasized high-throughput scraping and PostgreSQL optimization experience.',
    timeline: [
      { id: 't4', date: new Date(Date.now() - 2 * 86400000).toISOString(), type: 'status_change', note: 'Applied via Greenhouse board' }
    ]
  },
  {
    id: 'app-3',
    company: 'Groww',
    role: 'Junior Software Engineer (Data Systems)',
    location: 'Bengaluru, India',
    url: 'https://groww.in/careers/data-engineer-jr',
    salary: '16-20 LPA',
    stage: 'saved',
    dateAdded: new Date(Date.now() - 1 * 86400000).toISOString(),
    resumeId: 'resume-baseline',
    notes: 'Needs strong Go and Redis knowledge. Tailor resume bullets around pipeline concurrency before submitting.',
    timeline: [
      { id: 't5', date: new Date(Date.now() - 1 * 86400000).toISOString(), type: 'status_change', note: 'Saved role from Job Radar' }
    ]
  }
];

export const INITIAL_JOURNAL: JournalEntry[] = [
  {
    id: 'j-1',
    date: new Date(Date.now() - 2 * 86400000).toISOString(),
    title: 'Reduced Crawl Latency Under 25 Minutes',
    category: 'metric',
    companyOrContext: 'ScaleFlow Technologies',
    impactSummary: 'Benchmarked 8,000 boards sweep: 26m28s wall clock, 0 rate limit bans.',
    fullNotes: 'Fine-tuned worker concurrency and adaptive pod limits for Workday wd504. Recorded worst-p95 latency to prevent host throttling.',
    promotedToAchievement: true,
    promotedResumeId: 'resume-baseline'
  },
  {
    id: 'j-2',
    date: new Date(Date.now() - 7 * 86400000).toISOString(),
    title: 'Passed AWS Cloud Practitioner Certification',
    category: 'skill',
    companyOrContext: 'Personal Upskilling',
    impactSummary: 'Scored 890/1000 on first attempt.',
    fullNotes: 'Covered VPC, IAM security policies, S3 lifecycle, and serverless Lambda architectures.',
    promotedToAchievement: true,
    promotedResumeId: 'resume-baseline'
  },
  {
    id: 'j-3',
    date: new Date(Date.now() - 14 * 86400000).toISOString(),
    title: 'Resolved Mass-Eviction Outage Bug',
    category: 'win',
    companyOrContext: 'ScaleFlow Technologies',
    impactSummary: 'Built detectOutage() to prevent eviction of healthy boards during ATS downtime.',
    fullNotes: 'When BigBasket and PhysicsWallah failed together due to platform DNS outage, the system was wrongly purging their jobs. Added ratio-based outage shield with GitHub issue integration.',
    promotedToAchievement: true,
    promotedResumeId: 'resume-baseline'
  }
];

// Helper functions for safe browser storage
export function loadResumes(): TargetedResume[] {
  if (typeof window === 'undefined') return INITIAL_RESUMES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RESUMES);
    if (!raw) {
      saveResumes(INITIAL_RESUMES);
      return INITIAL_RESUMES;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_RESUMES;
  } catch (err) {
    console.error('Failed to load resumes from localStorage:', err);
    return INITIAL_RESUMES;
  }
}

export function saveResumes(resumes: TargetedResume[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_RESUMES, JSON.stringify(resumes));
  } catch (err) {
    console.error('Failed to save resumes to localStorage:', err);
  }
}

export function loadApplications(): TrackedApplication[] {
  if (typeof window === 'undefined') return INITIAL_APPLICATIONS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_APPLICATIONS);
    if (!raw) {
      saveApplications(INITIAL_APPLICATIONS);
      return INITIAL_APPLICATIONS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : INITIAL_APPLICATIONS;
  } catch (err) {
    console.error('Failed to load applications from localStorage:', err);
    return INITIAL_APPLICATIONS;
  }
}

export function saveApplications(apps: TrackedApplication[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_APPLICATIONS, JSON.stringify(apps));
  } catch (err) {
    console.error('Failed to save applications to localStorage:', err);
  }
}

export function loadJournal(): JournalEntry[] {
  if (typeof window === 'undefined') return INITIAL_JOURNAL;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_JOURNAL);
    if (!raw) {
      saveJournal(INITIAL_JOURNAL);
      return INITIAL_JOURNAL;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : INITIAL_JOURNAL;
  } catch (err) {
    console.error('Failed to load journal from localStorage:', err);
    return INITIAL_JOURNAL;
  }
}

export function saveJournal(entries: JournalEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_JOURNAL, JSON.stringify(entries));
  } catch (err) {
    console.error('Failed to save journal to localStorage:', err);
  }
}

// Backup & Restore
export function exportAllDataAsJson(): string {
  const data = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    resumes: loadResumes(),
    applications: loadApplications(),
    journal: loadJournal()
  };
  return JSON.stringify(data, null, 2);
}

export function importAllDataFromJson(jsonStr: string): boolean {
  try {
    const data = JSON.parse(jsonStr);
    if (data.resumes && Array.isArray(data.resumes)) saveResumes(data.resumes);
    if (data.applications && Array.isArray(data.applications)) saveApplications(data.applications);
    if (data.journal && Array.isArray(data.journal)) saveJournal(data.journal);
    return true;
  } catch (err) {
    console.error('Failed to import JSON data:', err);
    return false;
  }
}
