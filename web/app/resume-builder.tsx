'use client';

import React, { useState } from 'react';
import type { TargetedResume, ExperienceRole, Achievement } from '@/lib/career-types';
import { ResumePreview } from './resume-preview';
import { exportToPlainText, downloadDocxHtml, downloadPlainText } from '@/lib/resume-export';

interface ResumeBuilderProps {
  resumes: TargetedResume[];
  activeResumeId: string;
  onSelectResume: (id: string) => void;
  onUpdateResume: (updated: TargetedResume) => void;
  onCreateTargetedResume: (name: string, targetRole: string, targetCompany: string, jd: string) => void;
  onDeleteResume: (id: string) => void;
}

const ACCENT_COLORS = [
  { name: 'Navy', hex: '#1e3a8a' },
  { name: 'Slate', hex: '#334155' },
  { name: 'Charcoal', hex: '#111827' },
  { name: 'Burgundy', hex: '#831843' },
  { name: 'Forest', hex: '#065f46' },
  { name: 'Indigo', hex: '#4338ca' }
];

export function ResumeBuilderView({
  resumes,
  activeResumeId,
  onSelectResume,
  onUpdateResume,
  onCreateTargetedResume,
  onDeleteResume
}: ResumeBuilderProps) {
  const currentResume = resumes.find(r => r.id === activeResumeId) || resumes[0];

  const [activeTab, setActiveTab] = useState<'editor' | 'preview' | 'designer'>('editor');
  const [editorSection, setEditorSection] = useState<'contact' | 'summary' | 'experience' | 'skills' | 'projects' | 'education'>('experience');

  // New Targeted Resume Modal state
  const [showNewModal, setShowNewModal] = useState(false);
  const [newResumeName, setNewResumeName] = useState('');
  const [newTargetRole, setNewTargetRole] = useState('');
  const [newTargetCompany, setNewTargetCompany] = useState('');
  const [newTargetJd, setNewTargetJd] = useState('');

  // Active role being edited in experience section
  const [selectedExpId, setSelectedExpId] = useState<string>(
    currentResume?.profile.experiences[0]?.id || ''
  );

  // New bullet input
  const [newBulletText, setNewBulletText] = useState('');
  const [newSkillText, setNewSkillText] = useState('');

  if (!currentResume) return <div>No resume loaded</div>;

  const { profile, settings } = currentResume;

  function updateProfile(updater: (prev: typeof profile) => typeof profile) {
    const updatedProfile = updater(profile);
    onUpdateResume({
      ...currentResume,
      profile: updatedProfile,
      updatedAt: new Date().toISOString()
    });
  }

  function handleCreateNewTargeted(e: React.FormEvent) {
    e.preventDefault();
    if (!newResumeName.trim()) return;
    onCreateTargetedResume(newResumeName, newTargetRole, newTargetCompany, newTargetJd);
    setShowNewModal(false);
    setNewResumeName('');
    setNewTargetRole('');
    setNewTargetCompany('');
    setNewTargetJd('');
  }

  function handleAddBullet(expId: string) {
    if (!newBulletText.trim()) return;
    const newAch: Achievement = {
      id: `ach-${Date.now()}`,
      text: newBulletText.trim(),
      sourceType: 'ACHIEVEMENT'
    };
    updateProfile(p => ({
      ...p,
      experiences: p.experiences.map(e => e.id === expId ? {
        ...e,
        achievements: [...e.achievements, newAch]
      } : e)
    }));
    setNewBulletText('');
  }

  function handleDeleteBullet(expId: string, achId: string) {
    updateProfile(p => ({
      ...p,
      experiences: p.experiences.map(e => e.id === expId ? {
        ...e,
        achievements: e.achievements.filter(a => a.id !== achId)
      } : e)
    }));
  }

  function handleAddSkill() {
    if (!newSkillText.trim()) return;
    updateProfile(p => ({
      ...p,
      skills: [...p.skills, {
        id: `sk-${Date.now()}`,
        name: newSkillText.trim(),
        category: 'Technical',
        included: true
      }]
    }));
    setNewSkillText('');
  }

  function handleCopyPlaintext() {
    const txt = exportToPlainText(currentResume);
    navigator.clipboard.writeText(txt);
    alert('Resume plain text copied to clipboard! Ready to paste into ATS text fields.');
  }

  return (
    <div className="space-y-6">
      {/* RESUME SELECTOR & ACTION BAR */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Active Resume:
          </label>
          <select
            value={currentResume.id}
            onChange={(e) => onSelectResume(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm font-semibold text-gray-800 bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {resumes.map(r => (
              <option key={r.id} value={r.id}>
                {r.name} {r.isDefaultBaseline ? '(Baseline)' : `[${r.targetCompany || 'Targeted'}]`}
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowNewModal(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition shadow-sm"
          >
            + Create Targeted Resume
          </button>

          {!currentResume.isDefaultBaseline && (
            <button
              onClick={() => {
                if (confirm(`Delete targeted resume "${currentResume.name}"?`)) {
                  onDeleteResume(currentResume.id);
                }
              }}
              className="text-xs text-red-600 hover:text-red-800"
            >
              Delete
            </button>
          )}
        </div>

        {/* VIEW TABS & EXPORT */}
        <div className="flex items-center gap-2">
          <div className="bg-gray-100 p-1 rounded flex text-xs font-medium">
            <button
              onClick={() => setActiveTab('editor')}
              className={`px-3 py-1 rounded ${activeTab === 'editor' ? 'bg-white shadow-xs text-gray-900 font-semibold' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Editor
            </button>
            <button
              onClick={() => setActiveTab('preview')}
              className={`px-3 py-1 rounded ${activeTab === 'preview' ? 'bg-white shadow-xs text-gray-900 font-semibold' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Preview
            </button>
            <button
              onClick={() => setActiveTab('designer')}
              className={`px-3 py-1 rounded ${activeTab === 'designer' ? 'bg-white shadow-xs text-gray-900 font-semibold' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Design & Format
            </button>
          </div>

          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 bg-gray-900 hover:bg-black text-white text-xs font-medium rounded transition"
            title="Print or Save as PDF"
          >
            Print / PDF
          </button>

          <button
            onClick={() => downloadDocxHtml(currentResume)}
            className="px-3 py-1.5 border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium rounded transition"
            title="Download Word (.doc) format"
          >
            Export Word
          </button>

          <button
            onClick={() => downloadPlainText(currentResume)}
            className="px-3 py-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-xs font-medium rounded transition"
            title="Download Plaintext ATS format"
          >
            Export TXT
          </button>

          <button
            onClick={handleCopyPlaintext}
            className="px-2.5 py-1.5 border border-gray-300 hover:bg-gray-50 text-gray-600 text-xs rounded transition"
            title="Copy Plaintext to clipboard"
          >
            Copy ATS
          </button>
        </div>
      </div>

      {/* TARGET ROLE BANNER (if targeted resume) */}
      {currentResume.targetRole && (
        <div className="bg-blue-50 border border-blue-200 p-3 rounded text-xs text-blue-900 flex justify-between items-center">
          <div>
            <strong>Targeting: </strong>
            <span className="font-semibold">{currentResume.targetRole}</span> at{' '}
            <span className="font-semibold">{currentResume.targetCompany || 'Target Employer'}</span>
          </div>
          <span className="text-[11px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-medium">
            Role-Optimized Resume
          </span>
        </div>
      )}

      {/* MAIN VIEW CONTENT */}
      {activeTab === 'preview' && (
        <div className="py-4">
          <ResumePreview resume={currentResume} />
        </div>
      )}

      {activeTab === 'designer' && (
        <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm max-w-xl mx-auto space-y-6">
          <h2 className="text-base font-bold text-gray-900 border-b pb-2">Resume Designer & Settings</h2>

          {/* ACCENT COLOR */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">Accent Color</label>
            <div className="flex gap-3">
              {ACCENT_COLORS.map(c => (
                <button
                  key={c.hex}
                  onClick={() => onUpdateResume({
                    ...currentResume,
                    settings: { ...settings, accentColor: c.hex }
                  })}
                  className={`w-8 h-8 rounded-full border-2 transition ${settings.accentColor === c.hex ? 'ring-2 ring-offset-2 ring-blue-600 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c.hex }}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* FONT FAMILY */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">Typography</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
                <input
                  type="radio"
                  name="fontFamily"
                  checked={settings.fontFamily === 'serif'}
                  onChange={() => onUpdateResume({
                    ...currentResume,
                    settings: { ...settings, fontFamily: 'serif' }
                  })}
                />
                <span className="font-serif">Classic Serif (Times/Georgia - Traditional ATS)</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
                <input
                  type="radio"
                  name="fontFamily"
                  checked={settings.fontFamily === 'sans'}
                  onChange={() => onUpdateResume({
                    ...currentResume,
                    settings: { ...settings, fontFamily: 'sans' }
                  })}
                />
                <span className="font-sans">Modern Sans (Clean & Tech-Forward)</span>
              </label>
            </div>
          </div>

          {/* CONTACT DISPLAY */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-2">Contact Links Display</label>
            <select
              value={settings.contactLinkDisplay}
              onChange={(e) => onUpdateResume({
                ...currentResume,
                settings: { ...settings, contactLinkDisplay: e.target.value as 'clean' | 'urls' }
              })}
              className="border border-gray-300 rounded px-3 py-1.5 text-xs text-gray-800 w-full"
            >
              <option value="clean">Clean Text ("LinkedIn", "Portfolio")</option>
              <option value="urls">Full URLs (https://linkedin.com/in/...)</option>
            </select>
          </div>

          <div className="pt-4 border-t flex justify-end">
            <button
              onClick={() => setActiveTab('preview')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
            >
              View Updated Preview
            </button>
          </div>
        </div>
      )}

      {activeTab === 'editor' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* SECTION NAVIGATION BAR */}
          <div className="lg:col-span-3 bg-white p-3 rounded-lg border border-gray-200 shadow-sm space-y-1">
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-2 py-1">
              Resume Sections
            </div>
            {[
              { id: 'contact', label: 'Personal Details' },
              { id: 'summary', label: 'Career Profile / Summary' },
              { id: 'experience', label: 'Experience & Scope' },
              { id: 'skills', label: 'Skills & Competencies' },
              { id: 'projects', label: 'Technical Projects' },
              { id: 'education', label: 'Education' }
            ].map(sec => (
              <button
                key={sec.id}
                onClick={() => setEditorSection(sec.id as any)}
                className={`w-full text-left px-3 py-2 rounded text-xs font-medium transition ${editorSection === sec.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                {sec.label}
              </button>
            ))}
          </div>

          {/* SECTION FORM EDITOR */}
          <div className="lg:col-span-9 bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            {/* 1. PERSONAL DETAILS */}
            {editorSection === 'contact' && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 border-b pb-2">Personal Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      value={profile.personalDetails.fullName}
                      onChange={e => updateProfile(p => ({
                        ...p,
                        personalDetails: { ...p.personalDetails, fullName: e.target.value }
                      }))}
                      className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={profile.personalDetails.email}
                      onChange={e => updateProfile(p => ({
                        ...p,
                        personalDetails: { ...p.personalDetails, email: e.target.value }
                      }))}
                      className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Phone Number</label>
                    <input
                      type="text"
                      value={profile.personalDetails.phoneNumber}
                      onChange={e => updateProfile(p => ({
                        ...p,
                        personalDetails: { ...p.personalDetails, phoneNumber: e.target.value }
                      }))}
                      className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Location</label>
                    <input
                      type="text"
                      value={profile.personalDetails.location}
                      placeholder="Bengaluru, India"
                      onChange={e => updateProfile(p => ({
                        ...p,
                        personalDetails: { ...p.personalDetails, location: e.target.value }
                      }))}
                      className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">LinkedIn URL</label>
                    <input
                      type="url"
                      value={profile.personalDetails.linkedInUrl}
                      onChange={e => updateProfile(p => ({
                        ...p,
                        personalDetails: { ...p.personalDetails, linkedInUrl: e.target.value }
                      }))}
                      className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Portfolio / GitHub URL</label>
                    <input
                      type="url"
                      value={profile.personalDetails.portfolioUrl || ''}
                      onChange={e => updateProfile(p => ({
                        ...p,
                        personalDetails: { ...p.personalDetails, portfolioUrl: e.target.value }
                      }))}
                      className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 2. SUMMARY / CAREER PROFILE */}
            {editorSection === 'summary' && (
              <div className="space-y-4">
                <div className="flex justify-between items-baseline border-b pb-2">
                  <h3 className="text-sm font-bold text-gray-900">Career Profile / Professional Summary</h3>
                  <span className="text-xs text-gray-500">
                    {profile.summary.trim() ? profile.summary.trim().split(/\s+/).length : 0} words (Target: 30–80)
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Bryan Creely Recruiter Tip: State your core engineering domain, scale of problems solved, and measurable impact in 3–4 sentences. Never write generic "Looking for an opportunity to learn" objectives.
                </p>
                <textarea
                  rows={5}
                  value={profile.summary}
                  onChange={e => updateProfile(p => ({ ...p, summary: e.target.value }))}
                  className="w-full border rounded p-3 text-xs text-gray-900 leading-relaxed font-sans"
                  placeholder="Software Engineer specializing in high-throughput backend services, distributed systems, and real-time pipelines..."
                />
              </div>
            )}

            {/* 3. EXPERIENCE & SCOPE */}
            {editorSection === 'experience' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center border-b pb-2">
                  <h3 className="text-sm font-bold text-gray-900">Experiences & Scope/Scale Statements</h3>
                  <button
                    onClick={() => {
                      const newExp: ExperienceRole = {
                        id: `exp-${Date.now()}`,
                        companyName: 'New Company',
                        title: 'Software Engineer',
                        location: 'Bengaluru, India',
                        startDate: '01/2026',
                        endDate: 'Present',
                        isCurrent: true,
                        displayType: 'EXPERIENCE',
                        achievements: []
                      };
                      updateProfile(p => ({ ...p, experiences: [...p.experiences, newExp] }));
                      setSelectedExpId(newExp.id);
                    }}
                    className="text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 px-2.5 py-1 rounded font-medium"
                  >
                    + Add Experience
                  </button>
                </div>

                {/* Role Tabs */}
                <div className="flex flex-wrap gap-2">
                  {profile.experiences.map(e => (
                    <button
                      key={e.id}
                      onClick={() => setSelectedExpId(e.id)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition ${selectedExpId === e.id ? 'bg-gray-900 text-white font-semibold' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      {e.companyName || 'Untitled Company'}
                    </button>
                  ))}
                </div>

                {/* Selected Role Form */}
                {(() => {
                  const role = profile.experiences.find(e => e.id === selectedExpId) || profile.experiences[0];
                  if (!role) return <div className="text-xs text-gray-500">No experiences added yet.</div>;

                  function updateRole(updater: (r: ExperienceRole) => ExperienceRole) {
                    updateProfile(p => ({
                      ...p,
                      experiences: p.experiences.map(e => e.id === role.id ? updater(e) : e)
                    }));
                  }

                  return (
                    <div className="space-y-5 bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Company</label>
                          <input
                            type="text"
                            value={role.companyName}
                            onChange={e => updateRole(r => ({ ...r, companyName: e.target.value }))}
                            className="w-full border rounded px-2.5 py-1 text-xs text-gray-900 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Job Title</label>
                          <input
                            type="text"
                            value={role.title}
                            onChange={e => updateRole(r => ({ ...r, title: e.target.value }))}
                            className="w-full border rounded px-2.5 py-1 text-xs text-gray-900 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Location</label>
                          <input
                            type="text"
                            value={role.location}
                            onChange={e => updateRole(r => ({ ...r, location: e.target.value }))}
                            className="w-full border rounded px-2.5 py-1 text-xs text-gray-900 bg-white"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Dates</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={role.startDate}
                              placeholder="01/2026"
                              onChange={e => updateRole(r => ({ ...r, startDate: e.target.value }))}
                              className="w-1/2 border rounded px-2 py-1 text-xs text-gray-900 bg-white"
                            />
                            <input
                              type="text"
                              value={role.endDate}
                              placeholder="Present"
                              onChange={e => updateRole(r => ({ ...r, endDate: e.target.value }))}
                              className="w-1/2 border rounded px-2 py-1 text-xs text-gray-900 bg-white"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Section Placement</label>
                          <select
                            value={role.displayType}
                            onChange={e => updateRole(r => ({ ...r, displayType: e.target.value as any }))}
                            className="w-full border rounded px-2.5 py-1 text-xs text-gray-900 bg-white"
                          >
                            <option value="EXPERIENCE">Primary Experience (Highlighted)</option>
                            <option value="OTHER_RELEVANT_EXPERIENCE">Other Relevant Experience (Condensed)</option>
                            <option value="INACTIVE">Hidden from this resume</option>
                          </select>
                        </div>

                        <div className="flex items-end">
                          <button
                            onClick={() => {
                              if (confirm(`Delete role ${role.companyName}?`)) {
                                updateProfile(p => ({
                                  ...p,
                                  experiences: p.experiences.filter(e => e.id !== role.id)
                                }));
                              }
                            }}
                            className="text-xs text-red-600 hover:text-red-800 pb-1"
                          >
                            Delete Role
                          </button>
                        </div>
                      </div>

                      {/* SCOPE & SCALE STATEMENT */}
                      <div className="bg-amber-50 border border-amber-200 p-3 rounded space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                            Scope & Scale Opening Statement (Resume Rocketfuel)
                          </span>
                        </div>
                        <p className="text-[11px] text-amber-800">
                          Explain operating level: team size, user volume, system throughput, or architectural reach.
                        </p>
                        <input
                          type="text"
                          value={role.scopeScale?.primaryFocus || ''}
                          placeholder="Core backend ingestion engine processing data across 3,800+ distributed endpoints."
                          onChange={e => updateRole(r => ({
                            ...r,
                            scopeScale: {
                              ...r.scopeScale,
                              primaryFocus: e.target.value
                            }
                          }))}
                          className="w-full border rounded px-3 py-1.5 text-xs text-gray-900 bg-white"
                        />
                      </div>

                      {/* ACHIEVEMENTS / BULLETS */}
                      <div className="space-y-3">
                        <label className="block text-xs font-bold text-gray-800">
                          Achievements & Bullets ({role.achievements.length})
                        </label>

                        <div className="space-y-2">
                          {role.achievements.map((ach) => (
                            <div key={ach.id} className="bg-white p-2.5 rounded border border-gray-200 flex justify-between items-start gap-2">
                              <p className="text-xs text-gray-900 leading-snug flex-1">
                                {ach.text}
                              </p>
                              <button
                                onClick={() => handleDeleteBullet(role.id, ach.id)}
                                className="text-gray-400 hover:text-red-600 text-xs px-1"
                                title="Remove bullet"
                              >
                                &times;
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* ADD BULLET INPUT */}
                        <div className="space-y-1.5 pt-2">
                          <textarea
                            rows={2}
                            value={newBulletText}
                            onChange={e => setNewBulletText(e.target.value)}
                            placeholder="Add achievement bullet (Lead with action verb + measurable metric + business result)..."
                            className="w-full border rounded p-2 text-xs text-gray-900 bg-white"
                          />
                          <button
                            onClick={() => handleAddBullet(role.id)}
                            className="px-3 py-1 bg-gray-900 hover:bg-black text-white rounded text-xs font-medium"
                          >
                            + Add Bullet
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* 4. SKILLS */}
            {editorSection === 'skills' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b pb-2">
                  <h3 className="text-sm font-bold text-gray-900">Technical Skills & Competencies</h3>
                </div>

                <div className="flex flex-wrap gap-2">
                  {profile.skills.map(sk => (
                    <span
                      key={sk.id}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border ${sk.included ? 'bg-blue-50 text-blue-800 border-blue-200' : 'bg-gray-100 text-gray-400 border-gray-200 line-through'}`}
                    >
                      <button
                        onClick={() => {
                          updateProfile(p => ({
                            ...p,
                            skills: p.skills.map(s => s.id === sk.id ? { ...s, included: !s.included } : s)
                          }));
                        }}
                      >
                        {sk.name}
                      </button>
                      <button
                        onClick={() => {
                          updateProfile(p => ({
                            ...p,
                            skills: p.skills.filter(s => s.id !== sk.id)
                          }));
                        }}
                        className="text-gray-400 hover:text-red-600 ml-1"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>

                <div className="flex gap-2 pt-2">
                  <input
                    type="text"
                    value={newSkillText}
                    onChange={e => setNewSkillText(e.target.value)}
                    placeholder="Add skill (e.g. Docker, PostgreSQL, Go)..."
                    className="border rounded px-3 py-1.5 text-xs text-gray-900 flex-1"
                  />
                  <button
                    onClick={handleAddSkill}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {/* 5. PROJECTS */}
            {editorSection === 'projects' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center border-b pb-2">
                  <h3 className="text-sm font-bold text-gray-900">Technical Projects (Max 3 in Targeted Resume)</h3>
                </div>
                <div className="space-y-3">
                  {profile.projects.map(proj => (
                    <div key={proj.id} className="border p-3 rounded bg-gray-50 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-xs text-gray-900">{proj.title}</span>
                        <label className="text-xs text-gray-600 flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={proj.included}
                            onChange={e => {
                              updateProfile(p => ({
                                ...p,
                                projects: p.projects.map(pr => pr.id === proj.id ? { ...pr, included: e.target.checked } : pr)
                              }));
                            }}
                          />
                          Include on resume
                        </label>
                      </div>
                      <p className="text-xs text-gray-700">{proj.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. EDUCATION */}
            {editorSection === 'education' && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 border-b pb-2">Education Credentials</h3>
                {profile.education.map(edu => (
                  <div key={edu.id} className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-gray-50 p-3 rounded border">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Degree / Credential</label>
                      <input
                        type="text"
                        value={edu.credential}
                        onChange={e => updateProfile(p => ({
                          ...p,
                          education: p.education.map(ed => ed.id === edu.id ? { ...ed, credential: e.target.value } : ed)
                        }))}
                        className="w-full border rounded px-2.5 py-1 text-xs text-gray-900 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">University / Institution</label>
                      <input
                        type="text"
                        value={edu.school}
                        onChange={e => updateProfile(p => ({
                          ...p,
                          education: p.education.map(ed => ed.id === edu.id ? { ...ed, school: e.target.value } : ed)
                        }))}
                        className="w-full border rounded px-2.5 py-1 text-xs text-gray-900 bg-white"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CREATE TARGETED RESUME MODAL */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full p-6 space-y-4">
            <h2 className="text-base font-bold text-gray-900 border-b pb-2">
              Create Role-Targeted Resume
            </h2>
            <p className="text-xs text-gray-600">
              Create an optimized version of your baseline profile tailored specifically for a target role or company.
            </p>

            <form onSubmit={handleCreateNewTargeted} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Resume Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Razorpay - Backend SDE"
                  value={newResumeName}
                  onChange={e => setNewResumeName(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Target Role</label>
                  <input
                    type="text"
                    placeholder="e.g. Backend Engineer I"
                    value={newTargetRole}
                    onChange={e => setNewTargetRole(e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Target Company</label>
                  <input
                    type="text"
                    placeholder="e.g. Razorpay"
                    value={newTargetCompany}
                    onChange={e => setNewTargetCompany(e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Target Job Description (for keyword & competency matching)
                </label>
                <textarea
                  rows={4}
                  placeholder="Paste the job description or requirements here..."
                  value={newTargetJd}
                  onChange={e => setNewTargetJd(e.target.value)}
                  className="w-full border rounded p-2 text-xs text-gray-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
                >
                  Create Resume
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
