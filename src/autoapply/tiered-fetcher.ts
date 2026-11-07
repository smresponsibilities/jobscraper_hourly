import { toPlainText } from '../fetchers/util.js';
import { extractYears } from '../classify.js';
import { exceedsExperienceGate, isUnsupportedProprietaryPortal, isAtsRootUrl } from './preflight.js';
import { canonicalRequisition } from './identity.js';
import { gotScraping } from 'got-scraping';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BrowserContext } from 'patchright';

const execFileAsync = promisify(execFile);

export interface FastApiPreflightResult {
  status: 'eligible' | 'skipped' | 'unsupported';
  reason?: string;
  description?: string;
  title?: string;
  httpStatus?: number;
}

export interface FastApiPreflightOptions {
  fetcher?: (url: string, init?: any) => Promise<any>;
  signal?: AbortSignal;
  timeoutMs?: number;
  context?: BrowserContext;
  forceTier?: 1 | 2 | 3;
}

export const CHROME_CLIENT_HINTS_HEADERS: Record<string, string> = {
  'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-ch-ua-platform-version': '"15.0.0"',
  'sec-ch-ua-model': '""',
  'sec-ch-ua-arch': '"x86"',
  'sec-ch-ua-bitness': '"64"',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
};

export interface ResilientFetchOptions {
  context?: BrowserContext;
  forceTier?: 1 | 2 | 3;
  timeoutMs?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | URLSearchParams;
  signal?: AbortSignal;
}

export interface ResilientResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers | Record<string, string | string[] | undefined>;
  tier: 1 | 2 | 3;
  text(): Promise<string>;
  json(): Promise<any>;
  url: string;
}

export async function resilientFetch(
  url: string,
  options: ResilientFetchOptions = {}
): Promise<ResilientResponse> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const method = (options.method || 'GET').toUpperCase();

  const runTier1 = async (): Promise<ResilientResponse> => {
    let bodyPayload: string | Buffer | undefined;
    const headers = { ...(options.headers || {}) };
    if (options.body) {
      if (typeof options.body === 'string' || Buffer.isBuffer(options.body)) {
        bodyPayload = options.body;
      } else if (options.body instanceof URLSearchParams) {
        bodyPayload = options.body.toString();
        if (!headers['content-type']) {
          headers['content-type'] = 'application/x-www-form-urlencoded';
        }
      } else if (typeof options.body === 'object') {
        bodyPayload = JSON.stringify(options.body);
        if (!headers['content-type']) {
          headers['content-type'] = 'application/json';
        }
      }
    }
    const res = await gotScraping({
      url,
      method: method as any,
      headers,
      body: bodyPayload,
      timeout: { request: timeoutMs },
      throwHttpErrors: false,
      retry: { limit: 0 },
    });
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      statusText: res.statusMessage || '',
      headers: new Headers(res.headers as any),
      tier: 1,
      text: async () => res.body,
      json: async () => JSON.parse(res.body),
      url: res.url || url,
    };
  };

  const runTier2 = async (): Promise<ResilientResponse> => {
    const mergedHeaders = {
      ...CHROME_CLIENT_HINTS_HEADERS,
      ...(options.headers || {}),
    };
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    let bodyPayload: any = options.body;
    if (options.body && typeof options.body === 'object' && !(options.body instanceof URLSearchParams) && !Buffer.isBuffer(options.body)) {
      bodyPayload = JSON.stringify(options.body);
      if (!mergedHeaders['content-type']) {
        mergedHeaders['content-type'] = 'application/json';
      }
    }

    const res = await fetch(url, {
      method,
      headers: mergedHeaders,
      body: bodyPayload,
      signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      tier: 2,
      text: () => res.text(),
      json: () => res.json(),
      url: res.url,
    };
  };

  const runTier3 = async (): Promise<ResilientResponse> => {
    if (options.context && options.context.request) {
      try {
        const apiRes = await options.context.request.fetch(url, {
          method: method.toLowerCase(),
          headers: options.headers,
          data: options.body,
          timeout: timeoutMs,
        });
        return {
          ok: apiRes.ok(),
          status: apiRes.status(),
          statusText: apiRes.statusText(),
          headers: new Headers(apiRes.headers()),
          tier: 3,
          text: () => apiRes.text(),
          json: () => apiRes.json(),
          url: apiRes.url(),
        };
      } catch {
        // Fall back to curl.exe if context.request fails
      }
    }

    const statusMarker = '__HTTP_STATUS__';
    const args = [
      '-sL',
      '-w',
      `\n${statusMarker}:%{http_code}`,
      '--max-time',
      String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    ];
    if (method !== 'GET') {
      args.push('-X', method);
    }
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        if (v !== undefined) args.push('-H', `${k}: ${v}`);
      }
    }
    if (options.body) {
      const dataStr =
        typeof options.body === 'string'
          ? options.body
          : Buffer.isBuffer(options.body)
          ? options.body.toString('utf8')
          : typeof options.body === 'object'
          ? JSON.stringify(options.body)
          : String(options.body);
      args.push('--data', dataStr);
    }
    args.push(url);

    let rawOut = '';
    try {
      const { stdout } = await execFileAsync('curl.exe', args, {
        encoding: 'utf8',
        timeout: timeoutMs + 3000,
      });
      rawOut = stdout;
    } catch (err: any) {
      if (err && typeof err.stdout === 'string' && err.stdout.length > 0) {
        rawOut = err.stdout;
      } else {
        throw err;
      }
    }
    const markerToken = `\n${statusMarker}:`;
    const markerIdx = rawOut.lastIndexOf(markerToken);
    let body = rawOut;
    let status = 200;
    if (markerIdx !== -1) {
      const codeStr = rawOut.slice(markerIdx + markerToken.length).trim();
      const parsedCode = parseInt(codeStr, 10);
      if (!isNaN(parsedCode) && parsedCode > 0) {
        status = parsedCode;
        body = rawOut.slice(0, markerIdx);
      }
    }

    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      headers: new Headers(),
      tier: 3,
      text: async () => body,
      json: async () => JSON.parse(body),
      url,
    };
  };

  if (options.forceTier === 1) return runTier1();
  if (options.forceTier === 2) return runTier2();
  if (options.forceTier === 3) return runTier3();

  // Automatic fallback cascade: Tier 1 -> Tier 2 -> Tier 3
  // Bot-wall status codes (403 Forbidden, 429 Rate Limit, 503 Challenge) trigger fallback to subsequent tiers
  const isBlockStatus = (st: number) => st === 403 || st === 429 || st === 503;

  try {
    const res1 = await runTier1();
    if (!isBlockStatus(res1.status)) return res1;
  } catch {}

  try {
    const res2 = await runTier2();
    if (!isBlockStatus(res2.status)) return res2;
  } catch {}

  return await runTier3();
}

export function requiresFourPlusYears(description: string, title = ''): boolean {
  if (exceedsExperienceGate(description, title)) return true;
  const fullText = `${title} ${description}`;
  const extracted = extractYears(fullText);
  if (extracted.min !== null && extracted.min >= 4) return true;
  if (/\b(?:[4-9]|\d{2,})\+?\s*(?:-\s*\d+)?\s*(?:years?|yrs?)\s+(?:of\s+)?experience\b/i.test(fullText)) {
    return true;
  }
  return false;
}

export async function fastApiPreflightCheck(
  jobUrl: string,
  options: FastApiPreflightOptions = {}
): Promise<FastApiPreflightResult> {
  if (!jobUrl || !URL.canParse(jobUrl)) {
    return { status: 'skipped', reason: 'invalid_url' };
  }

  if (isUnsupportedProprietaryPortal(jobUrl)) {
    return { status: 'skipped', reason: 'unsupported_proprietary_portal' };
  }

  if (isAtsRootUrl(jobUrl)) {
    return { status: 'skipped', reason: 'board_root_not_requisition' };
  }

  const parsedUrl = new URL(jobUrl);
  const host = parsedUrl.hostname.toLowerCase();
  const identity = canonicalRequisition(jobUrl);

  let endpoint: string | undefined;
  let provider: 'greenhouse' | 'lever' | undefined;

  if (
    identity?.provider === 'greenhouse' ||
    /^(?:boards|job-boards|boards\.eu|job-boards\.eu)\.greenhouse\.io$/.test(host)
  ) {
    provider = 'greenhouse';
    const parts = parsedUrl.pathname.split('/').filter(Boolean);
    const board =
      identity?.tenant ||
      parsedUrl.searchParams.get('for') ||
      (parts[0] !== 'embed' ? parts[0] : undefined);
    const jobId =
      identity?.jobId ||
      /\/jobs\/(\d+)/.exec(parsedUrl.pathname)?.[1] ||
      parsedUrl.searchParams.get('gh_jid') ||
      parsedUrl.searchParams.get('token') ||
      parsedUrl.searchParams.get('job_id');
    if (board && jobId) {
      endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(jobId)}`;
    }
  } else if (identity?.provider === 'lever' || host === 'jobs.lever.co') {
    provider = 'lever';
    const parts = parsedUrl.pathname.split('/').filter(Boolean);
    const site = identity?.tenant || parts[0];
    const jobId = identity?.jobId || (parts[1] !== 'apply' ? parts[1] : undefined);
    if (site && jobId) {
      endpoint = `https://api.lever.co/v0/postings/${encodeURIComponent(site)}/${encodeURIComponent(jobId)}`;
    }
  }

  // Workday, Ashby, and SmartRecruiters MUST be verified by the real browser
  if (!endpoint || !provider) {
    return { status: 'eligible', reason: 'browser_verification_required' };
  }

  try {
    const fetchFn = options.fetcher || fetch;
    const response = await fetchFn(endpoint, {
      signal: options.signal,
      headers: { Accept: 'application/json' },
    });

    if (response.status === 404 || response.status === 410) {
      return { status: 'skipped', reason: 'job_closed', httpStatus: response.status };
    }

    if (!response.ok) {
      return { status: 'eligible', reason: `api_http_${response.status}`, httpStatus: response.status };
    }

    const data = (await response.json()) as any;
    if (!data || typeof data !== 'object') {
      return { status: 'eligible', reason: 'invalid_json_response' };
    }

    let title = '';
    let description = '';

    if (provider === 'greenhouse') {
      if (data.isListed === false || data.active === false) {
        return { status: 'skipped', reason: 'job_closed', httpStatus: response.status };
      }
      title = data.title || '';
      description = toPlainText(data.content || data.notes || '');
    } else if (provider === 'lever') {
      if (data.state === 'closed' || data.state === 'archived' || data.state === 'inactive') {
        return { status: 'skipped', reason: 'job_closed', httpStatus: response.status };
      }
      title = data.text || '';
      description = data.descriptionPlain || toPlainText(data.description || '');
      if (Array.isArray(data.lists)) {
        description += '\n' + data.lists.map((l: any) => `${l.text || ''} ${toPlainText(l.content || '')}`).join('\n');
      }
      if (data.additionalPlain) {
        description += '\n' + data.additionalPlain;
      } else if (data.additional) {
        description += '\n' + toPlainText(data.additional);
      }
    }

    if (requiresFourPlusYears(description, title)) {
      return {
        status: 'skipped',
        reason: 'exceeds_max_experience',
        description,
        title,
        httpStatus: response.status,
      };
    }

    return {
      status: 'eligible',
      description,
      title,
      httpStatus: response.status,
    };
  } catch {
    // If fast API check encounters network or transient error, fall back to eligible
    return { status: 'eligible', reason: 'api_fetch_failed' };
  }
}
