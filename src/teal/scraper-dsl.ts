/**
 * Teal Declarative Pipeline DSL Runner.
 * Reverse-engineered from Teal Job Search Companion content-script.
 */

export type PipelineStep =
  | string
  | [string, ...unknown[]];

export interface PipelineContext {
  rootHtml?: string;
  currentValue?: unknown;
}

/**
 * Strips HTML tags and collapses whitespace.
 */
function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Evaluates a single DSL step against current value.
 */
export function executeStep(step: PipelineStep, val: unknown, ctx: PipelineContext): unknown {
  const [op, ...args] = Array.isArray(step) ? step : [step];

  switch (op) {
    case 'domSelect':
    case 'jqSelect': {
      const selector = String(args[0] || '');
      const source = typeof val === 'string' ? val : (ctx.rootHtml || '');
      const match = extractBySelector(source, selector);
      return match || '';
    }

    case 'domIfNullSelect': {
      if (val && typeof val === 'string' && val.trim().length > 0) return val;
      const selector = String(args[0] || '');
      return extractBySelector(ctx.rootHtml || '', selector) || '';
    }

    case 'domText':
    case 'jqText': {
      if (typeof val === 'string') {
        return cleanText(val);
      }
      return '';
    }

    case 'jqHtml': {
      return typeof val === 'string' ? val : '';
    }

    case 'domGetAttribute':
    case 'jqAttr': {
      const attr = String(args[0] || '');
      if (typeof val === 'string') {
        const re = new RegExp(`${attr}=["']([^"']*)["']`, 'i');
        const m = val.match(re);
        return m && m[1] ? m[1] : '';
      }
      return '';
    }

    case 'jqIfNotLength': {
      const fallbackSel = String(args[0] || '');
      if (!val || (typeof val === 'string' && val.trim().length === 0)) {
        return extractBySelector(ctx.rootHtml || '', fallbackSel) || '';
      }
      return val;
    }

    case 'jqContents':
    case 'jqParent':
    case 'domParentElement': {
      return val;
    }

    case 'domNextElementSibling':
    case 'domNextSibling': {
      // In string HTML representation, look for next tag
      if (typeof val === 'string') {
        const re = /<\/[a-zA-Z0-9]+>\s*<([a-zA-Z0-9]+)[^>]*>([\s\S]*?)<\/\1>/i;
        const m = val.match(re);
        return m && m[2] ? m[2] : val;
      }
      return val;
    }

    case 'domPrevElementSibling':
    case 'domPrevSibling': {
      return val;
    }

    case 'domChildren': {
      return val;
    }

    case 'jqTrigger':
    case 'jqTriggerIfIncludes': {
      return val; // Side-effect events are no-ops in static extraction
    }

    case 'clear': {
      return '';
    }

    case 'arrGet': {
      const idx = typeof args[0] === 'number' ? args[0] : parseInt(String(args[0] || 0), 10);
      if (Array.isArray(val)) {
        return val.at?.(idx) ?? val[idx] ?? '';
      }
      return val;
    }

    case 'arrJoin': {
      const sep = String(args[0] ?? ',');
      if (Array.isArray(val)) {
        return val.join(sep);
      }
      return String(val ?? '');
    }

    case 'jqGet':
    case 'jqEq': {
      const idx = typeof args[0] === 'number' ? args[0] : 0;
      if (Array.isArray(val)) {
        return val[idx] ?? '';
      }
      return val;
    }

    case 'strReplace': {
      const pattern = String(args[0] || '');
      const replacement = String(args[1] ?? '');
      const flags = String(args[2] || 'g');
      if (typeof val === 'string') {
        return val.replace(new RegExp(pattern, flags), replacement);
      }
      return val;
    }

    case 'strSplit': {
      const delimiter = String(args[0] || '');
      const limit = typeof args[1] === 'number' ? args[1] : undefined;
      if (typeof val === 'string') {
        return val.split(new RegExp(delimiter), limit);
      }
      return val;
    }

    case 'strTrim': {
      return typeof val === 'string' ? val.trim() : val;
    }

    case 'strSubstring': {
      const start = Number(args[0] || 0);
      const length = args[1] !== undefined ? Number(args[1]) : undefined;
      if (typeof val === 'string') {
        return length !== undefined ? val.substring(start, start + length) : val.substring(start);
      }
      return val;
    }

    case 'strToInt': {
      if (typeof val === 'string') {
        const cleaned = val.replace(/[^\d-]/g, '');
        return parseInt(cleaned, 10) || 0;
      }
      return Number(val) || 0;
    }

    case 'strToFloat': {
      if (typeof val === 'string') {
        const cleaned = val.replace(/[^\d.-]/g, '');
        return parseFloat(cleaned) || 0;
      }
      return Number(val) || 0;
    }

    case 'reExec': {
      const pattern = String(args[0] || '');
      let flags = '';
      let group = 0;
      if (typeof args[1] === 'number') {
        group = args[1];
      } else if (typeof args[1] === 'string') {
        flags = args[1];
        if (typeof args[2] === 'number') {
          group = args[2];
        }
      }
      if (typeof val === 'string') {
        const m = new RegExp(pattern, flags).exec(val);
        return m ? (m[group] ?? '') : '';
      }
      return '';
    }

    case 'defaultString': {
      // Teal ground truth: e => e.trim().replace(/(\n|\r)/gm, " ").trim()
      if (typeof val === 'string') {
        return val.trim().replace(/(\n|\r)/gm, ' ').trim();
      }
      return val !== undefined && val !== null ? String(val).trim() : (args[0] !== undefined ? String(args[0]) : '');
    }

    default:
      return val;
  }
}

/**
 * Runs a full pipeline sequence.
 */
export function executePipeline(html: string, steps: PipelineStep[]): string {
  const ctx: PipelineContext = { rootHtml: html, currentValue: html };
  let current: unknown = html;

  for (const step of steps) {
    current = executeStep(step, current, ctx);
  }

  return typeof current === 'string' ? current.trim() : String(current ?? '');
}

/**
 * Minimal HTML tag/selector extractor for pipeline runner.
 */
function extractBySelector(html: string, selector: string): string {
  if (!html || !selector) return '';

  // ID match: e.g. #jobDescriptionText or #content
  if (selector.startsWith('#')) {
    const id = selector.slice(1).replace(/[^a-zA-Z0-9_-]/g, '');
    const re = new RegExp(`<([a-zA-Z0-9]+)[^>]*id=["'][^"']*\\b${id}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
    const m = html.match(re);
    if (m && m[2]) return m[2];
  }

  // Class match: e.g. .entry-title or img[class*=navLogo]
  if (selector.startsWith('.')) {
    const className = selector.slice(1).replace(/[^a-zA-Z0-9_-]/g, '');
    const re = new RegExp(`<([a-zA-Z0-9]+)[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
    const m = html.match(re);
    if (m && m[2]) return m[2];
  }

  // Tag match: e.g. h1, h2
  if (/^[a-zA-Z0-9]+$/.test(selector)) {
    const re = new RegExp(`<${selector}[^>]*>([\\s\\S]*?)<\\/${selector}>`, 'i');
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }

  // Attribute substring: e.g. [class*=descriptionText]
  const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)\*=([^\]"']+)\]/);
  if (attrMatch && attrMatch[1] && attrMatch[2]) {
    const [, attr, val] = attrMatch;
    const re = new RegExp(`<([a-zA-Z0-9]+)[^>]*${attr}=["'][^"']*${val}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
    const m = html.match(re);
    if (m && m[2]) return m[2];
  }

  // Generic tag with content
  return '';
}
