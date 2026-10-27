'use client';

import React, { useState } from 'react';
import type { TrackedApplication, ApplicationStage, TargetedResume } from '@/lib/career-types';
import { generateCoverLetter } from '@/lib/cover-letter';

interface JobTrackerProps {
  applications: TrackedApplication[];
  resumes: TargetedResume[];
  onUpdateApplication: (app: TrackedApplication) => void;
  onAddApplication: (app: TrackedApplication) => void;
  onDeleteApplication: (id: string) => void;
}

const STAGES: { id: ApplicationStage; label: string; color: string }[] = [
  { id: 'saved', label: 'Saved / To Apply', color: 'bg-gray-100 text-gray-800 border-gray-300' },
  { id: 'applied', label: 'Applied', color: 'bg-blue-50 text-blue-800 border-blue-200' },
  { id: 'screening', label: 'Recruiter Screen', color: 'bg-purple-50 text-purple-800 border-purple-200' },
  { id: 'interviewing', label: 'Interviewing', color: 'bg-amber-50 text-amber-800 border-amber-200' },
  { id: 'offer', label: 'Offer Received 🎉', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  { id: 'rejected', label: 'Archived / Rejected', color: 'bg-rose-50 text-rose-800 border-rose-200' }
];

export function JobTrackerView({
  applications,
  resumes,
  onUpdateApplication,
  onAddApplication,
  onDeleteApplication
}: JobTrackerProps) {
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [selectedApp, setSelectedApp] = useState<TrackedApplication | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [coverLetterModal, setCoverLetterModal] = useState<string | null>(null);

  // New application form state
  const [newCompany, setNewCompany] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newSalary, setNewSalary] = useState('');
  const [newResumeId, setNewResumeId] = useState(resumes[0]?.id || '');
  const [newNotes, setNewNotes] = useState('');

  // Timeline note state inside detail modal
  const [newNoteText, setNewNoteText] = useState('');

  function handleCreateApplication(e: React.FormEvent) {
    e.preventDefault();
    if (!newCompany.trim() || !newRole.trim()) return;

    const newApp: TrackedApplication = {
      id: `app-${Date.now()}`,
      company: newCompany.trim(),
      role: newRole.trim(),
      location: newLocation.trim() || 'India / Remote',
      url: newUrl.trim(),
      salary: newSalary.trim(),
      stage: 'saved',
      dateAdded: new Date().toISOString(),
      resumeId: newResumeId,
      notes: newNotes.trim(),
      timeline: [
        {
          id: `t-${Date.now()}`,
          date: new Date().toISOString(),
          type: 'status_change',
          note: 'Application added to Job Tracker'
        }
      ]
    };

    onAddApplication(newApp);
    setShowAddModal(false);
    setNewCompany('');
    setNewRole('');
    setNewLocation('');
    setNewUrl('');
    setNewSalary('');
    setNewNotes('');
  }

  function handleStageChange(app: TrackedApplication, newStage: ApplicationStage) {
    const updated: TrackedApplication = {
      ...app,
      stage: newStage,
      dateApplied: newStage === 'applied' && !app.dateApplied ? new Date().toISOString() : app.dateApplied,
      timeline: [
        ...app.timeline,
        {
          id: `t-${Date.now()}`,
          date: new Date().toISOString(),
          type: 'status_change',
          note: `Stage changed to ${STAGES.find(s => s.id === newStage)?.label}`
        }
      ]
    };
    onUpdateApplication(updated);
    if (selectedApp?.id === app.id) setSelectedApp(updated);
  }

  function handleAddTimelineNote(app: TrackedApplication) {
    if (!newNoteText.trim()) return;
    const updated: TrackedApplication = {
      ...app,
      timeline: [
        ...app.timeline,
        {
          id: `t-${Date.now()}`,
          date: new Date().toISOString(),
          type: 'note',
          note: newNoteText.trim()
        }
      ]
    };
    onUpdateApplication(updated);
    setSelectedApp(updated);
    setNewNoteText('');
  }

  function handleOpenCoverLetter(app: TrackedApplication) {
    const linkedResume = resumes.find(r => r.id === app.resumeId) || resumes[0];
    const letter = generateCoverLetter({
      resume: linkedResume,
      companyName: app.company,
      roleTitle: app.role,
      hiringManagerName: app.contactName
    });
    setCoverLetterModal(letter);
  }

  return (
    <div className="space-y-6">
      {/* HEADER & CONTROLS */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">Job Application Tracker (CRM)</h2>
          <p className="text-xs text-gray-500">
            Manage your full job search pipeline, interview rounds, recruiter notes, and linked tailored resumes in one place.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-gray-100 p-1 rounded flex text-xs font-medium">
            <button
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-1 rounded ${viewMode === 'kanban' ? 'bg-white shadow-xs text-gray-900 font-semibold' : 'text-gray-600'}`}
            >
              Kanban Board
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 rounded ${viewMode === 'list' ? 'bg-white shadow-xs text-gray-900 font-semibold' : 'text-gray-600'}`}
            >
              List View
            </button>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition shadow-sm"
          >
            + Add Application
          </button>
        </div>
      </div>

      {/* STATS OVERVIEW */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {STAGES.map(s => {
          const count = applications.filter(a => a.stage === s.id).length;
          return (
            <div key={s.id} className="bg-white p-3 rounded-lg border border-gray-200 text-center">
              <div className="text-xs text-gray-500 font-medium mb-1">{s.label}</div>
              <div className="text-xl font-bold text-gray-900">{count}</div>
            </div>
          );
        })}
      </div>

      {/* KANBAN BOARD VIEW */}
      {viewMode === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 items-start overflow-x-auto pb-4">
          {STAGES.map(col => {
            const stageApps = applications.filter(a => a.stage === col.id);
            return (
              <div key={col.id} className="bg-gray-50 rounded-lg border border-gray-200 p-2.5 flex flex-col min-w-[220px]">
                <div className="flex justify-between items-center mb-2 px-1">
                  <span className="text-xs font-bold text-gray-700">{col.label}</span>
                  <span className="text-[11px] bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded font-semibold">
                    {stageApps.length}
                  </span>
                </div>

                <div className="space-y-2">
                  {stageApps.map(app => {
                    const linkedResume = resumes.find(r => r.id === app.resumeId);
                    return (
                      <div
                        key={app.id}
                        onClick={() => setSelectedApp(app)}
                        className="bg-white p-3 rounded border border-gray-200 shadow-xs hover:shadow-md transition cursor-pointer space-y-2"
                      >
                        <div>
                          <h4 className="text-xs font-bold text-gray-900 leading-snug">{app.company}</h4>
                          <p className="text-[11px] text-gray-600 line-clamp-1">{app.role}</p>
                        </div>

                        {app.salary && (
                          <div className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded inline-block">
                            {app.salary}
                          </div>
                        )}

                        <div className="text-[10px] text-gray-400 flex justify-between items-center pt-1 border-t">
                          <span>{app.location.split(',')[0]}</span>
                          {linkedResume && (
                            <span className="text-blue-600 truncate max-w-[90px]" title={linkedResume.name}>
                              📄 {linkedResume.name}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {stageApps.length === 0 && (
                    <div className="text-center py-6 text-gray-400 text-xs italic">
                      No roles
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TABLE / LIST VIEW */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs text-gray-800">
            <thead className="bg-gray-50 border-b text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="p-3">Company</th>
                <th className="p-3">Role</th>
                <th className="p-3">Location</th>
                <th className="p-3">Salary</th>
                <th className="p-3">Stage</th>
                <th className="p-3">Linked Resume</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {applications.map(app => (
                <tr key={app.id} className="hover:bg-gray-50 transition cursor-pointer" onClick={() => setSelectedApp(app)}>
                  <td className="p-3 font-bold text-gray-900">{app.company}</td>
                  <td className="p-3 text-gray-700">{app.role}</td>
                  <td className="p-3 text-gray-500">{app.location}</td>
                  <td className="p-3 text-emerald-700 font-medium">{app.salary || '—'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${STAGES.find(s => s.id === app.stage)?.color}`}>
                      {STAGES.find(s => s.id === app.stage)?.label}
                    </span>
                  </td>
                  <td className="p-3 text-blue-600 text-[11px]">
                    {resumes.find(r => r.id === app.resumeId)?.name || 'Default Baseline'}
                  </td>
                  <td className="p-3 text-right" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => handleOpenCoverLetter(app)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium mr-3"
                    >
                      Cover Letter
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Remove application for ${app.company}?`)) {
                          onDeleteApplication(app.id);
                        }
                      }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* APPLICATION DETAIL MODAL */}
      {selectedApp && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-gray-900">{selectedApp.company}</h3>
                <p className="text-xs text-gray-600">{selectedApp.role} • {selectedApp.location}</p>
              </div>
              <button
                onClick={() => setSelectedApp(null)}
                className="text-gray-400 hover:text-gray-600 text-lg"
              >
                &times;
              </button>
            </div>

            {/* STAGE SELECTOR */}
            <div className="bg-gray-50 p-3 rounded border flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
              <label className="text-xs font-semibold text-gray-700">Application Pipeline Stage:</label>
              <select
                value={selectedApp.stage}
                onChange={e => handleStageChange(selectedApp, e.target.value as ApplicationStage)}
                className="border border-gray-300 rounded px-3 py-1 text-xs font-semibold bg-white text-gray-900"
              >
                {STAGES.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* DETAILS GRID */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-gray-500 block mb-0.5">Application Link</span>
                {selectedApp.url ? (
                  <a href={selectedApp.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">
                    {selectedApp.url}
                  </a>
                ) : <span className="text-gray-400">Not provided</span>}
              </div>
              <div>
                <span className="text-gray-500 block mb-0.5">Linked Tailored Resume</span>
                <span className="font-semibold text-gray-800">
                  📄 {resumes.find(r => r.id === selectedApp.resumeId)?.name || 'Default Baseline'}
                </span>
              </div>
              <div>
                <span className="text-gray-500 block mb-0.5">Salary Expectation / Range</span>
                <span className="text-emerald-700 font-semibold">{selectedApp.salary || 'Not specified'}</span>
              </div>
              <div>
                <span className="text-gray-500 block mb-0.5">Interview / Contact</span>
                <span className="text-gray-800">{selectedApp.contactName || selectedApp.interviewDate || 'None scheduled'}</span>
              </div>
            </div>

            {/* COVER LETTER BUTTON */}
            <div className="pt-2">
              <button
                onClick={() => handleOpenCoverLetter(selectedApp)}
                className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-medium border border-blue-200 transition"
              >
                ✉️ Generate Tailored Cover Letter for this Role
              </button>
            </div>

            {/* TIMELINE / NOTES LOG */}
            <div className="space-y-3 pt-3 border-t">
              <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                Application Timeline & Notes
              </h4>

              <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                {selectedApp.timeline.map(t => (
                  <div key={t.id} className="text-xs bg-gray-50 p-2 rounded border border-gray-100 flex justify-between items-start">
                    <p className="text-gray-800 leading-snug">{t.note}</p>
                    <span className="text-[10px] text-gray-400 whitespace-nowrap ml-2">
                      {new Date(t.date).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>

              {/* ADD NOTE */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newNoteText}
                  onChange={e => setNewNoteText(e.target.value)}
                  placeholder="Add note (e.g. Completed recruiter screen; DSA round on Tuesday)..."
                  className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                />
                <button
                  onClick={() => handleAddTimelineNote(selectedApp)}
                  className="px-4 py-1.5 bg-gray-900 text-white rounded text-xs font-medium"
                >
                  Log
                </button>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t">
              <button
                onClick={() => {
                  if (confirm(`Delete application for ${selectedApp.company}?`)) {
                    onDeleteApplication(selectedApp.id);
                    setSelectedApp(null);
                  }
                }}
                className="text-xs text-red-600 hover:text-red-800"
              >
                Delete Application
              </button>
              <button
                onClick={() => setSelectedApp(null)}
                className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD APPLICATION MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900 border-b pb-2">Add Tracked Application</h3>
            <form onSubmit={handleCreateApplication} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Company *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Swiggy"
                    value={newCompany}
                    onChange={e => setNewCompany(e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Role Title *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. SDE-1 Backend"
                    value={newRole}
                    onChange={e => setNewRole(e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Location</label>
                  <input
                    type="text"
                    placeholder="e.g. Bengaluru, India"
                    value={newLocation}
                    onChange={e => setNewLocation(e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Salary Range</label>
                  <input
                    type="text"
                    placeholder="e.g. 18-24 LPA"
                    value={newSalary}
                    onChange={e => setNewSalary(e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Application URL</label>
                <input
                  type="url"
                  placeholder="https://boards.greenhouse.io/company/jobs/..."
                  value={newUrl}
                  onChange={e => setNewUrl(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Linked Tailored Resume</label>
                <select
                  value={newResumeId}
                  onChange={e => setNewResumeId(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-xs text-gray-900 bg-white"
                >
                  {resumes.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Notes / Target Requisition Details</label>
                <textarea
                  rows={3}
                  placeholder="Paste referral contact, required skills, or interview notes..."
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  className="w-full border rounded p-2 text-xs text-gray-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
                >
                  Save Application
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* COVER LETTER MODAL */}
      {coverLetterModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-xl w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-sm font-bold text-gray-900">Tailored Recruiter Cover Letter</h3>
              <button
                onClick={() => setCoverLetterModal(null)}
                className="text-gray-400 hover:text-gray-600 text-lg"
              >
                &times;
              </button>
            </div>
            <textarea
              rows={14}
              readOnly
              value={coverLetterModal}
              className="w-full border rounded p-3 text-xs text-gray-900 font-mono leading-relaxed bg-gray-50"
            />
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(coverLetterModal);
                  alert('Cover letter copied to clipboard!');
                }}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
              >
                Copy to Clipboard
              </button>
              <button
                onClick={() => setCoverLetterModal(null)}
                className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
