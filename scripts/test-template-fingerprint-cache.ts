import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  computeFormSchemaHash,
  recordSchemaSubmissionSuccess,
  lookupCachedFieldResolution,
  saveSchemaCache,
  type SchemaCacheEntry,
} from '../src/autoapply/template-fingerprint-cache.js';

async function testTemplateFingerprintCache() {
  console.log('[TEST-GEN-537] Starting Template Fingerprint Cache test...');

  const testCachePath = path.resolve('state/autoapply/test-schema-cache.json');
  if (fs.existsSync(testCachePath)) {
    fs.unlinkSync(testCachePath);
  }

  const sampleFields = [
    { name: 'first_name', type: 'text', label: 'First Name' },
    { name: 'last_name', type: 'text', label: 'Last Name' },
    { name: 'email', type: 'email', label: 'Email Address' },
    { name: 'phone', type: 'tel', label: 'Phone Number' },
  ];

  // 1. Hash stability
  const hash1 = computeFormSchemaHash('greenhouse', sampleFields);
  const hash2 = computeFormSchemaHash('greenhouse', sampleFields.slice().reverse());
  assert.strictEqual(hash1, hash2, 'Hash must be order-invariant across fields');
  console.log('✔ Schema hash order-invariance verified:', hash1);

  // 2. Cache miss before record
  const miss = lookupCachedFieldResolution(hash1, 'first_name', testCachePath);
  assert.strictEqual(miss, null, 'Must be null before recording');

  // 3. Record verified submission
  recordSchemaSubmissionSuccess(
    'greenhouse',
    sampleFields,
    {
      first_name: { factKey: 'personal.firstName', resolvedValue: 'Shivam' },
      last_name: { factKey: 'personal.lastName', resolvedValue: 'Mahajan' },
    },
    testCachePath
  );

  // 4. Cache hit in < 2ms
  const t0 = performance.now();
  const hit = lookupCachedFieldResolution(hash1, 'first_name', testCachePath);
  const lookupDuration = performance.now() - t0;
  console.log(`Lookup duration: ${lookupDuration.toFixed(3)}ms`);
  assert(hit !== null, 'Should hit cached resolution');
  assert.strictEqual(hit.resolvedValue, 'Shivam');
  assert.strictEqual(hit.factKey, 'personal.firstName');
  assert(lookupDuration < 5, `Lookup should be fast (< 5ms), took ${lookupDuration}ms`);
  console.log('✔ Cache hit with grounded factKey verified');

  // 5. LRU eviction at 500 entries
  const bulkCache: Record<string, SchemaCacheEntry> = {};
  for (let i = 0; i < 505; i++) {
    const fakeHash = `hash_${i}`;
    bulkCache[fakeHash] = {
      schemaHash: fakeHash,
      provider: 'greenhouse',
      lastUsedAt: new Date(Date.now() - (505 - i) * 1000).toISOString(),
      fields: {},
    };
  }
  saveSchemaCache(bulkCache, testCachePath);
  const savedCache = JSON.parse(fs.readFileSync(testCachePath, 'utf8'));
  const savedCount = Object.keys(savedCache).length;
  console.log(`Entries after saving 505: ${savedCount}`);
  assert.strictEqual(savedCount, 500, 'Should cap at exactly 500 entries');
  assert(!savedCache['hash_0'], 'Oldest entry (hash_0) should be evicted');
  assert(savedCache['hash_504'], 'Newest entry (hash_504) must remain');
  console.log('✔ LRU eviction logic verified');

  // Cleanup
  if (fs.existsSync(testCachePath)) {
    fs.unlinkSync(testCachePath);
  }

  console.log('[TEST-GEN-537 PASS] Template Fingerprint Cache tests passed successfully.');
}

testTemplateFingerprintCache().catch(err => {
  console.error('[TEST-GEN-537 FAIL]', err);
  process.exit(1);
});
