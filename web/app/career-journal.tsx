'use client';

import React, { useState } from 'react';
import type { JournalEntry, TargetedResume, Achievement } from '@/lib/career-types';

interface CareerJournalProps {
  entries: JournalEntry[];
  resumes: TargetedResume[];
  onAddEntry: (entry: JournalEntry) => void;
  onDeleteEntry: (id: string) => void;
  onPromoteToResume: (entry: JournalEntry, targetResumeId: string, targetExpId: string) => void;
}

const CATEGORIES: { id: JournalEntry['category']; label: string; badgeColor: string }[] = [
  { id: 'win', label: 'Engineering Win', badgeColor: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  { id: 'metric', label: 'Quantifiable Metric', badgeColor: 'bg-blue-50 text-blue-800 border-blue-200' },
  { id: 'project', label: 'Shipped Project', badgeColor: 'bg-purple-50 text-purple-800 border-purple-200' },
  { id: 'skill', label: 'New Skill / Cert', badgeColor: 'bg-amber-50 text-amber-800 border-amber-200' },
  { id: 'recognition', label: 'Recognition / Award', badgeColor: 'bg-rose-50 text-rose-800 border-rose-200' }
];

export function CareerJournalView({
  entries,
  resumes,
  onAddEntry,
  onDeleteEntry,
  onPromoteToResume
}: CareerJournalProps) {
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [promoteModalEntry, setPromoteModalEntry] = useState<JournalEntry | null>(null);

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<JournalEntry['category']>('win');
  const [newCompany, setNewCompany] = useState('');
  const [newImpact, setNewImpact] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Promote modal state
  const [selectedResumeId, setSelectedResumeId] = useState(resumes[0]?.id || '');
  const [selectedExpId, setSelectedExpId] = useState(resumes[0]?.profile.experiences[0]?.id || '');

  const filteredEntries = filterCategory === 'all'
    ? entries
    : entries.filter(e => e.category === filterCategory);

  function handleCreateEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !newImpact.trim()) return;

    const entry: JournalEntry = {
      id: `j-${Date.now()}`,
      date: new Date().toISOString(),
      title: newTitle.trim(),
      category: newCategory,
      companyOrContext: newCompany.trim() || 'Work / Projects',
      impactSummary: newImpact.trim(),
      fullNotes: newNotes.trim(),
      promotedToAchievement: false
    };

    onAddEntry(entry);
    setShowAddModal(false);
    setNewTitle('');
    setNewCompany('');
    setNewImpact('');
    setNewNotes('');
  }

  function handleConfirmPromote() {
    if (!promoteModalEntry || !selectedResumeId || !selectedExpId) return;
    if (promoteModalEntry.promotedToAchievement) return;
    onPromoteToResume(promoteModalEntry, selectedResumeId, selectedExpId);
    setPromoteModalEntry(null);
  }

  const activeResumeForModal = resumes.find(r => r.id === selectedResumeId) || resumes[0];

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">Smart Career Journal</h2>
          <p className="text-xs text-gray-500">
            Log wins, metrics, and shipped features as they happen. 1-click promote them directly into your resume achievements.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition shadow-sm"
        >
          + Log New Career Win
        </button>
      </div>

      {/* FILTER TABS */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterCategory('all')}
          className={`px-3 py-1 rounded text-xs font-medium transition ${filterCategory === 'all' ? 'bg-gray-900 text-white font-semibold' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          All ({entries.length})
        </button>
        {CATEGORIES.map(c => {
          const count = entries.filter(e => e.category === c.id).length;
          return (
            <button
              key={c.id}
              onClick={() => setFilterCategory(c.id)}
              className={`px-3 py-1 rounded text-xs font-medium transition ${filterCategory === c.id ? 'bg-gray-900 text-white font-semibold' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {c.label} ({count})
            </button>
          );
        })}
      </div>

      {/* JOURNAL ENTRIES LIST */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredEntries.map(entry => {
          const catInfo = CATEGORIES.find(c => c.id === entry.category) || CATEGORIES[0];
          return (
            <div key={entry.id} className="bg-white p-4 rounded-lg border border-gray-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${catInfo.badgeColor}`}>
                      {catInfo.label}
                    </span>
                    <h3 className="text-sm font-bold text-gray-900 mt-1">{entry.title}</h3>
                    <p className="text-[11px] text-gray-500">{entry.companyOrContext} • {new Date(entry.date).toLocaleDateString()}</p>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`Delete journal entry "${entry.title}"?`)) {
                        onDeleteEntry(entry.id);
                      }
                    }}
                    className="text-gray-400 hover:text-red-600 text-xs px-1"
                  >
                    &times;
                  </button>
                </div>

                <div className="bg-gray-50 p-2.5 rounded border border-gray-100 text-xs">
                  <div className="font-semibold text-gray-900 mb-0.5">Measurable Outcome / Result:</div>
                  <p className="text-gray-800">{entry.impactSummary}</p>
                </div>

                {entry.fullNotes && (
                  <p className="text-xs text-gray-600 leading-relaxed italic">
                    "{entry.fullNotes}"
                  </p>
                )}
              </div>

              {/* ACTION BAR */}
              <div className="pt-2 border-t flex justify-between items-center text-xs">
                {entry.promotedToAchievement ? (
                  <span className="text-emerald-700 font-semibold text-[11px] flex items-center gap-1">
                    ✓ Promoted to Resume Bullet
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      setPromoteModalEntry(entry);
                      setSelectedResumeId(resumes[0]?.id || '');
                      setSelectedExpId(resumes[0]?.profile.experiences[0]?.id || '');
                    }}
                    className="px-2.5 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-medium border border-blue-200 transition"
                  >
                    🚀 Promote to Resume Achievement
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filteredEntries.length === 0 && (
          <div className="col-span-2 text-center py-12 bg-white rounded-lg border border-dashed text-gray-400 text-xs">
            No entries in this category yet. Click "+ Log New Career Win" above.
          </div>
        )}
      </div>

      {/* LOG MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900 border-b pb-2">Log Career Win or Metric</h3>
            <form onSubmit={handleCreateEntry} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Win Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Cut API p95 Latency by 40%"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value as any)}
                    className="w-full border rounded px-3 py-1.5 text-xs text-gray-900 bg-white"
                  >
                    {CATEGORIES.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Company / Project Context</label>
                  <input
                    type="text"
                    placeholder="e.g. ScaleFlow Technologies"
                    value={newCompany}
                    onChange={e => setNewCompany(e.target.value)}
                    className="w-full border rounded px-3 py-1.5 text-xs text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Measurable Impact / Result * (Bryan Creely Rocketfuel Rule: Must include numbers/metrics)
                </label>
                <textarea
                  rows={2}
                  required
                  placeholder="e.g. Optimized SQL indexes and Redis caching, cutting p95 response time from 1.4s to 180ms across 100K daily requests."
                  value={newImpact}
                  onChange={e => setNewImpact(e.target.value)}
                  className="w-full border rounded p-2 text-xs text-gray-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Context Notes & Technical Details</label>
                <textarea
                  rows={3}
                  placeholder="Any extra details, trade-offs, technologies used, or coworker feedback..."
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
                  Save Win
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PROMOTE MODAL */}
      {promoteModalEntry && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900 border-b pb-2">
              Promote to Resume Achievement
            </h3>
            <p className="text-xs text-gray-600">
              Select which resume and experience role this achievement bullet should be appended to:
            </p>

            <div className="bg-gray-50 p-3 rounded border text-xs text-gray-800 italic">
              "{promoteModalEntry.impactSummary}"
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Target Resume</label>
                <select
                  value={selectedResumeId}
                  onChange={e => {
                    setSelectedResumeId(e.target.value);
                    const targetRes = resumes.find(r => r.id === e.target.value);
                    if (targetRes && targetRes.profile.experiences[0]) {
                      setSelectedExpId(targetRes.profile.experiences[0].id);
                    }
                  }}
                  className="w-full border rounded px-3 py-1.5 text-xs text-gray-900 bg-white"
                >
                  {resumes.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Target Experience Role</label>
                <select
                  value={selectedExpId}
                  onChange={e => setSelectedExpId(e.target.value)}
                  className="w-full border rounded px-3 py-1.5 text-xs text-gray-900 bg-white"
                >
                  {activeResumeForModal?.profile.experiences.map(exp => (
                    <option key={exp.id} value={exp.id}>
                      {exp.title} ({exp.companyName})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setPromoteModalEntry(null)}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPromote}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
              >
                Promote Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
