// Resume Export & Formatting Engine (ATS Plaintext, Print/PDF, DOCX)

import type { TargetedResume } from './career-types';

export function exportToPlainText(resume: TargetedResume): string {
  const { personalDetails, summary, experiences, education, skills, projects, certifications } = resume.profile;

  const lines: string[] = [];

  // Header
  lines.push(personalDetails.fullName.toUpperCase());
  const contactParts = [
    personalDetails.email,
    personalDetails.phoneNumber,
    personalDetails.location,
    personalDetails.linkedInUrl,
    personalDetails.portfolioUrl
  ].filter(Boolean);
  lines.push(contactParts.join(' | '));
  if (personalDetails.citizenshipDisplayText) {
    lines.push(personalDetails.citizenshipDisplayText);
  }
  lines.push('');

  // Summary
  if (summary) {
    lines.push('PROFESSIONAL SUMMARY');
    lines.push('--------------------');
    lines.push(summary);
    lines.push('');
  }

  // Skills
  const activeSkills = skills.filter(s => s.included);
  if (activeSkills.length > 0) {
    lines.push('TECHNICAL SKILLS & COMPETENCIES');
    lines.push('-------------------------------');
    const categories: Record<string, string[]> = {};
    for (const sk of activeSkills) {
      if (!categories[sk.category]) categories[sk.category] = [];
      categories[sk.category].push(sk.name);
    }
    for (const [cat, skList] of Object.entries(categories)) {
      lines.push(`${cat}: ${skList.join(', ')}`);
    }
    lines.push('');
  }

  // Experience
  const primaryExps = experiences.filter(e => e.displayType === 'EXPERIENCE');
  if (primaryExps.length > 0) {
    lines.push('PROFESSIONAL EXPERIENCE');
    lines.push('-----------------------');
    for (const exp of primaryExps) {
      lines.push(`${exp.title} | ${exp.companyName} | ${exp.location}`);
      lines.push(`${exp.startDate} - ${exp.endDate}`);
      if (exp.scopeScale?.primaryFocus) {
        lines.push(`Scope & Scale: ${exp.scopeScale.primaryFocus}`);
      }
      for (const ach of exp.achievements) {
        lines.push(`* ${ach.text}`);
      }
      lines.push('');
    }
  }

  // Other Relevant Experience
  const otherExps = experiences.filter(e => e.displayType === 'OTHER_RELEVANT_EXPERIENCE');
  if (otherExps.length > 0) {
    lines.push('OTHER RELEVANT EXPERIENCE');
    lines.push('-------------------------');
    for (const exp of otherExps) {
      lines.push(`${exp.title} | ${exp.companyName} | ${exp.startDate} - ${exp.endDate}`);
      for (const ach of exp.achievements) {
        lines.push(`* ${ach.text}`);
      }
      lines.push('');
    }
  }

  // Projects
  const activeProjects = projects.filter(p => p.included);
  if (activeProjects.length > 0) {
    lines.push('SELECTED TECHNICAL PROJECTS');
    lines.push('---------------------------');
    for (const proj of activeProjects) {
      lines.push(`${proj.title} ${proj.role ? `(${proj.role})` : ''} ${proj.link ? `| ${proj.link}` : ''}`);
      if (proj.technologies.length > 0) {
        lines.push(`Technologies: ${proj.technologies.join(', ')}`);
      }
      if (proj.description) {
        lines.push(proj.description);
      }
      for (const b of proj.bullets) {
        lines.push(`* ${b}`);
      }
      lines.push('');
    }
  }

  // Education
  if (education.length > 0) {
    lines.push('EDUCATION');
    lines.push('---------');
    for (const edu of education) {
      lines.push(`${edu.credential} | ${edu.school} | ${edu.location}`);
      lines.push(`Graduation: ${edu.endDate}${edu.gpa ? ` | GPA: ${edu.gpa}` : ''}`);
      lines.push('');
    }
  }

  // Certifications
  const activeCerts = certifications.filter(c => c.included);
  if (activeCerts.length > 0) {
    lines.push('CERTIFICATIONS');
    lines.push('--------------');
    for (const cert of activeCerts) {
      lines.push(`* ${cert.name} - ${cert.issuer} (${cert.date})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function downloadPlainText(resume: TargetedResume): void {
  const plainText = exportToPlainText(resume);
  const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${resume.profile.personalDetails.fullName.replace(/\s+/g, '_')}_Resume.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadDocxHtml(resume: TargetedResume): void {
  const { personalDetails, summary, experiences, education, skills, projects, certifications } = resume.profile;
  const name = personalDetails.fullName || 'Candidate';
  const contactParts = [
    personalDetails.email,
    personalDetails.phoneNumber,
    personalDetails.location,
    personalDetails.linkedInUrl,
    personalDetails.portfolioUrl
  ].filter(Boolean);

  const primaryExps = experiences.filter(e => e.displayType === 'EXPERIENCE');
  const otherExps = experiences.filter(e => e.displayType === 'OTHER_RELEVANT_EXPERIENCE');
  const activeSkills = skills.filter(s => s.included);
  const activeProjects = projects.filter(p => p.included);
  const activeCerts = certifications.filter(c => c.included);

  const html = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset="utf-8">
<title>${name} - Resume</title>
<style>
body { font-family: 'Calibri', 'Arial', sans-serif; font-size: 11pt; line-height: 1.35; color: #111827; }
h1 { font-size: 18pt; margin: 0 0 4pt 0; text-transform: uppercase; color: #1e3a8a; letter-spacing: 0.5pt; }
h2 { font-size: 12pt; margin: 12pt 0 4pt 0; text-transform: uppercase; border-bottom: 1.5pt solid #1e3a8a; padding-bottom: 2pt; color: #1e3a8a; font-weight: bold; }
.contact { font-size: 9.5pt; color: #4b5563; margin-bottom: 8pt; }
.role-header { font-weight: bold; margin-top: 6pt; }
.role-sub { color: #4b5563; font-size: 10pt; margin-bottom: 3pt; }
.scope { font-style: italic; color: #374151; margin: 2pt 0 4pt 0; }
ul { margin: 2pt 0 6pt 18pt; padding: 0; }
li { margin-bottom: 3pt; }
</style>
</head>
<body>
<h1>${name}</h1>
<div class="contact">${contactParts.join(' &nbsp;|&nbsp; ')}${personalDetails.citizenshipDisplayText ? `<br>${personalDetails.citizenshipDisplayText}` : ''}</div>

${summary ? `<h2>Professional Summary</h2><p>${summary}</p>` : ''}

${activeSkills.length > 0 ? `
<h2>Technical Skills & Competencies</h2>
<p>${activeSkills.map(s => s.name).join(' &bull; ')}</p>` : ''}

${primaryExps.length > 0 ? `
<h2>Professional Experience</h2>
${primaryExps.map(exp => `
<div class="role-header">${exp.title} &mdash; <strong>${exp.companyName}</strong> (${exp.location})</div>
<div class="role-sub">${exp.startDate} &ndash; ${exp.endDate}</div>
${exp.scopeScale?.primaryFocus ? `<div class="scope">Scope & Scale: ${exp.scopeScale.primaryFocus}</div>` : ''}
<ul>
${exp.achievements.map(a => `<li>${a.text}</li>`).join('')}
</ul>
`).join('')}` : ''}

${otherExps.length > 0 ? `
<h2>Other Relevant Experience</h2>
${otherExps.map(exp => `
<div class="role-header">${exp.title} &mdash; <strong>${exp.companyName}</strong></div>
<div class="role-sub">${exp.startDate} &ndash; ${exp.endDate}</div>
<ul>
${exp.achievements.map(a => `<li>${a.text}</li>`).join('')}
</ul>
`).join('')}` : ''}

${activeProjects.length > 0 ? `
<h2>Selected Technical Projects</h2>
${activeProjects.map(proj => `
<div class="role-header">${proj.title} ${proj.role ? `(${proj.role})` : ''} ${proj.link ? `&mdash; ${proj.link}` : ''}</div>
${proj.technologies.length > 0 ? `<div class="role-sub">Technologies: ${proj.technologies.join(', ')}</div>` : ''}
${proj.description ? `<p style="margin: 2pt 0 3pt 0;">${proj.description}</p>` : ''}
<ul>
${proj.bullets.map(b => `<li>${b}</li>`).join('')}
</ul>
`).join('')}` : ''}

${education.length > 0 ? `
<h2>Education</h2>
${education.map(edu => `
<div class="role-header">${edu.credential} &mdash; ${edu.school} (${edu.location})</div>
<div class="role-sub">Graduation: ${edu.endDate}${edu.gpa ? ` | GPA: ${edu.gpa}` : ''}</div>
`).join('')}` : ''}

${activeCerts.length > 0 ? `
<h2>Certifications</h2>
<ul>
${activeCerts.map(c => `<li>${c.name} &mdash; ${c.issuer} (${c.date})</li>`).join('')}
</ul>` : ''}

</body>
</html>`;

  const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/\s+/g, '_')}_Resume.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
