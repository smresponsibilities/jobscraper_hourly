import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import {
  detectJobArchetype,
  classifyRoleArchetype,
  getArchetypeOrderedBullets,
  getArchetypeCategorizedSkills,
  generateResumeHtml,
  buildOpenXmlDocx,
  buildTailoredResumePair,
  verifyNoKeywordStuffing,
  generateDualAtsResume,
  getArchetypeProjects,
} from './deterministic-builder.js';

test('detectJobArchetype and classifyRoleArchetype accurately map job requisitions', () => {
  // DATA
  assert.equal(detectJobArchetype('Senior Data Engineer', 'PySpark, Snowflake, ETL, Kafka'), 'DATA');
  assert.equal(classifyRoleArchetype('Senior Data Engineer', 'PySpark, Snowflake, ETL, Kafka'), 'DATA_SPARK_SNOWFLAKE');

  // DEVOPS
  assert.equal(detectJobArchetype('DevOps Engineer', 'Jenkins, Kubernetes, CI/CD pipelines, Docker'), 'DEVOPS');
  assert.equal(classifyRoleArchetype('DevOps Engineer', 'Jenkins, Kubernetes, CI/CD pipelines, Docker'), 'DEVOPS_CLOUD_PLATFORM');

  // FULLSTACK
  assert.equal(detectJobArchetype('Frontend React Engineer', 'React, TypeScript, UI, CSS'), 'FULLSTACK');
  assert.equal(classifyRoleArchetype('Frontend React Engineer', 'React, TypeScript, UI, CSS'), 'FULLSTACK_PRODUCT');

  // BACKEND
  assert.equal(detectJobArchetype('Backend Software Engineer', 'Java Spring Boot, REST APIs, Microservices'), 'BACKEND');
  assert.equal(classifyRoleArchetype('Backend Software Engineer', 'Java Spring Boot, REST APIs, Microservices'), 'BACKEND_DISTRIBUTED');
});

test('getArchetypeOrderedBullets prioritizes matching tech stack in top bullet', () => {
  const dataBullets = getArchetypeOrderedBullets('DATA');
  assert.ok(dataBullets[0].includes('PySpark ETL'));

  const backendBullets = getArchetypeOrderedBullets('BACKEND');
  assert.ok(backendBullets[0].includes('Java Spring Boot'));

  const devopsBullets = getArchetypeOrderedBullets('DEVOPS');
  assert.ok(devopsBullets[0].includes('Jenkins CI/CD'));

  const fullstackBullets = getArchetypeOrderedBullets('FULLSTACK');
  assert.ok(fullstackBullets[0].includes('Developed full-stack web interfaces'));
  assert.ok(fullstackBullets[0].includes('React, TypeScript'));
});

test('getArchetypeCategorizedSkills provides verified skills and excludes unverified tailwind', () => {
  const fsSkills = getArchetypeCategorizedSkills('FULLSTACK');
  const allFsSkills = Object.values(fsSkills).flat();
  assert.ok(allFsSkills.includes('React'));
  assert.ok(allFsSkills.includes('Angular'));
  assert.ok(allFsSkills.includes('Node.js'));
  assert.ok(allFsSkills.includes('Express.js'));
  assert.ok(allFsSkills.includes('WebSockets'));
  assert.equal(allFsSkills.includes('Tailwind CSS'), false);
});

test('verifyNoKeywordStuffing validates density strictly below 2.5%', () => {
  const profile = JSON.parse(
    fs.readFileSync(path.resolve('state/autoapply/portal-review/candidate.json'), 'utf8')
  );
  const cleanHtml = generateResumeHtml(profile, 'BACKEND');
  const cleanResult = verifyNoKeywordStuffing(cleanHtml);
  assert.equal(cleanResult.clean, true);
  assert.ok(cleanResult.maxFreq < 0.025);

  // Stuffed text with excessive repetitions of a keyword
  const stuffedText = cleanHtml + ' python'.repeat(25);
  const stuffedResult = verifyNoKeywordStuffing(stuffedText);
  assert.equal(stuffedResult.clean, false);
  assert.ok(stuffedResult.maxFreq >= 0.025);
});

test('buildOpenXmlDocx creates valid standard Word OpenXML document', async () => {
  const profile = {
    personal: { firstName: 'Shivam', lastName: 'Mahajan', email: 'test@example.com', phone: '9000000000' },
  } as any;
  const docxBuffer = await buildOpenXmlDocx(profile, 'BACKEND_DISTRIBUTED');
  assert.ok(docxBuffer.length > 500);

  const zip = new AdmZip(docxBuffer);
  const entries = zip.getEntries().map(e => e.entryName);
  assert.ok(entries.includes('[Content_Types].xml'));
  assert.ok(entries.includes('_rels/.rels'));
  assert.ok(entries.includes('word/document.xml'));

  const docXml = zip.readAsText('word/document.xml');
  assert.ok(docXml.includes('Shivam Mahajan'));
  assert.ok(docXml.includes('Morgan Stanley'));
});

test('generateDualAtsResume generates clean DOCX and PDF artifacts for an archetype', async () => {
  const tmpDir = path.resolve('out/test-dual-resume');
  const artifacts = await generateDualAtsResume('BACKEND', tmpDir);

  assert.equal(artifacts.archetype, 'BACKEND');
  assert.ok(fs.existsSync(artifacts.docxPath));
  assert.ok(fs.existsSync(artifacts.pdfPath));
  assert.equal(artifacts.verifiedClean, true);
  assert.ok(artifacts.maxTermFrequency < 0.025);

  const pdfStats = fs.statSync(artifacts.pdfPath);
  assert.ok(pdfStats.size > 1000);
  assert.ok(pdfStats.size < 250_000);

  const docxStats = fs.statSync(artifacts.docxPath);
  assert.ok(docxStats.size > 1000);

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

test('buildTailoredResumePair exports both valid PDF and DOCX files without keyword stuffing', async () => {
  const tmpDir = path.resolve('out/test-resume-export');
  const result = await buildTailoredResumePair(
    { title: 'Data Engineer', description: 'PySpark, Kafka, Snowflake ETL workflows', company: 'Tekion' },
    undefined,
    tmpDir
  );

  assert.equal(result.archetype, 'DATA_SPARK_SNOWFLAKE');
  assert.ok(fs.existsSync(result.docxPath));
  assert.ok(fs.existsSync(result.pdfPath));

  const pdfStats = fs.statSync(result.pdfPath);
  assert.ok(pdfStats.size > 1000);
  assert.ok(pdfStats.size < 200_000);

  const docxStats = fs.statSync(result.docxPath);
  assert.ok(docxStats.size > 500);

  // Clean up test export
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

test('all 8 resume files are generated in state/autoapply/resumes, use candidate.json email, and contain ZERO anti-bot text', async () => {
  const candidateJsonPath = path.resolve('state/autoapply/portal-review/candidate.json');
  let candidateProfile: any = {};
  try {
    candidateProfile = JSON.parse(fs.readFileSync(candidateJsonPath, 'utf8'));
  } catch {}
  const realEmail = process.env.AUTOAPPLY_EMAIL || candidateProfile?.personal?.email || candidateProfile?.basics?.email || 'test@example.com';
  const expectedPhone = process.env.AUTOAPPLY_PHONE || candidateProfile?.personal?.phone || '9000000000';
  assert.ok(realEmail && realEmail.includes('@'));

  const outputDir = path.resolve('state/autoapply/resumes');
  const archetypes: Array<'BACKEND' | 'DATA' | 'DEVOPS' | 'FULLSTACK'> = ['BACKEND', 'DATA', 'DEVOPS', 'FULLSTACK'];

  for (const arch of archetypes) {
    const artifacts = await generateDualAtsResume(arch, outputDir, undefined, candidateProfile);
    assert.equal(artifacts.archetype, arch);
    assert.ok(fs.existsSync(artifacts.docxPath), `Missing docx for ${arch}`);
    assert.ok(fs.existsSync(artifacts.pdfPath), `Missing pdf for ${arch}`);

    // Verify DOCX contents
    const zip = new AdmZip(artifacts.docxPath);
    const docXml = zip.readAsText('word/document.xml');
    const docText = docXml
      .replace(/&amp;/g, '&')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

    assert.ok(docText.includes(realEmail), `DOCX for ${arch} must contain real email ${realEmail}`);
    assert.ok(docText.includes(expectedPhone), `DOCX for ${arch} must contain candidate phone`);
    assert.ok(docText.includes('shivammahajan.com'), `DOCX for ${arch} must contain shivammahajan.com`);
    assert.ok(docText.includes('linkedin.com/in/mahajanshivam'), `DOCX for ${arch} must contain linkedin`);
    assert.ok(docText.includes('github.com/smresponsibilities'), `DOCX for ${arch} must contain github`);
    assert.ok(docText.includes('5,000,000+'), `DOCX for ${arch} must contain 5,000,000+ events metric`);
    assert.ok(docText.includes('Consecutive Days of Code'), `DOCX for ${arch} must contain achievements`);
    assert.equal(
      /anti-bot|job board automation|jobscraper|stealth traversal/i.test(docText),
      false,
      `DOCX for ${arch} contains forbidden anti-bot text`
    );

    // Verify HTML contents
    const html = generateResumeHtml(candidateProfile, arch);
    const htmlText = html
      .replace(/&amp;/g, '&')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&bull;/g, '•');

    assert.ok(htmlText.includes(realEmail), `HTML for ${arch} must contain real email ${realEmail}`);
    assert.ok(htmlText.includes(expectedPhone), `HTML for ${arch} must contain candidate phone`);
    assert.ok(htmlText.includes('shivammahajan.com'), `HTML for ${arch} must contain shivammahajan.com`);
    assert.ok(htmlText.includes('linkedin.com/in/mahajanshivam'), `HTML for ${arch} must contain linkedin`);
    assert.ok(htmlText.includes('github.com/smresponsibilities'), `HTML for ${arch} must contain github`);
    assert.ok(htmlText.includes('5,000,000+'), `HTML for ${arch} must contain 5,000,000+ events metric`);
    assert.ok(htmlText.includes('Consecutive Days of Code'), `HTML for ${arch} must contain achievements`);
    assert.equal(
      /anti-bot|job board automation|jobscraper|stealth traversal/i.test(htmlText),
      false,
      `HTML for ${arch} contains forbidden anti-bot text`
    );

    // Verify real projects from shivammahajan.com/projects/ are present by archetype
    const expectedProjects = getArchetypeProjects(arch);
    for (const proj of expectedProjects) {
      assert.ok(docText.includes(proj.title), `DOCX for ${arch} must contain project ${proj.title}`);
      assert.ok(htmlText.includes(proj.title), `HTML for ${arch} must contain project ${proj.title}`);
    }
  }
});

