// Career, Resume, Tracker, and Journal Types
// Reconstructed from Soor / Resume Rocketfuel recruiter architecture

export type DisplayType = 'EXPERIENCE' | 'OTHER_RELEVANT_EXPERIENCE' | 'INACTIVE';

export interface PersonalDetails {
  fullName: string;
  email: string;
  phoneNumber: string;
  location: string; // e.g. "Bengaluru, India" or "Austin, TX"
  linkedInUrl: string;
  portfolioUrl?: string;
  citizenshipDisplayText?: string; // e.g. "Eligible to work in India / US Remote"
}

export interface ScopeScaleStatement {
  primaryFocus: string; // "Led core payment integration for 1.2M daily transacting users..."
  teamSize?: string;
  budgetOrVolume?: string;
  complexity?: string;
}

export interface Achievement {
  id: string;
  text: string;
  actionVerb?: string;
  metric?: string;
  impact?: string;
  isScopeScale?: boolean;
  generatedScore?: number;
  sourceType: 'ACHIEVEMENT' | 'VARIATION' | 'JOURNAL';
  requirementId?: string;
}

export interface ExperienceRole {
  id: string;
  careerJobTitleId?: string;
  companyName: string;
  title: string;
  location: string;
  startDate: string; // "MM/YYYY" or "YYYY"
  endDate: string; // "MM/YYYY" or "Present"
  isCurrent: boolean;
  displayType: DisplayType;
  scopeScale?: ScopeScaleStatement;
  achievements: Achievement[];
}

export interface EducationItem {
  id: string;
  school: string;
  credential: string; // e.g. "B.E. Computer Science and Engineering"
  location: string;
  startDate?: string;
  endDate: string;
  gpa?: string;
}

export interface SkillItem {
  id: string;
  name: string;
  category: 'Core Competency' | 'Technical' | 'Framework / Tool' | 'Domain';
  included: boolean;
}

export interface ProjectItem {
  id: string;
  title: string;
  role?: string;
  link?: string;
  description: string;
  technologies: string[];
  bullets: string[];
  included: boolean;
}

export interface CertificationItem {
  id: string;
  name: string;
  issuer: string;
  date: string;
  credentialUrl?: string;
  included: boolean;
}

export interface CareerProfile {
  personalDetails: PersonalDetails;
  summary: string; // Professional summary / career profile (3-4 sentences)
  experiences: ExperienceRole[];
  education: EducationItem[];
  skills: SkillItem[];
  projects: ProjectItem[];
  certifications: CertificationItem[];
}

export interface ResumeSettings {
  groupJobTitlesByCompany: boolean;
  contactLinkDisplay: 'urls' | 'clean';
  accentColor: string; // Hex color (e.g. "#1A365D", "#2C3E50", "#111827", "#831843", "#065F46")
  fontSize: 'compact' | 'normal' | 'relaxed';
  fontFamily: 'serif' | 'sans';
}

export type CoachingCategory = 'needs-attention' | 'worth-strengthening' | 'be-ready-to-explain';
export type SoorSection = 'PERSONAL_DETAILS' | 'CAREER_PROFILE' | 'EXPERIENCE' | 'ACHIEVEMENTS' | 'EDUCATION' | 'SKILLS' | 'PROJECTS';

export interface FitRuleAudit {
  id: string;
  category: 'Contact' | 'Summary' | 'Experience' | 'Scope & Scale' | 'Achievements' | 'Length' | 'Skills' | 'Education' | 'Targeting';
  section?: SoorSection;
  coachingCategory?: CoachingCategory;
  title: string;
  description: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  recommendation: string;
}

export interface FitScoreBreakdown {
  score: number; // 0-100
  passedCount: number;
  totalCount: number;
  rules: FitRuleAudit[];
  targetMatchPercent?: number;
  matchedKeywords: string[];
  missingKeywords: string[];
}

export interface TargetedResume {
  id: string;
  name: string;
  isDefaultBaseline?: boolean;
  isTargeted?: boolean;
  targetRole?: string;
  targetCompany?: string;
  targetJobDescription?: string;
  profile: CareerProfile;
  settings: ResumeSettings;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationStage = 
  | 'saved'
  | 'applied'
  | 'screening'
  | 'interviewing'
  | 'offer'
  | 'rejected'
  | 'archived';

export interface TimelineEvent {
  id: string;
  date: string;
  type: 'status_change' | 'note' | 'interview' | 'task';
  note: string;
}

export interface TrackedApplication {
  id: string;
  jobId?: string; // Links to Job from Jobscraper
  company: string;
  role: string;
  location: string;
  url: string;
  salary?: string;
  stage: ApplicationStage;
  dateAdded: string;
  dateApplied?: string;
  interviewDate?: string;
  resumeId?: string; // Linked Tailored Resume
  coverLetter?: string;
  contactName?: string;
  contactEmail?: string;
  notes: string;
  timeline: TimelineEvent[];
}

export interface JournalEntry {
  id: string;
  date: string;
  title: string;
  category: 'win' | 'project' | 'metric' | 'skill' | 'recognition';
  companyOrContext: string;
  impactSummary: string; // The result / metric
  fullNotes: string;
  promotedToAchievement: boolean;
  promotedResumeId?: string;
}
