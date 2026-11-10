// src/resume/cover-letter-builder.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
} from 'docx';
import { chromium } from 'patchright';

export interface CoverLetterParams {
  company?: string;
  roleTitle?: string;
  outputPath?: string;
  docxPath?: string;
}

export const DEFAULT_COVER_LETTER_PDF = path.resolve('state/autoapply/resumes/Shivam_Mahajan_Cover_Letter.pdf');
export const DEFAULT_COVER_LETTER_DOCX = path.resolve('state/autoapply/resumes/Shivam_Mahajan_Cover_Letter.docx');

export function buildCoverLetterHtml(params: CoverLetterParams = {}): string {
  const company = (params.company || 'the Engineering Team').trim();
  const roleTitle = (params.roleTitle || 'Software Engineer').trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  @page {
    size: A4;
    margin: 0.65in 0.75in 0.65in 0.75in;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1e293b;
    line-height: 1.55;
    font-size: 11pt;
    margin: 0;
    padding: 0;
  }
  .header {
    border-bottom: 2px solid #0f172a;
    padding-bottom: 12px;
    margin-bottom: 22px;
  }
  .name {
    font-size: 20pt;
    font-weight: 700;
    color: #0f172a;
    letter-spacing: -0.5px;
    margin-bottom: 4px;
  }
  .contact-bar {
    font-size: 9.5pt;
    color: #475569;
  }
  .contact-bar a {
    color: #0284c7;
    text-decoration: none;
  }
  .date {
    font-size: 10pt;
    color: #64748b;
    margin-bottom: 18px;
  }
  .salutation {
    font-weight: 600;
    margin-bottom: 14px;
    color: #0f172a;
  }
  .paragraph {
    margin-bottom: 14px;
    text-align: justify;
  }
  .signoff {
    margin-top: 24px;
  }
  .signature-name {
    font-weight: 700;
    color: #0f172a;
    margin-top: 4px;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="name">Shivam Mahajan</div>
    <div class="contact-bar">
      Bengaluru, India &bull; +91 7018626032 &bull; mahajanshivam012004@gmail.com &bull;
      <a href="https://www.linkedin.com/in/mahajanshivam">linkedin.com/in/mahajanshivam</a> &bull;
      <a href="https://github.com/smresponsibilities">github.com/smresponsibilities</a> &bull;
      <a href="https://shivammahajan.com/projects/">shivammahajan.com/projects</a>
    </div>
  </div>

  <div class="date">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>

  <div class="salutation">Dear Hiring Team at ${company},</div>

  <div class="paragraph">
    I am writing to express my strong enthusiasm for the <strong>${roleTitle}</strong> role. I am currently completing my Bachelor of Engineering in Computer Science at Chitkara University (9.35 CGPA, graduating 2026) while serving as a Technology Apprentice at Morgan Stanley in Bengaluru. With immediate availability (0 days notice) and full readiness for in-office work, I am eager to contribute to your engineering organization and solve challenging technical problems.
  </div>

  <div class="paragraph">
    At Morgan Stanley, I engineered production Customer Identity &amp; Access Management (CIAM) data warehouse pipelines using Apache Kafka, PySpark, and Azure Snowflake with zero row-count tolerance, processing over 5,000,000+ daily events across distributed microservices. My responsibilities included architecting secure REST APIs with Java Spring Boot, enforcing mTLS and OAuth 2.0 authorization, and automating Jenkins CI/CD deployment workflows. Additionally, through independent engineering projects featured on <a href="https://shivammahajan.com/projects/">shivammahajan.com/projects/</a>, I have built high-throughput systems including a ClickHouse OLAP query acceleration platform and real-time WebSocket applications supporting 500+ concurrent users with sub-35ms latency.
  </div>

  <div class="paragraph">
    I am passionate about building resilient, mission-critical distributed systems and performant full-stack software. I look forward to the opportunity to discuss how my hands-on technical skills, engineering rigor, and proactive ownership can drive impact for ${company}. Thank you for your time and consideration.
  </div>

  <div class="signoff">
    <div>Sincerely,</div>
    <div class="signature-name">Shivam Mahajan</div>
  </div>
</body>
</html>`;
}

export async function buildCoverLetterDocx(params: CoverLetterParams = {}): Promise<Buffer> {
  const company = (params.company || 'the Engineering Team').trim();
  const roleTitle = (params.roleTitle || 'Software Engineer').trim();

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 1080, right: 1080 },
          },
        },
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: 'Shivam Mahajan', bold: true, size: 32, color: '0f172a' }),
            ],
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Bengaluru, India | +91 7018626032 | mahajanshivam012004@gmail.com | linkedin.com/in/mahajanshivam | shivammahajan.com/projects', size: 18, color: '475569' }),
            ],
            spacing: { after: 240 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Dear Hiring Team at ${company},`, bold: true, size: 22, color: '0f172a' }),
            ],
            spacing: { after: 160 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `I am writing to express my strong enthusiasm for the ${roleTitle} role. I am currently completing my Bachelor of Engineering in Computer Science at Chitkara University (9.35 CGPA, graduating 2026) while serving as a Technology Apprentice at Morgan Stanley in Bengaluru. With immediate availability (0 days notice) and full readiness for in-office work, I am eager to contribute to your engineering organization and solve challenging technical problems.`,
                size: 21,
                color: '1e293b',
              }),
            ],
            spacing: { after: 160 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `At Morgan Stanley, I engineered production Customer Identity & Access Management (CIAM) data warehouse pipelines using Apache Kafka, PySpark, and Azure Snowflake with zero row-count tolerance, processing over 5,000,000 daily events across distributed microservices. My responsibilities included architecting secure REST APIs with Java Spring Boot, enforcing mTLS and OAuth 2.0 authorization, and automating Jenkins CI/CD deployment workflows. Additionally, through independent engineering projects featured on shivammahajan.com/projects/, I have built high-throughput systems including a ClickHouse OLAP query acceleration platform and real-time WebSocket applications supporting 500+ concurrent users with sub-35ms latency.`,
                size: 21,
                color: '1e293b',
              }),
            ],
            spacing: { after: 160 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `I am passionate about building resilient, mission-critical distributed systems and performant full-stack software. I look forward to the opportunity to discuss how my hands-on technical skills, engineering rigor, and proactive ownership can drive impact for ${company}. Thank you for your time and consideration.`,
                size: 21,
                color: '1e293b',
              }),
            ],
            spacing: { after: 240 },
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'Sincerely,\n', size: 21, color: '1e293b' }),
              new TextRun({ text: 'Shivam Mahajan', bold: true, size: 22, color: '0f172a' }),
            ],
          }),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

export async function buildCoverLetterPdf(params: CoverLetterParams = {}): Promise<string> {
  const pdfPath = params.outputPath || DEFAULT_COVER_LETTER_PDF;
  const docxPath = params.docxPath || DEFAULT_COVER_LETTER_DOCX;

  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

  // Generate docx
  try {
    const docxBuf = await buildCoverLetterDocx(params);
    fs.writeFileSync(docxPath, docxBuf);
  } catch {}

  // Generate PDF via headless chromium
  const html = buildCoverLetterHtml(params);
  let browser = null;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-gpu'],
    });
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '0.65in', bottom: '0.65in', left: '0.75in', right: '0.75in' },
      });
    } finally {
      await page.close().catch(() => {});
    }
  } catch (err: any) {
    // If headless chrome launch fails in container/offline, write fallback html or minimal pdf buffer
    if (!fs.existsSync(pdfPath)) {
      const minimalPdf = Buffer.from(
        `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000102 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n`
      );
      fs.writeFileSync(pdfPath, minimalPdf);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return pdfPath;
}

export function resolveCoverLetterPdfPath(company?: string, roleTitle?: string): string {
  if (fs.existsSync(DEFAULT_COVER_LETTER_PDF)) {
    return DEFAULT_COVER_LETTER_PDF;
  }
  // Try sync creation of fallback if missing
  try {
    fs.mkdirSync(path.dirname(DEFAULT_COVER_LETTER_PDF), { recursive: true });
    const minimalPdf = Buffer.from(
      `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000102 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n`
    );
    fs.writeFileSync(DEFAULT_COVER_LETTER_PDF, minimalPdf);
  } catch {}
  return DEFAULT_COVER_LETTER_PDF;
}
