import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type DynamicArchetype,
  classifyDynamicArchetype,
  getArchetypeOrderedBullets,
  getArchetypeProjects,
  getArchetypeCategorizedSkills,
  generateResumeHtml,
  generateDualAtsResume,
  inspectPdfPageCount,
} from '../resume/deterministic-builder.js';

test('GEN-427: classifyDynamicArchetype accurately resolves all 6 archetypes', () => {
  assert.equal(
    classifyDynamicArchetype('Senior Backend Engineer', 'Apache Kafka, Spring Boot, PySpark, ClickHouse, Microservices'),
    'BACKEND_DISTRIBUTED'
  );
  assert.equal(
    classifyDynamicArchetype('Frontend React Engineer', 'React 19, Next.js, WebSockets, TypeScript, UI Components'),
    'FULLSTACK_REACT'
  );
  assert.equal(
    classifyDynamicArchetype('Lead Data Platform Engineer', 'Apache Spark, Hive, Data Warehouse, ClickHouse OLAP, PySpark'),
    'DATA_ENGINEERING'
  );
  assert.equal(
    classifyDynamicArchetype('AI / Machine Learning Engineer', 'Python, XGBoost, Scikit-Learn, Gemini AI, Deep Learning'),
    'AI_ML_SYSTEMS'
  );
  assert.equal(
    classifyDynamicArchetype('Low-Level Systems Engineer', 'C99, WebAssembly, Rust, Memory Management, Linux Systems'),
    'SYSTEMS_LOWLEVEL'
  );
  assert.equal(
    classifyDynamicArchetype('Software Development Engineer', 'General software development and problem solving'),
    'GENERAL_SWE'
  );
});

test('GEN-427: Jake Resume FAANG layout contains linear headers, system fonts, and 0.5in margins', () => {
  const profile = {
    personal: {
      firstName: 'Shivam',
      lastName: 'Mahajan',
      email: 'sm@example.com',
      phone: '+91 9999999999',
      city: 'Bengaluru',
      country: 'India',
    },
  } as any;

  const html = generateResumeHtml(profile, 'BACKEND_DISTRIBUTED');
  assert.ok(html.includes('EDUCATION'), 'HTML must include linear header EDUCATION');
  assert.ok(html.includes('EXPERIENCE'), 'HTML must include linear header EXPERIENCE');
  assert.ok(html.includes('PROJECTS'), 'HTML must include linear header PROJECTS');
  assert.ok(html.includes('TECHNICAL SKILLS'), 'HTML must include linear header TECHNICAL SKILLS');
  assert.ok(html.includes('margin: 0.5in'), 'HTML @page must define 0.5in margins');
  assert.ok(html.includes('Times New Roman'), 'HTML body font must use standard system font');
  assert.ok(html.includes('project-item'), 'Technical projects must use project-item class for headless Chromium evaluation');
});

test('GEN-427: Across all 6 archetypes, generated PDF has single-page guarantee (pageCount === 1)', async () => {
  const archetypes: DynamicArchetype[] = [
    'BACKEND_DISTRIBUTED',
    'FULLSTACK_REACT',
    'DATA_ENGINEERING',
    'AI_ML_SYSTEMS',
    'SYSTEMS_LOWLEVEL',
    'GENERAL_SWE',
  ];

  const outputDir = path.resolve('state/autoapply/resumes');
  fs.mkdirSync(outputDir, { recursive: true });

  for (const arch of archetypes) {
    const artifacts = await generateDualAtsResume(arch as any, outputDir);
    assert.ok(fs.existsSync(artifacts.pdfPath), `PDF artifact must exist for ${arch}`);
    assert.ok(fs.existsSync(artifacts.docxPath), `DOCX artifact must exist for ${arch}`);

    const pdfBuffer = fs.readFileSync(artifacts.pdfPath);
    assert.ok(pdfBuffer.length > 1000, `PDF size must be > 1000 bytes for ${arch}`);

    const pageCount = inspectPdfPageCount(pdfBuffer);
    assert.equal(pageCount, 1, `Archetype ${arch} must produce exactly 1 page PDF (got ${pageCount})`);
  }
});
