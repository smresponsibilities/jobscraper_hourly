import fs from 'node:fs';
import path from 'node:path';

export interface OutreachSentRecord {
  email: string;
  company: string;
  roleTitle: string;
  sentAt: string;
  messageId?: string;
}

export interface OutreachLedgerState {
  records: OutreachSentRecord[];
}

const DEFAULT_LEDGER_PATH = path.resolve('state/outreach/sent-ledger.json');
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function loadOutreachLedger(ledgerPath = DEFAULT_LEDGER_PATH): OutreachLedgerState {
  if (!fs.existsSync(ledgerPath)) {
    return { records: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    return { records: Array.isArray(parsed?.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
}

export function canSendOutreachToTarget(
  email: string,
  company: string,
  ledger: OutreachLedgerState,
  maxDailySends = 40
): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const cleanEmail = email.trim().toLowerCase();
  const cleanCompany = company.trim().toLowerCase();

  let sendsLast24h = 0;
  for (const r of ledger.records) {
    const ts = Date.parse(r.sentAt) || 0;
    if (now - ts <= ONE_DAY_MS) {
      sendsLast24h++;
    }
    if (now - ts <= THIRTY_DAYS_MS) {
      if (r.email.trim().toLowerCase() === cleanEmail) {
        return { allowed: false, reason: 'recipient_contacted_within_30d' };
      }
      if (r.company.trim().toLowerCase() === cleanCompany) {
        return { allowed: false, reason: 'company_contacted_within_30d' };
      }
    }
  }

  if (sendsLast24h >= maxDailySends) {
    return { allowed: false, reason: `daily_cap_reached_${maxDailySends}` };
  }

  return { allowed: true };
}

export function recordOutreachSent(
  record: OutreachSentRecord,
  ledgerPath = DEFAULT_LEDGER_PATH
): void {
  const state = loadOutreachLedger(ledgerPath);
  state.records.push(record);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify(state, null, 2));
}

export function pickRoleTailoredProjectsSummary(roleTitle: string): string {
  const t = String(roleTitle || '').toLowerCase();
  if (/\b(?:ml|machine\s+learning|ai|data\s+scientist|nlp|llm|research|eval)\b/.test(t)) {
    return 'Chaincode (AI coding validation platform with 15+ REST APIs at 95%+ accuracy; placed 3rd out of 200+ engineering teams at HackIndia) and Fertilizer Recommendation ML Microservice (production Python/XGBoost/Scikit-Learn REST API)';
  }
  if (/\b(?:data\s+engineer|analytics|database|etl|warehouse|clickhouse|spark|kafka)\b/.test(t)) {
    return 'ClickHouse Data Ingestion Tool (bidirectional OLAP-to-CSV pipeline with real-time schema mapping and batch validation) and Shopify Insights (PostgreSQL analytics & cohort retention platform)';
  }
  if (/\b(?:mobile|android|kotlin)\b/.test(t)) {
    return 'Productivity Caller (native Kotlin & Jetpack Compose Android priority voice-call reminder app with an NLP task parser) and QuizDeck (500 concurrent players at 31ms latency)';
  }
  if (/\b(?:systems|infra|platform|devops|rust|wasm|c\+\+)\b/.test(t)) {
    return "SM'S DEX & Terminal Wordle Engine (2.4 KB native C99 WebAssembly polynomial-hash engine, Rust OS pointer utility, and automated GitHub Actions CI validator) and ClickHouse Data Ingestion Tool";
  }
  return 'QuizDeck (real-time WebSocket engine stress-tested for 500 concurrent users at 31ms average latency), ClickHouse Data Ingestion Tool, and Chaincode (placed 3rd out of 200+ teams at HackIndia)';
}
