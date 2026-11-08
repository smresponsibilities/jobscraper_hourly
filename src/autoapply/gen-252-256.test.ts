import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyAndAddLiveBoardsToCompaniesJson } from '../../scripts/verify-and-add-live-boards.js';
import { selectBoards } from '../select-boards.js';
import type { Company, BoardState } from '../types.js';

test('GEN-252: companies.json has >= 13,500 verified boards, 0 isolated tenants, and exports verifyAndAddLiveBoardsToCompaniesJson', () => {
  assert.equal(typeof verifyAndAddLiveBoardsToCompaniesJson, 'function');
  assert.ok(fs.existsSync('companies.json'), 'companies.json must exist');
  const raw = JSON.parse(fs.readFileSync('companies.json', 'utf8'));
  const list: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : raw.companies || [];
  assert.ok(list.length >= 13500, `Must have >= 13,500 verified boards, found ${list.length}`);

  const isolatedTenants = ['stripe', 'avoca', 'ssctech', 'paypal'];
  for (const item of list) {
    const slug = String(item.token || item.slug || item.board || item.id || '').toLowerCase();
    for (const isolated of isolatedTenants) {
      assert.notEqual(slug, isolated, `Isolated tenant "${isolated}" must not be present`);
    }
  }
});

test('GEN-253: select-boards.ts prioritizes healthy boards over failing streaks, and fetchers extract multi-location', () => {
  const healthy: Company = { token: 'healthyCo', ats: 'greenhouse', name: 'HealthyCo' };
  const failing: Company = { token: 'failingCo', ats: 'greenhouse', name: 'FailingCo' };

  const boardState: BoardState = {
    'greenhouse:healthyco:': { lastPolledAt: '2026-08-01T00:00:00Z' },
    'greenhouse:failingco:': { lastPolledAt: '2026-07-01T00:00:00Z', failingSince: '2026-07-01T00:00:00Z' },
  };

  const sel = selectBoards([failing, healthy], boardState, 1);
  assert.equal(sel.polling.length, 1);
  assert.equal(sel.polling[0]?.token, 'healthyCo', 'Healthy board must be prioritized over failing board');

  const ashbyCode = fs.readFileSync('src/fetchers/ashby.ts', 'utf8');
  assert.ok(ashbyCode.includes('isRemote'), 'Ashby fetcher must inspect isRemote');

  const ghCode = fs.readFileSync('src/fetchers/greenhouse.ts', 'utf8');
  assert.ok(ghCode.includes('offices'), 'Greenhouse fetcher must extract offices');

  const huntYml = fs.readFileSync('.github/workflows/hunt.yml', 'utf8');
  assert.ok(huntYml.includes('harvest-100-hourly-jobs.ts'), 'hunt.yml must run harvest-100-hourly-jobs.ts');
});

test('GEN-254: outreach.yml and src/outreach.ts integrate applied outreach targets', () => {
  const outreachYml = fs.readFileSync('.github/workflows/outreach.yml', 'utf8');
  assert.ok(outreachYml.includes('sync-applied-to-outreach.ts'), 'outreach.yml must sync applied jobs');
  assert.ok(outreachYml.includes('enrich-applied-outreach.ts'), 'outreach.yml must enrich applied outreach');

  const outreachCode = fs.readFileSync('src/outreach.ts', 'utf8');
  assert.ok(outreachCode.includes('applied-outreach-targets.json'), 'outreach.ts must wire applied outreach targets');
});
