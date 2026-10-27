/**
 * Teal Heuristic Compensation & Salary Scorer.
 * Reverse-engineered from Teal's compensation extraction engine.
 */

export interface CompensationResult {
  raw: string;
  min?: number;
  max?: number;
  annualizedMin?: number;
  annualizedMax?: number;
  currency?: string;
  period?: 'yearly' | 'monthly' | 'weekly' | 'hourly';
  score: number;
  isLikelySalary: boolean;
}

const POSITIVE_PATTERNS = [
  { pattern: /between\s+[\$₹€£]?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:k)?\s*(?:and|&)\s*[\$₹€£]?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?/i, score: 7, isRange: true },
  { pattern: /[\$₹€£]\s*(\d[\d,]*(?:\.\d+)?)\s*(?:k)?\s*(?:to|[—–-]|and|&)\s*[\$₹€£]?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?/i, score: 7, isRange: true },
  { pattern: /starts?\s+at\s+[\$₹€£]?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?/i, score: 7, isSingle: true },
  { pattern: /(?:salary|compensation|package|pay|rate)?\s*(?:is|:)?\s*[\$₹€£]\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?/i, score: 7, isSingle: true },
  { pattern: /\b(?:salary|compensation|pay\s+range|base\s+pay|hourly\s+rate|annual\s+salary)\b/i, score: 5 },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lac|lacs)\b/i, score: 8, isLpa: true },
  { pattern: /\b(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:cr|crores?)\b/i, score: 8, isCrore: true },
  { pattern: /(?:salary|compensation|package|ctc|pay)?\s*:?\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lac|lacs)\b/i, score: 7, isSingleLpa: true },
  { pattern: /(?:salary|compensation|package|ctc|pay)?\s*:?\s*(\d+(?:\.\d+)?)\s*(?:cr|crores?)\b/i, score: 7, isSingleCrore: true },
];

const PENALTY_PATTERNS = [
  { pattern: /\b\d+\s*%/i, penalty: 5 },
  { pattern: /\b(?:time|days)\s+off\b|\bholidays\b/i, penalty: 5 },
  { pattern: /\b(?:education|tuition|reimbursement)\b/i, penalty: 5 },
  { pattern: /\b(?:experience|years?\s+of|years?\s+old)\b/i, penalty: 5 },
  { pattern: /\b401\s*\(?k\)?\b/i, penalty: 7 },
  { pattern: /\b\d+\s*(?:lbs|kg)\b/i, penalty: 10 },
  { pattern: /\b(?:bonus|equity|stock\s+options)\b/i, penalty: 3 },
];

/**
 * Normalizes number strings like "120k" or "120,000" or "15 LPA".
 */
function parseSalaryNumber(numStr: string, hasK?: boolean): number {
  let val = parseFloat(numStr.replace(/,/g, ''));
  if (hasK || val < 1000 && !numStr.includes('.')) {
    // If e.g. 120 or 150 with k
    if (hasK) val *= 1000;
  }
  return val;
}

/**
 * Extracts and scores compensation from text.
 */
export function extractCompensation(text: string): CompensationResult | null {
  if (!text || text.trim().length === 0) return null;

  let totalScore = 0;
  let matchedSnippet = '';
  let min: number | undefined;
  let max: number | undefined;

  let currency = 'USD';
  let period: 'yearly' | 'monthly' | 'weekly' | 'hourly' = 'yearly';
  let hasCurrency = false;
  let hasPeriod = false;

  if (text.includes('₹') || /\blpa\b/i.test(text) || /\blakhs?\b/i.test(text) || /\bcrores?\b/i.test(text) || /\bcr\b/i.test(text)) {
    currency = 'INR';
    hasCurrency = true;
  } else if (text.includes('€') || /\bEUR\b/i.test(text)) {
    currency = 'EUR';
    hasCurrency = true;
  } else if (text.includes('£') || /\bGBP\b/i.test(text)) {
    currency = 'GBP';
    hasCurrency = true;
  } else if (text.includes('CA$') || /\bCAD\b/i.test(text)) {
    currency = 'CAD';
    hasCurrency = true;
  } else if (text.includes('AU$') || /\bAUD\b/i.test(text)) {
    currency = 'AUD';
    hasCurrency = true;
  } else if (text.includes('$') || /\bUSD\b/i.test(text)) {
    currency = 'USD';
    hasCurrency = true;
  }

  if (/\b(?:per\s+hour|\/hr|\/hour|hourly)\b/i.test(text)) {
    period = 'hourly';
    hasPeriod = true;
  } else if (/\b(?:per\s+week|\/wk|\/week|weekly)\b/i.test(text)) {
    period = 'weekly';
    hasPeriod = true;
  } else if (/\b(?:per\s+month|\/month|monthly|\/mth)\b/i.test(text)) {
    period = 'monthly';
    hasPeriod = true;
  } else if (/\b(?:per\s+year|\/yr|\/year|annually|annual|per\s+annum)\b/i.test(text)) {
    period = 'yearly';
    hasPeriod = true;
  }

  if (hasCurrency) {
    totalScore += 15; // Teal currencyScore
  }
  if (hasPeriod) {
    totalScore += 2; // Teal periodScore
  }

  // 1. Evaluate positives
  for (const pos of POSITIVE_PATTERNS) {
    const m = text.match(pos.pattern);
    if (m) {
      totalScore += pos.score;
      if (!matchedSnippet) matchedSnippet = m[0];

      if (pos.isLpa && m[1] && m[2]) {
        // e.g. "12 - 18 LPA"
        const num1 = parseFloat(m[1]) * 100000;
        const num2 = parseFloat(m[2]) * 100000;
        min = Math.min(num1, num2);
        max = Math.max(num1, num2);
      } else if (pos.isCrore && m[1] && m[2]) {
        // e.g. "1.2 - 1.8 Cr"
        const num1 = parseFloat(m[1]) * 10000000;
        const num2 = parseFloat(m[2]) * 10000000;
        min = Math.min(num1, num2);
        max = Math.max(num1, num2);
      } else if (pos.isSingleLpa && m[1] && min === undefined) {
        min = parseFloat(m[1]) * 100000;
      } else if (pos.isSingleCrore && m[1] && min === undefined) {
        min = parseFloat(m[1]) * 10000000;
      } else if (pos.isRange && m[1] && m[2]) {
        const hasK = !!m[3] || m[0].toLowerCase().includes('k');
        const num1 = parseSalaryNumber(m[1], hasK);
        const num2 = parseSalaryNumber(m[2], hasK);
        min = Math.min(num1, num2);
        max = Math.max(num1, num2);
      } else if (pos.isSingle && m[1] && min === undefined) {
        const hasK = !!m[2] || m[0].toLowerCase().includes('k');
        min = parseSalaryNumber(m[1], hasK);
      }
    }
  }

  if (totalScore === 0) return null;

  // 2. Evaluate penalties
  for (const pen of PENALTY_PATTERNS) {
    if (pen.pattern.test(text)) {
      totalScore -= pen.penalty;
    }
  }

  // 3. Compute annualized equivalents (Teal periodsInYear: hour 2000, week 50, month 12, year 1)
  let annualizedMin: number | undefined;
  let annualizedMax: number | undefined;
  const mult = period === 'hourly' ? 2000 : period === 'weekly' ? 50 : period === 'monthly' ? 12 : 1;
  if (min !== undefined) {
    annualizedMin = Math.round(min * mult);
  }
  if (max !== undefined) {
    annualizedMax = Math.round(max * mult);
  }

  return {
    raw: matchedSnippet || text.slice(0, 80),
    min,
    max,
    annualizedMin,
    annualizedMax,
    currency,
    period,
    score: totalScore,
    isLikelySalary: totalScore >= 10,
  };
}
