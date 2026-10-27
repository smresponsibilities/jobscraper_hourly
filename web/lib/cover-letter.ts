// Role-Specific Cover Letter Generator
// Based on recruiter-built positioning: Hook + Demonstrated Evidence + Closing

import type { TargetedResume } from './career-types';

export interface CoverLetterParams {
  resume: TargetedResume;
  companyName: string;
  roleTitle: string;
  jobDescription?: string;
  hiringManagerName?: string;
}

export function generateCoverLetter(params: CoverLetterParams): string {
  const { resume, companyName, roleTitle, hiringManagerName } = params;
  const { personalDetails, experiences, skills } = resume.profile;

  const primaryExp = experiences.find(e => e.displayType === 'EXPERIENCE') || experiences[0];
  const primaryRole = primaryExp?.title || 'Software Engineer';
  const primaryCompany = primaryExp?.companyName || 'current projects';
  const topAchievement = primaryExp?.achievements[0]?.text || 
    'architected automated backend systems that dramatically reduced latency and operational overhead';

  const topSkills = skills
    .filter(s => s.included)
    .slice(0, 4)
    .map(s => s.name)
    .join(', ');

  const salutation = hiringManagerName 
    ? `Dear ${hiringManagerName},`
    : `Dear ${companyName} Hiring Team,`;

  return `${salutation}

I am writing to express my strong enthusiasm for the ${roleTitle} position at ${companyName}. As a Software Engineer specializing in ${topSkills || 'distributed systems and modern software engineering'}, I have focused my work on building observable, high-throughput backend services and performant applications that directly solve production challenges.

In my recent work at ${primaryCompany} as a ${primaryRole}, I ${topAchievement.replace(/^[A-Z]/, c => c.toLowerCase()).replace(/\.$/, '')}. This experience reinforced my disciplined approach to writing clean, maintainable code, implementing resilient error boundaries, and optimizing system performance under real-world traffic.

${companyName}'s engineering culture and focus on scalable systems strongly align with my background and technical goals. I would welcome the opportunity to discuss how my hands-on background in ${topSkills} can contribute to your team's immediate milestones.

Thank you for your time and consideration.

Sincerely,

${personalDetails.fullName}
${personalDetails.email} | ${personalDetails.phoneNumber}
${personalDetails.location}
${personalDetails.linkedInUrl}`;
}
