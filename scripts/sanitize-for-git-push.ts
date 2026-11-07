import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// Load .env manually without external packages
function loadDotEnv() {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

loadDotEnv();

const FORBIDDEN_STRINGS = new Set<string>();

// Real personal phone & email
FORBIDDEN_STRINGS.add('7018626032');
FORBIDDEN_STRINGS.add('+91 7018626032');
FORBIDDEN_STRINGS.add('mahajan.shivam.dev@gmail.com');
FORBIDDEN_STRINGS.add('shivammahajan.mail@gmail.com');

// Load any high-entropy passwords from .env
const SENSITIVE_ENV_KEYS = [
  'AUTOAPPLY_PASSWORD',
  'IMAP_PASSWORD',
  'IMAP_PASS',
  'GMAIL_APP_PASSWORD',
  'SMTP_PASS',
  'WORKDAY_PASSWORD',
];

for (const key of SENSITIVE_ENV_KEYS) {
  const val = process.env[key]?.trim();
  if (val && val.length >= 6 && !/^(true|false|undefined|null|password|secret)$/i.test(val)) {
    FORBIDDEN_STRINGS.add(val);
  }
}

console.log(`[PII SANITIZER] Scanning git-tracked files against ${FORBIDDEN_STRINGS.size} forbidden strings...`);

const trackedFilesOutput = execSync('git ls-files', { encoding: 'utf8' });
const files = trackedFilesOutput.split(/\r?\n/).map(f => f.trim()).filter(Boolean);

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.docx', '.zip', '.sqlite', '.db', '.woff', '.woff2', '.ttf', '.eot'
]);

interface Violation {
  file: string;
  line: number;
  snippet: string;
}

const violations: Violation[] = [];

for (const relPath of files) {
  const ext = path.extname(relPath).toLowerCase();
  if (BINARY_EXTS.has(ext)) continue;

  const fullPath = path.resolve(relPath);
  if (!fs.existsSync(fullPath)) continue;

  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile() || stat.size > 5_000_000) continue;

    const content = fs.readFileSync(fullPath, 'utf8');
    // quick null byte check for binary
    if (content.slice(0, 1024).includes('\0')) continue;

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i]!;
      for (const secret of FORBIDDEN_STRINGS) {
        if (lineText.includes(secret)) {
          violations.push({
            file: relPath,
            line: i + 1,
            snippet: lineText.trim().slice(0, 80),
          });
        }
      }
    }
  } catch {
    // Ignore unreadable files
  }
}

if (violations.length > 0) {
  console.error(`[PII SANITIZER] FAIL: Found ${violations.length} PII/password leak(s) in git-tracked files:`);
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line} -> "${v.snippet}"`);
  }
  process.exit(1);
}

console.log(`[PII SANITIZER] PASS: 0 PII / phone / password leaks across all ${files.length} git-tracked files! Safe for git push.`);
process.exit(0);
