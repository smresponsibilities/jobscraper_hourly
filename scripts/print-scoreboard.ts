// scripts/print-scoreboard.ts
import * as fs from 'node:fs';
import { generateParkIssuesScoreboard } from '../src/autoapply/park-telemetry.js';

const report = generateParkIssuesScoreboard();

console.log('=== QUEUE STATUS TOTALS ===');
console.table(report.statusTotals);

console.log('\n=== PARETO TABLE OF PARKED ISSUES ===');
const tableData = report.paretoIssues.map(issue => ({
  'Category': issue.reasonCategory,
  'Count': issue.count,
  'Share': issue.percentageOfParked,
  'Sample Companies': issue.sampleCompanies.slice(0, 3).join(', '),
  'Auto-Fix Recommendation': issue.autoFixRecommendation.slice(0, 45) + '...',
}));
console.table(tableData);
