import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Page } from 'patchright';
import type { AutoApplyOptions } from './runner.js';
import type { BotRunReport } from './types.js';
import { canonicalRequisition } from './identity.js';
import { sha256 } from './submission.js';
import type { SubmissionExchange } from './network-proof.js';

export function manifestPayload(files: Record<string, string>): string { return JSON.stringify({ version: 1, algorithm: 'SHA-256', files: Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) }); }

/** Browser-side inert snapshot. It must remain safe when opened outside the portal. */
export function sanitizedDocument(root: Element): string {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const element of Array.from(clone.querySelectorAll('script,iframe,frame,object,embed,base,meta[http-equiv],input[type=password],input[type=hidden],input[autocomplete=one-time-code],textarea[name*=token i],textarea[name*=secret i]'))) element.remove();
  for (const element of [clone, ...Array.from(clone.querySelectorAll('*'))]) for (const attribute of Array.from(element.attributes)) {
    if (/^on|token|nonce|secret/i.test(attribute.name)) { element.removeAttribute(attribute.name); continue; }
    if (['src', 'href', 'action', 'formaction'].includes(attribute.name)) {
      if (/^(?:javascript|vbscript):/i.test(attribute.value)) { element.removeAttribute(attribute.name); continue; }
      try {
        const url = new URL(attribute.value, root.ownerDocument.baseURI);
        let changed = false;
        for (const key of [...url.searchParams.keys()]) if (/token|secret|password|authorization|^code$|^key$/i.test(key)) { url.searchParams.set(key, '[redacted]'); changed = true; }
        if (/token|secret|password|code=/i.test(url.hash)) { url.hash = ''; changed = true; }
        if (changed) element.setAttribute(attribute.name, url.href);
      } catch { element.removeAttribute(attribute.name); }
    }
  }
  const head = clone.querySelector('head') || clone.insertBefore(root.ownerDocument.createElement('head'), clone.firstChild);
  const policy = root.ownerDocument.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'");
  head.prepend(policy);
  return '<!doctype html>' + clone.outerHTML;
}

export async function captureEvidence(page: Page, options: AutoApplyOptions, report: BotRunReport, exchanges: SubmissionExchange[] = []): Promise<string | undefined> {
  if (!options.sessionDir || !report.receipt) return;
  const directory = path.join(options.sessionDir, 'receipts', `${Date.now()}_${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const hashes: Record<string, string> = {};
  const save = (name: string, data: string | Buffer) => { writeFileSync(path.join(directory, name), data, { flag: 'wx', mode: 0o600 }); hashes[name] = sha256(data); };
  const documents = report.actions.filter(action => action.documentHash).map(action => ({ field: action.selector, sha256: action.documentHash }));
  save('submitted_payload.json', JSON.stringify({ fields: report.submittedFields || report.actions.filter(action => action.status === 'filled'), documents }, null, 2));
  if (exchanges.length) {
    const raw = JSON.stringify(exchanges);
    const context = options.requisition?.key || canonicalRequisition(options.url)?.key || options.url;
    save(options.vault ? 'network.json.encrypted' : 'network.json', options.vault ? options.vault.sealEvidence(context, raw) : raw);
  }
  if (!page.isClosed()) {
    const html = await page.locator('html').evaluate(sanitizedDocument);
    save('confirmation.html', html);
    save('confirmation.png', await page.screenshot({ fullPage: true }));
  }
  save('receipt.json', JSON.stringify({ proof: report.receipt.selector?.startsWith('network:') ? 'NETWORK_VERIFIED' : 'DOM_VERIFIED', autonomous: report.humanInterventionRequired === false, applicationUrl: options.url, candidateEmail: options.profile.personal.email, requisition: options.requisition || canonicalRequisition(options.url), receipt: report.receipt, submission: report.submission, verificationMessageId: report.verificationMessageId, capturedAt: new Date().toISOString() }, null, 2));
  const payload = manifestPayload(hashes);
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ ...JSON.parse(payload), ...(options.vault ? { signature: { algorithm: 'HMAC-SHA256', value: options.vault.signEvidence(payload) } } : {}) }, null, 2), { flag: 'wx', mode: 0o600 });
  return directory;
}

