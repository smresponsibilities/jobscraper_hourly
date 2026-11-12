export interface SubmissionExchange {
  request: { url: string; method: string; payloadHash: string; payloadBase64: string };
  response: { url: string; status: number; headers: Record<string, string>; bodyBase64: string; bodyAvailable: boolean };
}

export function terminalProvider(url: string): string | undefined {
  const parsed = new URL(url);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if ((local || /(?:^|\.)ashbyhq\.com$/.test(parsed.hostname)) && /^(?:ApiSubmit(?:Single|Multiple)?ApplicationForm(?:Action)?|ApiSubmitMultipleFormsAction|ApiSubmitJobApplication(?:Action)?|submitApplication)$/i.test(parsed.searchParams.get('op') || '')) return 'ashby';
  if ((local || /(?:^|\.)myworkday(?:jobs|site)?\.com$/.test(parsed.hostname)) && /\/wday\/cxs\//.test(parsed.pathname)) return 'workday';
  if ((local || /(?:^|\.)greenhouse\.io$/.test(parsed.hostname)) && (/\/(?:applications|embed\/job_app)\/?$/.test(parsed.pathname) || /\/jobs\/\d+\/?$/.test(parsed.pathname))) return 'greenhouse';
  if ((local || /(?:^|\.)lever\.co$/.test(parsed.hostname)) && /\/postings\/[^/]+\/apply\/?$/.test(parsed.pathname)) return 'lever';
  return undefined;
}

/** Explicit terminal success only. Generic 200 responses and validation JSON fail closed. */
export function submissionConfirmation(exchange: SubmissionExchange): { provider: string; applicationId?: string; existing?: boolean } | undefined {
  if (exchange.request.method !== 'POST') return;
  const provider = terminalProvider(exchange.request.url);
  if (!provider) return;
  const response = exchange.response;
  if ([302, 303].includes(response.status) && ['greenhouse', 'lever'].includes(provider) && response.headers.location) {
    const location = new URL(response.headers.location, response.url);
    if (/\/(?:confirmation|thank-you|thank_you|success)(?:\/|$)/i.test(location.pathname) || /^(?:true|1)$/.test(location.searchParams.get('submitted') || '')) return { provider, applicationId: location.searchParams.get('applicationId') || location.searchParams.get('application_id') || undefined };
  }
  if (response.status >= 200 && response.status < 300 && ['greenhouse', 'lever'].includes(provider) && /\/(?:confirmation|thank-you|thank_you|success)(?:\/|$)/i.test(new URL(response.url).pathname)) {
    const location = new URL(response.url);
    return { provider, applicationId: location.searchParams.get('applicationId') || location.searchParams.get('application_id') || undefined };
  }
  if (response.status >= 200 && response.status < 300 && provider === 'greenhouse' && !response.bodyAvailable) {
    return { provider };
  }
  if (response.status < 200 || response.status >= 300 || !response.bodyAvailable) return;
  try {
    const data = JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8'));
    if ((Array.isArray(data.errors) && data.errors.length) || data.error || (Array.isArray(data.validationErrors) && data.validationErrors.length)) return;
    const application = provider === 'ashby' ? data.data?.submitMultipleFormsAction || data.data?.submitSingleApplicationFormAction || data.data?.submitApplicationFormAction || data.data?.submitJobApplication || data.data?.jobApplicationSubmit || data.data?.submitApplication : data;
    if (!application || application.error || (application.errors && Object.keys(application.errors).length)) return;
    const confirmed = provider === 'ashby' ? (application.isSuccess === true || application.success === true || application.applicationFormResult?.__typename === 'FormSubmitSuccess' || !!application.applicationId) : provider === 'workday' ? application.stepType === 'Confirmation' : application.success === true || application.ok === true;
    if (!confirmed) return;
    const id = application.applicationId || application.application_id;
    return { provider, applicationId: typeof id === 'string' || typeof id === 'number' ? String(id) : undefined, ...(application.alreadyApplied === true || application.isDuplicate === true || application.existingApplication ? { existing: true } : {}) };
  } catch { return; }
}
