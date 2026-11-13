import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { computeTenantCooldownWaitMs, recordTenantHttpOutcome, reserveTenantRequest } from './tenant-rate-limiter.js';
import { isHostReadyForRequest, markHostOutcome } from './session-pool.js';

test('tenant reservation persists, serializes same-tenant lanes and backs off with jitter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-rate-test-'));
  const file = path.join(dir, 'limits.json');
  const hostFile = path.join(dir, 'hosts.json');
  const random = Math.random;
  try {
    Math.random = () => 0.5;
    const now = 1_000_000;
    assert.equal(reserveTenantRequest('ashby/acme', 45_000, now, file), true);
    assert.equal(reserveTenantRequest('ashby/acme', 45_000, now, file), false);
    assert.equal(reserveTenantRequest('ashby/other', 45_000, now, file), true);
    assert.equal(computeTenantCooldownWaitMs('ashby/acme', 45_000, now + 10_000, file), 35_000);
    assert.deepEqual(recordTenantHttpOutcome('ashby/acme', 429, now + 45_000, file), { backoffMs: 45_000, consecutive429s: 1 });
    assert.deepEqual(recordTenantHttpOutcome('ashby/acme', 503, now + 90_000, file), { backoffMs: 90_000, consecutive429s: 2 });
    assert.equal(computeTenantCooldownWaitMs('ashby/acme', 45_000, now + 100_000, file), 80_000);
    recordTenantHttpOutcome('ashby/acme', 200, now + 101_000, file);
    assert.equal(computeTenantCooldownWaitMs('ashby/acme', 45_000, now + 102_000, file), 78_000);
    assert.equal(recordTenantHttpOutcome('ashby/acme', 429, now + 180_000, file).consecutive429s, 1);
    const beforeLock = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(`${file}.lock`, 'occupied');
    assert.throws(() => reserveTenantRequest('ashby/new', 45_000, now, file), /locked/);
    assert.equal(fs.readFileSync(file, 'utf8'), beforeLock);
    fs.unlinkSync(`${file}.lock`);
    const url = 'https://jobs.ashbyhq.com/acme/fixture';
    markHostOutcome(url, 'rate_limited', hostFile);
    assert.equal(isHostReadyForRequest(url, 0, hostFile), false);
    const host = JSON.parse(fs.readFileSync(hostFile, 'utf8'))['jobs.ashbyhq.com/acme'];
    assert(host.backoffUntil - host.lastRequestAt >= 30_000 && host.backoffUntil - host.lastRequestAt < 60_000);
    markHostOutcome(url, 'success', hostFile);
    assert.equal(isHostReadyForRequest(url, 0, hostFile), false);
    fs.writeFileSync(file, 'corrupt');
    assert.throws(() => reserveTenantRequest('ashby/acme', 45_000, now, file));
    assert.equal(fs.readFileSync(file, 'utf8'), 'corrupt');
  } finally {
    Math.random = random;
    for (const filePath of [file, hostFile]) if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    fs.rmdirSync(dir);
  }
});
