import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PortalCredentials {
  email: string;
  password: string;
  sourceKeyEmail: string;
  sourceKeyPassword: string;
}

export function loadDotEnvIntoProcess(rootDir = process.cwd()): Record<string, string> {
  const candidates = [
    path.join(rootDir, '.env'),
    path.join(rootDir, '.env.local'),
    path.join(rootDir, 'state', 'autoapply', 'portal-review', '.env'),
  ];
  const parsed: Record<string, string> = {};
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      parsed[key] = val;
      if (!process.env[key]) process.env[key] = val;
    }
  }
  return parsed;
}

export function resolveEnvPortalCredentials(fallbackProfileEmail?: string): PortalCredentials | null {
  loadDotEnvIntoProcess();
  const env = process.env;

  // Priority order for Email keys in .env
  const emailPriority = [
    'AUTOAPPLY_EMAIL',
    'WORKDAY_EMAIL',
    'PORTAL_EMAIL',
    'CANDIDATE_EMAIL',
    'APPLICANT_EMAIL',
    'JOB_EMAIL',
    'USER_EMAIL',
    'EMAIL',
    'ALERT_EMAIL_TO',
    'SMTP_USER',
  ];

  // Priority order for Password keys in .env (excluding API keys / SMTP app tokens unless explicitly named password)
  const passwordPriority = [
    'AUTOAPPLY_PASSWORD',
    'WORKDAY_PASSWORD',
    'PORTAL_PASSWORD',
    'CANDIDATE_PASSWORD',
    'APPLICANT_PASSWORD',
    'JOB_PASSWORD',
    'USER_PASSWORD',
    'PASSWORD',
    'PASS',
    'PWD',
  ];

  let email = '';
  let sourceKeyEmail = '';
  for (const k of emailPriority) {
    if (env[k] && env[k]!.includes('@')) {
      email = env[k]!.trim();
      sourceKeyEmail = k;
      break;
    }
  }

  // Fallback scan: any env key containing EMAIL with an '@' value
  if (!email) {
    for (const [k, v] of Object.entries(env)) {
      if (/email/i.test(k) && v && v.includes('@') && !/from|resend|sendgrid/i.test(k)) {
        email = v.trim();
        sourceKeyEmail = k;
        break;
      }
    }
  }

  if (!email && fallbackProfileEmail) {
    email = fallbackProfileEmail.trim();
    sourceKeyEmail = 'candidate.json';
  }

  let password = '';
  let sourceKeyPassword = '';
  for (const k of passwordPriority) {
    if (env[k] && env[k]!.trim().length >= 6) {
      password = env[k]!.trim();
      sourceKeyPassword = k;
      break;
    }
  }

  // Fallback scan: any env key containing PASS or PWD (excluding SMTP_PASS if another exists)
  if (!password) {
    for (const [k, v] of Object.entries(env)) {
      if (/(?:password|passwd|pwd)/i.test(k) && !/smtp|db_|redis|postgres/i.test(k) && v && v.trim().length >= 6) {
        password = v.trim();
        sourceKeyPassword = k;
        break;
      }
    }
  }

  if (!email || !password) return null;
  return { email, password, sourceKeyEmail, sourceKeyPassword };
}

export const WORKDAY_COMPLEXITY_FALLBACK_PASSWORD = 'Wk9#mP4$vL7@nQ2!';

export function ensureWorkdayCompliantPassword(rawPassword: string): string {
  if (!rawPassword) return WORKDAY_COMPLEXITY_FALLBACK_PASSWORD;
  const isStrong =
    rawPassword.length >= 12 &&
    /[A-Z]/.test(rawPassword) &&
    /[a-z]/.test(rawPassword) &&
    /[0-9]/.test(rawPassword) &&
    /[!@#$%^&*]/.test(rawPassword) &&
    !/shivam|mahajan/i.test(rawPassword);

  if (isStrong) return rawPassword;
  const cleaned = rawPassword.replace(/shivam|mahajan/gi, 'Wk').slice(0, 8);
  return `${cleaned}Wk#2026!9`;
}
