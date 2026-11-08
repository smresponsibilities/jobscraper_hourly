export interface QuestionBankEntry {
  id: number;
  domain: string;
  question: string;
  normalizedKey: string;
  tokens: string[];
  answerText: string;
  answerChoice?: string;
  answerNumeric?: string;
}

export function normalizePrompt(q: string): string {
  return String(q || '')
    .toLowerCase()
    .replace(/\*\s*$/g, '')
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizePrompt(norm: string): string[] {
  const stop = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'for', 'on', 'at', 'by', 'with', 'please', 'enter', 'provide', 'your', 'you', 'are', 'is', 'do', 'have', 'what']);
  return norm.split(' ').filter((w) => w.length >= 2 && !stop.has(w));
}

function buildMaster1000QuestionCorpus(): QuestionBankEntry[] {
  const entries: QuestionBankEntry[] = [];
  let nextId = 1;

  const add = (
    domain: string,
    questions: string[],
    answerText: string,
    answerChoice?: string,
    answerNumeric?: string
  ) => {
    for (const q of questions) {
      const normalizedKey = normalizePrompt(q);
      if (!normalizedKey) continue;
      entries.push({
        id: nextId++,
        domain,
        question: q,
        normalizedKey,
        tokens: tokenizePrompt(normalizedKey),
        answerText,
        answerChoice: answerChoice ?? answerText,
        answerNumeric: answerNumeric ?? answerText,
      });
    }
  };

  // Domain 1: Identity & Legal Name
  add('identity', [
    'First Name', 'Legal First Name', 'Given Name', 'Preferred First Name', 'Preferred Name',
    'What is your first name?', 'Candidate First Name', 'Forename', 'Applicant First Name', 'Nickname',
    'Applicant Legal First Name', 'Applicant legal first name'
  ], 'Shivam');
  add('identity', [
    'Last Name', 'Legal Last Name', 'Surname', 'Family Name', 'What is your last name?',
    'Candidate Last Name', 'Applicant Last Name', 'Second Name',
    'Applicant Legal Last Name', 'Applicant legal last name'
  ], 'Mahajan');
  add('identity', [
    'Full Name', 'Full Legal Name', 'Legal Name', 'Candidate Name', 'Applicant Full Name',
    'What is your full name?', 'Name (as on passport)', 'Name (as per PAN card)', 'Complete Name', 'Signature Name',
    'Print Full Name', 'Digital Signature (Full Name)', 'Electronic Signature', 'Applicant Signature'
  ], 'Shivam Mahajan');
  add('identity', ['Middle Name', 'Middle Initial'], '');
  add('identity', ['Title', 'Prefix', 'Salutation', 'Honorific', 'Preferred Title', 'Title / Salutation'], 'Mr.');
  add('identity', ['Pronouns', 'Preferred Pronouns', 'Personal Pronouns', 'What are your pronouns?'], 'He/Him');
  add('identity', ['Marital Status', 'Civil Status', 'What is your marital status?'], 'Single');
  add('identity', ['Nationality', 'Country of Citizenship', 'Country of Nationality', 'What is your nationality?', 'Primary Nationality'], 'Indian', 'India');
  add('identity', [
    'Are you at least 18 years of age?', 'Are you 18 years of age or older?', 'Are you over 18?',
    'Are you of legal age to work?', 'Confirm you are 18 years or older', 'Are you 21 years or older?'
  ], 'Yes', 'Yes', '1');

  // Domain 2: Contact & Coding Profiles
  add('contact', [
    'Mobile Phone', 'Phone Number', 'Primary Phone', 'Contact Number', 'Mobile Number',
    'Cell Phone', 'Telephone Number', 'WhatsApp Number', 'Alternate Phone Number', 'Emergency Contact Number'
  ], '9876543210');
  add('contact', ['Country Phone Code', 'Phone Country Code', 'Dialing Code', 'ISD Code', 'Mobile Country Code'], '+91', 'India (+91)', '91');
  add('contact', ['Phone Device Type', 'Phone Type', 'Primary Phone Type', 'Device Type'], 'Mobile', 'Mobile');
  add('contact', [
    'LinkedIn Profile', 'LinkedIn URL', 'LinkedIn Link', 'What is your LinkedIn profile URL?',
    'Link to LinkedIn', 'LinkedIn Username', 'Social Profile (LinkedIn)'
  ], 'https://www.linkedin.com/in/mahajanshivam');
  add('contact', [
    'GitHub Profile', 'GitHub URL', 'GitHub Link', 'GitHub Username', 'Link to GitHub',
    'Code Repository URL', 'Source Control Profile', 'Open Source Profile', 'LeetCode Profile',
    'LeetCode URL', 'LeetCode profile link', 'Codeforces Profile', 'Codeforces URL', 'HackerRank URL', 'Kaggle Profile', 'Coding Profile URL'
  ], 'https://github.com/smresponsibilities');
  add('contact', [
    'Portfolio URL', 'Personal Website', 'Website', 'Blog URL', 'Personal Site',
    'Portfolio Link', 'Work Samples URL', 'Other Website', 'Project Showcase URL', 'Personal Homepage'
  ], 'https://shivammahajan.com');

  // Domain 3: Address & Geo-Location
  add('address', [
    'Current City', 'City', 'Location (City)', 'Town/City', 'Municipality',
    'Where are you currently based?', 'Current Location', 'Preferred Work City', 'Base Location', 'City of Residence'
  ], 'Bengaluru', 'Bengaluru');
  add('address', [
    'State', 'Province', 'State/Province', 'Region', 'Current State', 'Domicile State'
  ], 'Karnataka', 'Karnataka');
  add('address', [
    'Country', 'Country/Region', 'Country of Residence', 'Current Country', 'Home Country'
  ], 'India', 'India');
  add('address', [
    'Postal Code', 'Pin Code', 'Pincode', 'ZIP Code', 'Zip / Postal Code', 'Current Pin Code', 'Permanent Pin Code'
  ], '560001', '560001', '560001');
  add('address', [
    'Address Line 1', 'Street Address', 'Current Address', 'Residential Address', 'Permanent Address',
    'Home Address', 'Mailing Address', 'Correspondence Address'
  ], 'Bengaluru, Karnataka, India');
  add('address', ['Nearest Airport', 'Home Airport', 'Closest International Airport'], 'BLR - Bengaluru');

  // Domain 4: Mobility, Relocation, Hybrid & Shift Flexibility
  const mobilityYesPrompts = [
    'Are you willing to relocate?', 'Open to relocation?', 'Willing to relocate to Bengaluru?',
    'Willing to relocate to Hyderabad?', 'Willing to relocate to Pune?', 'Willing to relocate to Gurugram?',
    'Willing to relocate to Mumbai?', 'Willing to relocate to Chennai?', 'Willing to relocate to Noida?',
    'Are you comfortable working from the office?', 'Are you comfortable working in a hybrid model?',
    'Can you work onsite 3 days a week?', 'Can you work onsite 4 days a week?', 'Can you work onsite 5 days a week?',
    'Are you comfortable commuting to the office?', 'Are you willing to travel if required?',
    'Are you comfortable working in US overlap hours?', 'Are you comfortable working in UK/EU overlap hours?',
    'Are you comfortable with flexible shift timings?', 'Are you willing to work in rotational shifts?',
    'Do you have a reliable high-speed internet connection for remote work?',
    'Are you currently located in Bengaluru or willing to relocate?'
  ];
  add('mobility', mobilityYesPrompts, 'Yes', 'Yes', '1');
  add('mobility', ['Time Zone', 'Current Timezone', 'What time zone are you in?', 'Working Timezone', 'What is your current timezone?'], 'IST (UTC+5:30)');
  add('mobility', ['Willingness to travel percentage', 'Maximum travel percentage'], '25%', 'Up to 25%', '25');

  // Domain 5: Work Authorization & Immigration
  const workAuthYesPrompts = [
    'Are you legally authorized to work in India?', 'Are you eligible to work in India?',
    'Do you have the legal right to work in this country?', 'Are you authorized to work without restrictions?',
    'Do you hold a valid Indian passport?', 'Are you an Indian citizen?',
    'Can you provide proof of legal work authorization upon hire?'
  ];
  add('work_auth', workAuthYesPrompts, 'Yes', 'Yes', '1');

  const sponsorshipNoPrompts = [
    'Will you now or in the future require visa sponsorship?', 'Do you require visa sponsorship?',
    'Will you require employer sponsorship for a work permit?', 'Do you need immigration sponsorship?',
    'Do you require H-1B sponsorship?', 'Do you require work visa assistance?'
  ];
  add('work_auth', sponsorshipNoPrompts, 'No', 'No', '0');

  // Domain 6: Education — University, Degree & Coursework
  add('education', [
    'School', 'University', 'College', 'Institution Name', 'School or University',
    'College / University Name', 'Undergraduate Institution', 'Alma Mater', 'University Attended'
  ], 'Chitkara University');
  add('education', [
    'Degree', 'Highest Degree', 'Education Level', 'Highest Qualification', 'Degree Type',
    'Undergraduate Degree', 'Academic Qualification'
  ], 'Bachelor of Engineering (B.E.)', "Bachelor's Degree");
  add('education', [
    'Field of Study', 'Major', 'Discipline', 'Specialization', 'Branch',
    'Stream', 'Course Major', 'Academic Discipline', 'Department'
  ], 'Computer Science & Engineering', 'Computer Science');
  add('education', [
    'Graduation Year', 'Year of Graduation', 'Year of Passing', 'Passing Year',
    'Expected Graduation Year', 'Batch', 'Class of'
  ], '2026', '2026', '2026');
  add('education', ['Graduation Month', 'Month of Graduation', 'Expected Graduation Month'], 'August', 'August', '8');
  add('education', ['Division', 'Class Obtained', 'Academic Class'], 'First Class with Distinction');

  // Domain 7: Academic Grading, Ranks & Backlogs
  add('grading', [
    'CGPA', 'GPA', 'Cumulative GPA', 'Overall GPA', 'Overall CGPA', 'Undergraduate CGPA',
    'Grade Point Average', 'CGPA (out of 10)', 'Current CGPA', 'B.Tech / B.E. CGPA'
  ], '9.35', '9.35', '9.35');
  add('grading', ['GPA (4.0 scale)', 'GPA out of 4.0', 'Converted 4.0 GPA', 'GPA on 4.0 scale'], '3.9', '3.9', '3.9');
  add('grading', [
    'Percentage', 'Marks Percentage', 'Aggregate Percentage', 'Graduation Percentage',
    'Percentage marks obtained in 12th/Graduation', '10th Percentage', '12th Percentage', 'SSC Percentage', 'HSC Percentage'
  ], '93.5', '93.5', '93.5');
  add('grading', [
    'Active Backlogs', 'Current Backlogs', 'Number of Backlogs', 'History of Arrears',
    'Do you have any active backlogs?', 'Any pending backlogs?'
  ], '0', '0', '0');

  // Domain 8: Current Employment — Morgan Stanley Experience
  add('employment', [
    'Current Company', 'Current Employer', 'Present Company', 'Most Recent Employer',
    'Organization Name', 'Current Organization', 'Last Employer'
  ], 'Morgan Stanley');
  add('employment', [
    'Current Job Title', 'Current Role', 'Current Designation', 'Present Designation',
    'Most Recent Job Title', 'Job Title', 'Current Position'
  ], 'Technology Apprentice');
  add('employment', [
    'Total Years of Experience', 'Years of Professional Experience', 'Total Experience (in years)',
    'Overall Experience', 'Relevant Experience (in years)', 'Work Experience in Years',
    'How many years of software engineering experience do you have?'
  ], '1', '1', '1');
  add('employment', [
    'Reason for Leaving', 'Why are you looking for a change?', 'Reason for job change', 'Why are you leaving your current role?'
  ], 'Completing my 1-year Technology Apprenticeship at Morgan Stanley in August 2026 and seeking a full-time Software / Data / ML Engineering role.');

  // Domain 9: Compensation, CTC & Expectations
  add('compensation', [
    'Current CTC', 'Present CTC', 'Current Annual Salary', 'Current Base Salary', 'Current Fixed CTC', 'Current Compensation',
    'What is your current total annual compensation?', 'What is your current annual CTC in LPA?'
  ], '1000000', '10 LPA', '1000000');
  add('compensation', [
    'Expected CTC', 'Desired Salary', 'Expected Annual Salary', 'Expected Base Salary',
    'Target Compensation', 'Expected Compensation', 'Salary Expectations',
    'What is your expected annual compensation?', 'What is your expected annual CTC in LPA?'
  ], '1200000', '12 LPA', '1200000');
  add('compensation', [
    'What is your desired annual compensation range?', 'Desired compensation range', 'Expected salary range'
  ], '12 LPA (INR 1,200,000 / year)', '12 LPA', '1200000');
  add('compensation', [
    'Current CTC (in LPA)', 'Present CTC in Lakhs', 'Current Salary (LPA)'
  ], '10', '10', '10');
  add('compensation', [
    'Expected CTC (in LPA)', 'Expected Salary in Lakhs', 'Expected CTC in LPA'
  ], '12', '12', '12');
  add('compensation', [
    'Is your expected CTC negotiable?', 'Are your salary expectations flexible?',
    'Does this compensation range align with your expectations?', 'Do you agree with the budgeted compensation range?',
    'Our compensation is based on experience. Does this range align?'
  ], 'Yes', 'Yes', '1');

  // Domain 10: Notice Period, Buyout & Joining Date
  add('notice', [
    'Notice Period', 'What is your notice period?', 'Availability to start', 'When can you start?',
    'Time to join', 'Joining Timeline', 'What is your current notice period?'
  ], 'Immediate', 'Immediate', '0');
  add('notice', [
    'Notice Period (in days)', 'Official Notice Period in Days', 'How many days is your notice period?',
    'Remaining Notice Period (Days)', 'Official notice period in days'
  ], '0', '0', '0');
  add('notice', [
    'Can you join immediately?', 'Can you join within 15 days?', 'Can you join within 30 days?',
    'Is your notice period negotiable?', 'Are you currently serving notice period?'
  ], 'Yes', 'Yes', '1');

  // Helper for Skill Prompts
  const skillPromptTemplates = [
    (s: string) => `Do you have experience with ${s}?`,
    (s: string) => `How many years of experience do you have with ${s}?`,
    (s: string) => `Years of experience in ${s}`,
    (s: string) => `Rate your proficiency in ${s}`,
    (s: string) => `Have you worked with ${s} in a production environment?`,
    (s: string) => `Are you proficient in ${s}?`,
    (s: string) => `Hands-on experience with ${s}`,
    (s: string) => `Practical experience using ${s}`,
    (s: string) => `Familiarity with ${s}`,
    (s: string) => `${s} experience (in years)`
  ];

  // Domain 11: Programming Languages Matrix
  const verifiedLangs = ['Java', 'Python', 'TypeScript', 'JavaScript', 'SQL', 'C', 'C++', 'Rust', 'Kotlin', 'Solidity', 'HTML/CSS', 'Bash'];
  for (const s of verifiedLangs) {
    for (const tpl of skillPromptTemplates) {
      const p = tpl(s);
      const isNum = /how many years|years of|rate your|\(in years\)/i.test(p);
      add('languages_matrix', [p], isNum ? '1' : 'Yes', 'Yes', '1');
    }
  }
  const unverifiedLangs = ['Go', 'Golang', 'Ruby', 'Ruby on Rails', 'PHP', 'Laravel', 'C#', '.NET', 'Swift', 'Objective-C', 'Scala', 'Elixir', 'COBOL', 'Fortran', 'FIX Protocol'];
  for (const u of unverifiedLangs) {
    add('languages_matrix', [
      `Do you have commercial experience with ${u}?`,
      `How many years of experience do you have with ${u}?`,
      `Years of experience in ${u}`,
      `Have you worked professionally with ${u}?`
    ], 'No', 'No', '0');
  }

  // Domain 12: Backend, APIs & Distributed Systems
  const backendSkills = ['Spring Boot', 'Node.js', 'Flask', 'FastAPI', 'REST APIs', 'Microservices', 'GraphQL', 'WebSockets', 'OAuth 2.0', 'mTLS', 'RBAC'];
  for (const s of backendSkills) {
    for (const tpl of skillPromptTemplates) {
      const p = tpl(s);
      const isNum = /how many years|years of|rate your|\(in years\)/i.test(p);
      add('backend_distributed', [p], isNum ? '1' : 'Yes', 'Yes', '1');
    }
  }

  // Domain 13: Data Engineering, Streaming & Databases
  const dataSkills = ['Apache Kafka', 'Apache Spark', 'PySpark', 'Apache Hive', 'Azure Snowflake', 'ClickHouse', 'PostgreSQL', 'Supabase', 'MongoDB', 'Redis', 'ETL Pipelines', 'Data Warehousing'];
  for (const s of dataSkills) {
    for (const tpl of skillPromptTemplates) {
      const p = tpl(s);
      const isNum = /how many years|years of|rate your|\(in years\)/i.test(p);
      add('data_streaming', [p], isNum ? '1' : 'Yes', 'Yes', '1');
    }
  }

  // Domain 14: AI, Machine Learning & Data Science
  const aiSkills = ['Machine Learning', 'XGBoost', 'Scikit-Learn', 'Deep Learning', 'NLP', 'Natural Language Processing', 'Data Structures and Algorithms', 'Distributed Systems'];
  for (const s of aiSkills) {
    for (const tpl of skillPromptTemplates) {
      const p = tpl(s);
      const isNum = /how many years|years of|rate your|\(in years\)/i.test(p);
      add('ai_ml', [p], isNum ? '1' : 'Yes', 'Yes', '1');
    }
  }

  // Domain 15: Frontend, Mobile & WebAssembly
  const frontendSkills = ['React', 'Next.js', 'Astro', 'Tailwind CSS', 'Android SDK', 'Jetpack Compose', 'WebAssembly'];
  for (const s of frontendSkills) {
    for (const tpl of skillPromptTemplates) {
      const p = tpl(s);
      const isNum = /how many years|years of|rate your|\(in years\)/i.test(p);
      add('frontend_mobile', [p], isNum ? '1' : 'Yes', 'Yes', '1');
    }
  }

  // Domain 16: Cloud, DevOps, CI/CD & Observability
  const devopsSkills = ['Docker', 'Kubernetes', 'Jenkins', 'GitHub Actions', 'CI/CD', 'Maven', 'Git', 'Linux', 'Splunk', 'Grafana', 'Automated Testing', 'Agile Scrum'];
  for (const s of devopsSkills) {
    for (const tpl of skillPromptTemplates) {
      const p = tpl(s);
      const isNum = /how many years|years of|rate your|\(in years\)/i.test(p);
      add('devops_cloud', [p], isNum ? '1' : 'Yes', 'Yes', '1');
    }
  }

  // Domain 17: Conflict of Interest, Relatives & Former Employment
  const conflictPrompts = [
    'Have you previously worked for this company?', 'Are you a former employee, intern, or contractor?',
    'Do you have any relatives or family members working at this company?',
    'Are you currently or have you recently been a government official?',
    'Have you worked for our external auditor in the past 3 years?',
    'Are you bound by any non-compete or non-solicitation agreement?',
    'Do you have any post-employment restrictions from your current employer?',
    'Do you have any conflict of interest?'
  ];
  add('conflict_interest', conflictPrompts, 'No', 'No', '0');

  // Domain 18: Export Control, Sanctions & Background Check
  const exportPrompts = [
    'Are you a citizen or resident of Cuba, Iran, North Korea, Syria, or Crimea?',
    'Are you a citizen of Cuba, Iran, or North Korea?',
    'Have you ever been debarred, suspended, or excluded by any government agency?',
    'Have you ever been convicted of a felony or criminal offense?',
    'Do you have any pending criminal charges?'
  ];
  add('export_control', exportPrompts, 'No', 'No', '0');

  // Domain 19: EEO, Diversity & Disability Form CC-305
  add('eeo', ['Gender', 'What is your gender?', 'Sex', 'Gender Identity'], 'Male', 'Male');
  add('eeo', ['Race', 'Ethnicity', 'Race / Ethnicity', 'Ethnic Background'], 'Asian', 'Asian');
  add('eeo', ['Are you Hispanic or Latino?', 'Hispanic or Latino origin'], 'No', 'No');
  add('eeo', ['Veteran Status', 'Protected Veteran Status', 'Are you a protected veteran?'], 'I am not a protected veteran', 'No');
  add('eeo', ['Disability Status', 'Do you have a disability?', 'Voluntary Self-Identification of Disability'], 'No, I do not have a disability', 'No');

  // Domain 20: Referral & Source Tracking
  add('referral', ['How did you hear about us?', 'How did you find this job?', 'Referral Source', 'Application Source'], 'LinkedIn', 'LinkedIn');
  add('referral', ['Were you referred by a current employee?', 'Did an employee refer you?'], 'No', 'No');

  // Domain 21: India IT / GCC Compliance Identifiers
  add('india_compliance', [
    'Do you have a valid PAN card?', 'Do you have a valid Aadhaar card?', 'Do you have a valid Passport?',
    'Are you comfortable with a background verification (BGV) as per NASSCOM guidelines?',
    'Do you have an active UAN number?'
  ], 'Yes', 'Yes', '1');

  // Domain 22: Behavioral, Motivation & Culture-Fit Essays
  add('behavioral_essays', [
    'Why do you want to work here?', 'Why are you interested in this role?', 'Why should we hire you?',
    'What excites you about this position?', 'Tell us about yourself', 'Cover Letter', 'Additional Information',
    'Anything else you would like us to know?'
  ], 'As a Technology Apprentice at Morgan Stanley in Bengaluru, I engineered CIAM data warehouse pipelines using Apache Kafka, PySpark, Apache Spark, Hive, and Azure Snowflake processing 5,000,000+ events with zero row-count tolerance and built distributed Java Spring Boot REST APIs. Alongside a 9.35/10.0 CGPA in B.E. CSE at Chitkara University, 1,255+ consecutive days of code, and 2,600+ solved algorithmic problems, I have shipped production systems including a ClickHouse OLAP ingestion tool, QuizDeck (500 concurrent WebSocket users at 31ms latency), an XGBoost Fertilizer Recommendation ML microservice, and Chaincode (3rd place out of 200+ teams at HackIndia).');

  // Domain 23: Technical Deep-Dive & ML Papers Essays
  add('technical_essays', [
    'Describe your most challenging technical project',
    'Describe ML research papers you have read or implemented',
    'What are the three most relevant ML research papers you have read recently?',
    'What is the most impressive system you have built?',
    'Explain a complex distributed systems architecture you designed'
  ], 'At Morgan Stanley, I engineered distributed CIAM data warehouse pipelines using Apache Kafka, PySpark, Apache Spark, Hive, and Azure Snowflake processing 5M+ daily events. On ML research, I have studied and implemented gradient boosted trees (Chen & Guestrin XGBoost paper), distributed embeddings, and transformer attention mechanisms, shipping an XGBoost classifier with 97.4% precision and QuizDeck WebSocket clustering handling 500 concurrent connections.');

  // Domain 24: Consent, GDPR, Privacy & AI Assessment Terms
  add('gdpr_privacy', [
    'Are you willing to undergo a pre-employment background check?',
    'Do you consent to background verification (BGV)?',
    'Are you willing to take a pre-employment drug test if required?',
    'Do you agree to the Privacy Policy and Terms of Application?',
    'Do you consent to the processing of your personal data for recruitment purposes?',
    'I certify that the information provided in this application is true and complete',
    'Do you agree to our candidate privacy notice?'
  ], 'Yes', 'Yes', '1');

  // Domain 25: Languages Spoken, Hardware & Logistics
  add('logistics', ['English Proficiency', 'Level of English', 'Spoken English Fluency'], 'Fluent / Native', 'Fluent');
  add('logistics', ['Languages Spoken', 'Languages Known'], 'English, Hindi');
  add('logistics', ['Preferred Operating System', 'Development OS'], 'Linux / macOS / Windows');
  add('logistics', ['Professional References', 'References'], 'Available upon request');

  return entries;
}

export const PORTAL_QUESTION_BANK_1000: QuestionBankEntry[] = buildMaster1000QuestionCorpus();

const EXACT_PROMPT_MAP = new Map<string, QuestionBankEntry>();
for (const entry of PORTAL_QUESTION_BANK_1000) {
  if (!EXACT_PROMPT_MAP.has(entry.normalizedKey)) {
    EXACT_PROMPT_MAP.set(entry.normalizedKey, entry);
  }
}

export const ANTONYM_GROUPS: Array<[RegExp, RegExp]> = [
  [/\b(?:first|given|forename)\b/, /\b(?:last|surname|family|middle)\b/],
  [/\bmiddle\b/, /\b(?:first|last|surname|full)\b/],
  [/\b(?:current|present)\b/, /\b(?:expected|desired|target)\b/],
  [/\b(?:start|from|begin)\b/, /\b(?:end|to|graduation|passing|completion)\b/],
  [/\b(?:authorized|eligible|citizen)\b/, /\b(?:sponsorship|sponsor|visa\s+assistance)\b/],
  [/\b(?:10th|ssc|matric)\b/, /\b(?:12th|hsc|intermediate|diploma)\b/],
  [/\bcgpa\b/, /\bpercentage\b/],
  [/\bcity\b/, /\b(?:state|province|country|postal|pin|zip)\b/],
  [/\bstate\b/, /\b(?:city|country|postal|pin|zip)\b/],
  [/\b(?:not|never|non)\b/, /^(?!.*\b(?:not|never|non)\b).*$/],
];

export function hasAntonymOrPolarityConflict(aNorm: string, bNorm: string): boolean {
  for (const [rx1, rx2] of ANTONYM_GROUPS) {
    const aHas1 = rx1.test(aNorm);
    const aHas2 = rx2.test(aNorm);
    const bHas1 = rx1.test(bNorm);
    const bHas2 = rx2.test(bNorm);
    if ((aHas1 && bHas2 && !aHas2) || (bHas1 && aHas2 && !bHas2)) {
      return true;
    }
    if (aHas1 !== bHas1 && (rx1.source.includes('first') || rx1.source.includes('current') || rx1.source.includes('start'))) {
      return true;
    }
  }
  return false;
}

export function lookupQuestionIn1000Bank(
  questionText: string,
  widgetKind = 'text'
): string | undefined {
  const norm = normalizePrompt(questionText);
  if (!norm) return undefined;

  // Layer 1: O(1) Exact Normalized Match
  const exact = EXACT_PROMPT_MAP.get(norm);
  if (exact) {
    if (widgetKind === 'number') return exact.answerNumeric ?? exact.answerText;
    if (widgetKind === 'radio' || widgetKind === 'select' || widgetKind === 'combobox' || widgetKind === 'checkbox') {
      return exact.answerChoice ?? exact.answerText;
    }
    return exact.answerText;
  }

  // Layer 2: High-Precision Token Overlap Match (>= 0.82 Jaccard / Containment with Polarity Safety)
  const qTokens = tokenizePrompt(norm);
  if (qTokens.length < 2) return undefined;
  const qSet = new Set(qTokens);

  let bestEntry: QuestionBankEntry | null = null;
  let bestScore = 0;

  for (const candidate of PORTAL_QUESTION_BANK_1000) {
    if (candidate.tokens.length === 0) continue;
    if (hasAntonymOrPolarityConflict(norm, candidate.normalizedKey)) continue;
    let shared = 0;
    for (const t of candidate.tokens) {
      if (qSet.has(t)) shared++;
    }
    if (shared < 2) continue;
    const score = shared / Math.max(qTokens.length, candidate.tokens.length);
    if (score > bestScore && score >= 0.82) {
      bestScore = score;
      bestEntry = candidate;
    }
  }

  if (bestEntry) {
    if (widgetKind === 'number') return bestEntry.answerNumeric ?? bestEntry.answerText;
    if (widgetKind === 'radio' || widgetKind === 'select' || widgetKind === 'combobox' || widgetKind === 'checkbox') {
      return bestEntry.answerChoice ?? bestEntry.answerText;
    }
    return bestEntry.answerText;
  }

  return undefined;
}
