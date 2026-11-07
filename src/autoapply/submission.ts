import { createHash } from 'node:crypto';
import type { BrowserContext, Page, Request, Response } from 'patchright';
import type { BotRunReport } from './types.js';
import { submissionConfirmation, terminalProvider, type SubmissionExchange } from './network-proof.js';

export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/** Observe only this application's pages. Other parked jobs share the context. */
export function observeSubmission(context: BrowserContext, pages: Set<Page>, report: BotRunReport, persist: () => void) {
  const requests = new Map<Request, NonNullable<BotRunReport['submission']>['requests'][number] & { payloadBase64?: string }>();
  const pending = new Set<Promise<void>>();
  const exchanges: SubmissionExchange[] = [];
  let clientError = false;
  const onPageError = () => { clientError = true; };
  for (const page of pages) page.on('pageerror', onPageError);
  const belongs = (request: Request) => { try { return pages.has(request.frame().page()); } catch { return false; } };
  const onRequest = (request: Request) => {
    if (!report.submission || report.submission.phase === 'prepared' || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) || !belongs(request)) return;
    // Telemetry cannot establish that an application payload was dispatched.
    if (/analytics|telemetry|\/collect(?:\?|$)|sentry|datadog|segment/i.test(request.url())) return;
    const postData = request.postDataBuffer() || Buffer.alloc(0);
    const payloadBase64 = postData.toString('base64');
    const record = { url: request.url().split('#')[0]!, method: request.method(), dispatchedAt: new Date().toISOString(), payloadHash: sha256(postData), payloadBase64 };
    requests.set(request, record);
    report.submission.requests.push(record);
    report.submission.phase = 'dispatched';
    persist();
  };
  const onResponse = (response: Response) => {
    const record = requests.get(response.request());
    if (!record) return;
    const task = (async () => {
      record.status = response.status();
      const headers = await response.allHeaders();
      record.headersHash = sha256(JSON.stringify(headers));
      const body = await response.body().catch(() => undefined);
      if (body) record.responseHash = sha256(body);
      if (terminalProvider(record.url)) {
        const payloadBase64 = record.payloadBase64 || response.request().postDataBuffer()?.toString('base64') || '';
        const exchange: SubmissionExchange = { request: { url: record.url, method: record.method, payloadHash: record.payloadHash, payloadBase64 }, response: { url: response.url(), status: response.status(), headers, bodyBase64: body?.toString('base64') || '', bodyAvailable: !!body } };
        exchanges.push(exchange);
        const confirmation = submissionConfirmation(exchange);
        if (confirmation) report.receipt = { url: response.url(), text: 'Employer submission API confirmed application', verifiedAt: new Date().toISOString(), selector: 'network:submission-response', applicationId: confirmation.applicationId, ...(confirmation.existing ? { existing: true } : {}) };
      }
      persist();
    })().catch(() => {}).finally(() => pending.delete(task));
    pending.add(task);
  };
  context.on('request', onRequest);
  context.on('response', onResponse);
  return { exchanges, clientError: () => clientError, drain: async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([Promise.allSettled([...pending]), new Promise(resolve => { timeout = setTimeout(resolve, 5000); })]); }
    finally { clearTimeout(timeout); }
  }, close: () => { context.off('request', onRequest); context.off('response', onResponse); for (const page of pages) page.off('pageerror', onPageError); } };
}
