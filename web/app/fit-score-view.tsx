'use client';

import React, { useState } from 'react';
import type { TargetedResume } from '@/lib/career-types';
import { auditResume } from '@/lib/fit-score-engine';

interface FitScoreViewProps {
  resume: TargetedResume;
  onUpdateResume: (updated: TargetedResume) => void;
}

export function FitScoreView({ resume, onUpdateResume }: FitScoreViewProps) {
  const [jobDescriptionInput, setJobDescriptionInput] = useState(resume.targetJobDescription || '');
  const [isEditingJd, setIsEditingJd] = useState(false);

  // Compute live fit score
  const analysis = auditResume({
    ...resume,
    targetJobDescription: jobDescriptionInput
  });

  function handleSaveJd() {
    onUpdateResume({
      ...resume,
      targetJobDescription: jobDescriptionInput,
      updatedAt: new Date().toISOString()
    });
    setIsEditingJd(false);
  }

  const scoreColor = analysis.score >= 85
    ? 'text-emerald-700 bg-emerald-50 border-emerald-300'
    : analysis.score >= 70
    ? 'text-blue-700 bg-blue-50 border-blue-300'
    : analysis.score >= 55
    ? 'text-amber-700 bg-amber-50 border-amber-300'
    : 'text-rose-700 bg-rose-50 border-rose-300';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* HEADER & SCORE CARD */}
      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-1">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
            Recruiter-Built Audit (Resume Rocketfuel Methodology)
          </span>
          <h2 className="text-xl font-bold text-gray-900">
            Resume Fit Score & ATS Readability
          </h2>
          <p className="text-xs text-gray-600 max-w-xl">
            Evaluates your resume against 45+ concrete recruiter criteria: scope & scale statements, measurable metrics, active phrasing, 6-second summary scan, and job description alignment.
          </p>
        </div>

        <div className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 w-36 h-36 ${scoreColor}`}>
          <div className="text-4xl font-extrabold tracking-tight">{analysis.score}</div>
          <div className="text-[11px] uppercase tracking-wider font-bold mt-1">
            {analysis.score >= 85 ? 'Interview Ready' : analysis.score >= 70 ? 'Strong' : 'Needs Work'}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            {analysis.passedCount} / {analysis.totalCount} rules passed
          </div>
        </div>
      </div>

      {/* TARGET JOB DESCRIPTION ANALYZER */}
      <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
            Target Job Description Matching
          </h3>
          <button
            onClick={() => setIsEditingJd(!isEditingJd)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            {isEditingJd ? 'Cancel' : 'Paste New Job Description'}
          </button>
        </div>

        {isEditingJd ? (
          <div className="space-y-2">
            <textarea
              rows={5}
              placeholder="Paste the full job requisition / requirements here to test keyword alignment..."
              value={jobDescriptionInput}
              onChange={e => setJobDescriptionInput(e.target.value)}
              className="w-full border rounded p-2.5 text-xs text-gray-900 font-sans"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={handleSaveJd}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
              >
                Apply & Analyze Match
              </button>
            </div>
          </div>
        ) : (
          <div>
            {resume.targetJobDescription ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-semibold text-gray-800">
                    Keyword Alignment Match:
                  </span>
                  <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {analysis.targetMatchPercent}% Match
                  </span>
                </div>

                {/* MATCHED & MISSING KEYWORDS */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 text-xs">
                  <div className="bg-emerald-50/60 p-3 rounded border border-emerald-200">
                    <span className="font-bold text-emerald-900 block mb-1.5">
                      ✓ Demonstrated Keywords ({analysis.matchedKeywords.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.matchedKeywords.map(kw => (
                        <span key={kw} className="bg-white text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded text-[11px] font-medium">
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="bg-amber-50/60 p-3 rounded border border-amber-200">
                    <span className="font-bold text-amber-900 block mb-1.5">
                      ⚠️ Missing Job Requisition Keywords ({analysis.missingKeywords.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.missingKeywords.map(kw => (
                        <span key={kw} className="bg-white text-amber-800 border border-amber-300 px-2 py-0.5 rounded text-[11px] font-medium">
                          {kw}
                        </span>
                      ))}
                      {analysis.missingKeywords.length === 0 && (
                        <span className="text-[11px] text-gray-500 italic">All core keywords covered!</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500 italic">
                No target job description provided for this resume. Click "Paste New Job Description" above to calculate keyword alignment.
              </p>
            )}
          </div>
        )}
      </div>

      {/* AUDIT CHECKLIST BY CATEGORY */}
      <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm space-y-4">
        <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider border-b pb-2">
          Detailed Recruiter Audit Checklist
        </h3>

        <div className="space-y-3">
          {analysis.rules.map(rule => (
            <div
              key={rule.id}
              className={`p-3.5 rounded-lg border flex items-start gap-3 text-xs ${rule.passed ? 'bg-gray-50/50 border-gray-200' : rule.severity === 'error' ? 'bg-rose-50/50 border-rose-200' : 'bg-amber-50/50 border-amber-200'}`}
            >
              <span className={`text-base font-bold ${rule.passed ? 'text-emerald-600' : rule.severity === 'error' ? 'text-rose-600' : 'text-amber-600'}`}>
                {rule.passed ? '✓' : rule.severity === 'error' ? '✕' : '▲'}
              </span>

              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-gray-900">{rule.title}</span>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
                    [{rule.category}]
                  </span>
                  {rule.coachingCategory && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                      rule.coachingCategory === 'needs-attention'
                        ? 'bg-rose-100 text-rose-800 border border-rose-200'
                        : rule.coachingCategory === 'be-ready-to-explain'
                        ? 'bg-blue-100 text-blue-800 border border-blue-200'
                        : 'bg-amber-100 text-amber-800 border border-amber-200'
                    }`}>
                      {rule.coachingCategory.replace('-', ' ')}
                    </span>
                  )}
                </div>
                <p className="text-gray-600 leading-relaxed">
                  {rule.description}
                </p>
                {!rule.passed && (
                  <div className="text-[11px] font-medium text-gray-800 bg-white p-2 rounded border border-gray-200/80 mt-1">
                    <strong>Recruiter Recommendation: </strong>{rule.recommendation}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
