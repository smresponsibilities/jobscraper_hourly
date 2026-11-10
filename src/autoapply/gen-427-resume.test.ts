import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectRoleArchetype, buildResumePdfForArchetype } from '../resume/deterministic-builder.js';

test('GEN-427: detectRoleArchetype accurately categorizes job titles', () => {
  assert.strictEqual(detectRoleArchetype('Backend Software Engineer'), 'BACKEND_DISTRIBUTED');
  assert.strictEqual(detectRoleArchetype('Data Pipeline Engineer (PySpark/Kafka)'), 'DATA_ENGINEERING');
  assert.strictEqual(detectRoleArchetype('Full Stack Developer (React/Node)'), 'FULLSTACK_REACT');
  assert.strictEqual(detectRoleArchetype('Machine Learning Platform Engineer'), 'AI_ML_SYSTEMS');
  assert.strictEqual(detectRoleArchetype('Systems Software Engineer (Rust/C++)'), 'SYSTEMS_LOWLEVEL');
  assert.strictEqual(detectRoleArchetype('Associate Software Developer'), 'GENERAL_SWE');
});

test('GEN-427: buildResumePdf guarantees exactly 1-page A4 output', async () => {
  const tmpDir = path.resolve(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outPdf = path.join(tmpDir, 'test-resume-1page.pdf');

  // Build for DATA_ENGINEERING archetype
  await buildResumePdfForArchetype('DATA_ENGINEERING', outPdf);

  assert.strictEqual(fs.existsSync(outPdf), true, 'PDF file must be generated');
  const buffer = await fs.promises.readFile(outPdf);
  const binaryStr = buffer.toString('binary');
  const pageMatches = binaryStr.match(/\/Type\s*\/Page\b/g) || [];

  assert.strictEqual(
    pageMatches.length,
    1,
    `Resume must strictly have 1 page! Found ${pageMatches.length} pages.`
  );
});
