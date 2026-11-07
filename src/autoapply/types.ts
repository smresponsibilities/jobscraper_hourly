/**
 * Auto-Apply & Autofill Bot Types
 * Reverse-engineered & unified across:
 * 1. FastApply (Stealth & Copilot multi-mode runner)
 * 2. JobWizard (Multi-page Workday/Taleo form handler)
 * 3. Jobright (Instant ATS field classifier)
 * 4. AIHawk (Open-source autonomous Playwright runner)
 */

export type RunnerMode = 'copilot' | 'stealth';

export type ExtendedFieldCategory =
  // Personal
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'preferred_name'
  | 'email'
  | 'phone'
  | 'phone_country_code'
  | 'address'
  | 'address_line_2'
  | 'city'
  | 'state'
  | 'postal_code'
  | 'country'
  // Social & Web
  | 'linkedin'
  | 'github'
  | 'website'
  | 'twitter'
  | 'leetcode'
  // Education
  | 'school'
  | 'degree'
  | 'discipline'
  | 'gpa'
  | 'graduation_year'
  | 'start_year'
  | 'date_year'
  | 'date_month'
  | 'date_day'
  // Experience & Employment
  | 'current_company'
  | 'current_title'
  | 'total_experience'
  | 'notice_period'
  | 'current_salary'
  | 'expected_salary'
  | 'salary_currency'
  | 'relocate'
  | 'work_preference'
  // Work Auth & Legal
  | 'work_authorization'
  | 'sponsorship'
  | 'former_employee'
  | 'non_compete'
  | 'security_clearance'
  | 'felony_conviction'
  // EEO & Demographics
  | 'gender'
  | 'race'
  | 'hispanic_latino'
  | 'veteran'
  | 'disability'
  | 'disability_signature_name'
  | 'disability_signature_date'
  // General
  | 'hear_about_us'
  | 'referral_name'
  | 'cover_letter'
  | 'unknown';

export interface FieldClassificationResult {
  category: ExtendedFieldCategory;
  confidence: number; // 0.0 to 1.0
  matchedKeyword?: string;
  source: 'autocomplete' | 'name' | 'id' | 'placeholder' | 'label' | 'aria' | 'fuzzy';
}

export interface ScopedAnswer {
  question: string;
  value: string | boolean | number;
  scope: 'GLOBAL_FACT' | 'JURISDICTION_SCOPED' | 'EMPLOYER_SCOPED';
  country?: string;
  employerKey?: string;
  requisitionKey?: string;
}

export interface CandidateExtendedProfile {
  recruitmentPrivacyConsent?: boolean;
  adult?: boolean;
  completeEmploymentHistory?: boolean;
  indiaOnlyWorkAuthorization?: boolean;
  declarations?: { termsAndAccuracyConsent?: boolean; talentPoolConsent?: boolean; backgroundCheckConsent?: boolean; relativesAtCompany?: boolean; governmentOfficial?: boolean; big4Auditor?: boolean };
  answers?: ScopedAnswer[];
  skillYears?: Record<string, number>;
  unlistedSkillYears?: number;
  referralSources?: string[];
  workAuthorizationByCountry?: Record<string, { authorizedInCountry?: boolean; requiresSponsorshipNowOrFuture?: boolean }>;
  skills?: string[];
  coverLetterText?: string;
  documents?: { resume?: string; coverLetter?: string };
  personal: {
    firstName: string;
    lastName: string;
    age?: number;
    prefix?: string;
    phoneDeviceType?: string;
    fullName?: string;
    preferredName?: string;
    email: string;
    phone: string;
    phoneCountryCode?: string;
    address?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country: string;
    linkedinUrl?: string;
    githubUrl?: string;
    portfolioUrl?: string;
    twitterUrl?: string;
    leetcodeUrl?: string;
  };
  education: Array<{
    school: string;
    degree: string;
    fieldOfStudy: string;
    gpa?: string;
    graduationYear?: string;
    startYear?: string;
    startDate?: string;
    endDate?: string;
  }>;
  experience: Array<{
    title: string;
    company: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    current?: boolean;
    description?: string;
  }>;
  professional: {
    totalYearsExperience: number;
    currentCompany?: string;
    currentTitle?: string;
    noticePeriodDays: number; // 0 for immediate, 15, 30, 60, 90
    currentSalary?: number;
    expectedSalary?: number;
    salaryCurrency?: string;
    willingToRelocate: boolean;
    workPreference: 'remote' | 'hybrid' | 'onsite';
    officeAttendance?: { city: string; maxDaysPerWeek: number };
  };
  workAuthorization: {
    authorizedInCountry: boolean;
    requiresSponsorshipNowOrFuture: boolean;
    formerEmployee: boolean;
    hasNonCompete: boolean;
    hasSecurityClearance: boolean;
    felonyConviction: boolean;
  };
  eeo: {
    gender: 'Male' | 'Female' | 'Non-Binary' | 'Prefer not to say';
    raceOrEthnicity: string;
    isHispanicLatino: boolean;
    veteranStatus: 'I am not a protected veteran' | 'I identify as a protected veteran' | 'Prefer not to say';
    disabilityStatus: 'Yes, I have a disability' | 'No, I do not have a disability' | 'Prefer not to say';
    legalSignatureName?: string;
    signatureDate?: string;
  };
  qaBank?: Record<string, string | boolean>; // Custom Question-Answer bank
}

export interface AutofillFieldAction {
  documentHash?: string;
  controlKey?: string;
  question?: string;
  category: ExtendedFieldCategory;
  confidence: number;
  selector: string;
  value: string | boolean;
  elementTag: string;
  status: 'filled' | 'skipped' | 'failed' | 'needs_review';
  error?: string;
}

export interface MultiPageStepStatus {
  currentStepIndex: number;
  totalStepsEstimate: number;
  stepTitle?: string;
  isWorkday: boolean;
  isTaleo: boolean;
  isLastStep: boolean;
  canAdvance: boolean;
}

export interface BotRunReport {
  mode: RunnerMode;
  url: string;
  ats: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  fieldsFound: number;
  fieldsFilled: number;
  unmappedFields: number;
  stepsTraversed: number;
  choiceFields?: Array<{ options: string[] }>;
  status: 'completed' | 'submitted' | 'paused_for_review' | 'failed' | 'skipped' | 'queued';
  reason?: string;
  reviewKind?: 'authentication' | 'challenge' | 'answers' | 'receipt' | 'network';
  pendingFormRequests?: boolean;
  automaticVerificationPending?: boolean;
  reconcileAfter?: string;
  preflightAfter?: string;
  submissionAttempted?: boolean;
  credentialAttempts?: Array<'signup' | 'signin'>;
  humanInterventionRequired?: boolean;
  submission?: { phase: 'prepared' | 'clicked' | 'dispatched' | 'confirmed'; clickedAt?: string; requests: Array<{ url: string; method: string; dispatchedAt: string; payloadHash: string; status?: number; responseHash?: string; headersHash?: string }> };
  evidenceDir?: string;
  submittedFields?: Array<{ label: string; selector: string; value: string | boolean }>;
  verificationMessageId?: string;
  receipt?: { url: string; text: string; verifiedAt: string; existing?: boolean; selector?: string; applicationId?: string; evidenceDir?: string; emailConfirmationId?: string; domEvidenceDir?: string };
  actions: AutofillFieldAction[];
  logs: string[];
}

export type AutoaplyJobBoard =
  | 'linkedin'
  | 'indeed'
  | 'ziprecruiter'
  | 'glassdoor'
  | 'monster'
  | 'dice'
  | 'wellfound'
  | 'direct_ats';

export type AutoaplyApplicationStatus =
  | 'queued'
  | 'applying'
  | 'applied'
  | 'skipped'
  | 'failed'
  | 'paused_for_review';

export type AutoaplyFeedbackType =
  | 'thumbs_up'
  | 'thumbs_down'
  | 'interview_requested'
  | 'rejected';

export interface AutoaplyJobItem {
  description?: string;
  fitCheckedAt?: string;
  reasonCode?: 'SUBMITTED_VERIFIED' | 'SKIPPED_CLOSED' | 'SKIPPED_YOE' | 'PARKED_MISSING_FACT' | 'PARKED_CAPTCHA' | 'PARKED_AUTH' | 'AMBIGUOUS_DISPATCH' | 'TRANSIENT_RETRY' | 'UNKNOWN';
  canonicalKey?: string;
  receipt?: BotRunReport['receipt'];
  id: string;
  externalJobId: string;
  title: string;
  company: string;
  jobUrl: string;
  jobBoard: AutoaplyJobBoard;
  location?: string;
  postedAt: string; // ISO date string
  status: AutoaplyApplicationStatus;
  feedbackType?: AutoaplyFeedbackType;
  appliedAt?: string;
  error?: string;
  nextAttemptAt?: string;
  retryCount?: number;
}

export interface AutoaplyQueueConfig {
  statePath?: string;
  candidateId?: string;
  maxAgeHours: number; // e.g. 4 for 4-hour high-priority window, 24 for standard
  maxDailyCredits?: number;
  remainingCredits?: number; // Infinity for unmetered continuous execution
  infiniteMode?: boolean; // When true (default in Jobscraper), auto-apply runs without credit restrictions
  preferredBoards?: AutoaplyJobBoard[];
  autoSkipOlderThanHours?: boolean;
}

export interface AutoaplyQueueMetrics {
  totalQueued: number;
  totalApplied: number;
  totalSkipped: number;
  totalFailed: number;
  interviewsRequested: number;
  creditsRemaining: number;
  infiniteMode: boolean;
}

