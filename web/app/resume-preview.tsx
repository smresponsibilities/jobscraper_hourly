'use client';

import React from 'react';
import type { TargetedResume } from '@/lib/career-types';

interface ResumePreviewProps {
  resume: TargetedResume;
}

export function ResumePreview({ resume }: ResumePreviewProps) {
  const { profile, settings } = resume;
  const { personalDetails, summary, experiences, education, skills, projects, certifications } = profile;

  const primaryExps = experiences.filter(e => e.displayType === 'EXPERIENCE');
  const otherExps = experiences.filter(e => e.displayType === 'OTHER_RELEVANT_EXPERIENCE');
  const activeSkills = skills.filter(s => s.included);
  const activeProjects = projects.filter(p => p.included);
  const activeCerts = certifications.filter(c => c.included);

  const accent = settings.accentColor || '#1e3a8a';
  const fontClass = settings.fontFamily === 'serif' ? 'font-serif' : 'font-sans';

  return (
    <div className={`resume-paper bg-white text-gray-900 shadow-xl border border-gray-200 p-8 md:p-10 rounded-sm max-w-[800px] mx-auto text-sm leading-relaxed ${fontClass}`}>
      {/* HEADER */}
      <header className="border-b pb-4 mb-5 text-center">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1.5" style={{ color: accent }}>
          {personalDetails.fullName || 'Your Name'}
        </h1>
        
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-gray-600">
          {personalDetails.email && (
            <a href={`mailto:${personalDetails.email}`} className="hover:underline">
              {personalDetails.email}
            </a>
          )}
          {personalDetails.phoneNumber && (
            <span>• {personalDetails.phoneNumber}</span>
          )}
          {personalDetails.location && (
            <span>• {personalDetails.location}</span>
          )}
          {personalDetails.linkedInUrl && (
            <span>
              •{' '}
              <a href={personalDetails.linkedInUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                {settings.contactLinkDisplay === 'urls' ? personalDetails.linkedInUrl : 'LinkedIn'}
              </a>
            </span>
          )}
          {personalDetails.portfolioUrl && (
            <span>
              •{' '}
              <a href={personalDetails.portfolioUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                {settings.contactLinkDisplay === 'urls' ? personalDetails.portfolioUrl : 'Portfolio / GitHub'}
              </a>
            </span>
          )}
        </div>

        {personalDetails.citizenshipDisplayText && (
          <div className="text-[11px] text-gray-500 mt-1 italic">
            {personalDetails.citizenshipDisplayText}
          </div>
        )}
      </header>

      {/* SUMMARY */}
      {summary && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-1.5 pb-0.5 border-b" style={{ color: accent, borderColor: accent }}>
            Professional Summary
          </h2>
          <p className="text-xs text-gray-800 leading-normal text-justify">
            {summary}
          </p>
        </section>
      )}

      {/* SKILLS */}
      {activeSkills.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-1.5 pb-0.5 border-b" style={{ color: accent, borderColor: accent }}>
            Technical Skills & Competencies
          </h2>
          <div className="text-xs text-gray-800 space-y-1">
            <p>
              <strong className="font-semibold text-gray-900">Core Technologies: </strong>
              {activeSkills.map(s => s.name).join(' • ')}
            </p>
          </div>
        </section>
      )}

      {/* PRIMARY EXPERIENCE */}
      {primaryExps.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-2 pb-0.5 border-b" style={{ color: accent, borderColor: accent }}>
            Professional Experience
          </h2>
          <div className="space-y-4">
            {primaryExps.map((exp) => (
              <div key={exp.id} className="text-xs">
                <div className="flex justify-between items-baseline mb-0.5">
                  <span className="font-bold text-gray-900 text-[13px]">{exp.title}</span>
                  <span className="text-gray-600 font-medium">{exp.startDate} – {exp.endDate}</span>
                </div>
                <div className="flex justify-between items-baseline text-gray-700 italic mb-1.5">
                  <span>{exp.companyName}</span>
                  <span>{exp.location}</span>
                </div>

                {/* Scope & Scale Statement */}
                {exp.scopeScale?.primaryFocus && (
                  <div className="bg-gray-50 border-l-2 p-1.5 mb-1.5 text-[11px] text-gray-700 italic" style={{ borderColor: accent }}>
                    <strong>Scope & Scale: </strong>{exp.scopeScale.primaryFocus}
                  </div>
                )}

                {/* Achievements */}
                <ul className="list-disc list-outside ml-4 space-y-1 text-gray-800 text-[12px]">
                  {exp.achievements.map((ach) => (
                    <li key={ach.id} className="leading-snug">
                      {ach.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* OTHER RELEVANT EXPERIENCE */}
      {otherExps.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-2 pb-0.5 border-b" style={{ color: accent, borderColor: accent }}>
            Other Relevant Experience
          </h2>
          <div className="space-y-3">
            {otherExps.map((exp) => (
              <div key={exp.id} className="text-xs">
                <div className="flex justify-between items-baseline mb-0.5">
                  <span className="font-bold text-gray-900">{exp.title} • <span className="font-normal italic">{exp.companyName}</span></span>
                  <span className="text-gray-600">{exp.startDate} – {exp.endDate}</span>
                </div>
                <ul className="list-disc list-outside ml-4 space-y-0.5 text-gray-800 text-[12px]">
                  {exp.achievements.map((ach) => (
                    <li key={ach.id} className="leading-snug">
                      {ach.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* PROJECTS */}
      {activeProjects.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-2 pb-0.5 border-b" style={{ color: accent, borderColor: accent }}>
            Selected Engineering Projects
          </h2>
          <div className="space-y-3">
            {activeProjects.map((proj) => (
              <div key={proj.id} className="text-xs">
                <div className="flex justify-between items-baseline mb-0.5">
                  <span className="font-bold text-gray-900">
                    {proj.title} {proj.role && <span className="font-normal text-gray-600">({proj.role})</span>}
                  </span>
                  {proj.link && (
                    <a href={proj.link} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline text-[11px]">
                      View Project
                    </a>
                  )}
                </div>
                {proj.technologies.length > 0 && (
                  <p className="text-[11px] text-gray-600 mb-1">
                    <em>Tech Stack:</em> {proj.technologies.join(', ')}
                  </p>
                )}
                <p className="text-gray-700 mb-1">{proj.description}</p>
                {proj.bullets.length > 0 && (
                  <ul className="list-disc list-outside ml-4 space-y-0.5 text-gray-800 text-[12px]">
                    {proj.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* EDUCATION */}
      {education.length > 0 && (
        <section className="mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-2 pb-0.5 border-b" style={{ color: accent, borderColor: accent }}>
            Education
          </h2>
          <div className="space-y-2">
            {education.map((edu) => (
              <div key={edu.id} className="text-xs flex justify-between items-baseline">
                <div>
                  <div className="font-bold text-gray-900">{edu.credential}</div>
                  <div className="text-gray-700 italic">{edu.school} — {edu.location}</div>
                </div>
                <div className="text-right text-gray-600">
                  <div>Graduation: {edu.endDate}</div>
                  {edu.gpa && <div className="text-[11px]">GPA: {edu.gpa}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CERTIFICATIONS */}
      {activeCerts.length > 0 && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-wider mb-1.5 pb-0.5 border-b" style={{ color: accent, borderColor: accent }}>
            Certifications
          </h2>
          <div className="text-xs text-gray-800 flex flex-wrap gap-x-4 gap-y-1">
            {activeCerts.map((cert) => (
              <div key={cert.id}>
                <strong>{cert.name}</strong> — {cert.issuer} ({cert.date})
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
