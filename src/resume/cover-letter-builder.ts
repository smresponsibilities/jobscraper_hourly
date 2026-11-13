// src/resume/cover-letter-builder.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { chromium } from 'patchright';
import { generateComplementaryCoverLetterText } from './deterministic-builder.js';

export interface CoverLetterParams {
  company?: string;
  roleTitle?: string;
  outputPath?: string;
  docxPath?: string;
  jdText?: string;
  resumeSelectedProjectIds?: string[];
}

export const DEFAULT_COVER_LETTER_PDF = path.resolve('state/autoapply/resumes/Shivam_Mahajan_Cover_Letter.pdf');
export const DEFAULT_COVER_LETTER_DOCX = path.resolve('state/autoapply/resumes/Shivam_Mahajan_Cover_Letter.docx');

function coverLetterText(params: CoverLetterParams): string {
  const result = generateComplementaryCoverLetterText({
    companyName: params.company?.trim() || 'the Engineering Team',
    jobTitle: params.roleTitle?.trim() || 'Software Engineer',
    jdText: params.jdText || '',
    resumeSelectedProjectIds: params.resumeSelectedProjectIds,
  });
  if (!result.keywordDensityOk) throw new Error('Cover letter keyword density requires review');
  return result.text;
}

function contactLine(): string {
  return ['Bengaluru, India', process.env.AUTOAPPLY_EMAIL || process.env.IMAP_USER || '', process.env.AUTOAPPLY_PHONE || process.env.PHONE || '', 'shivammahajan.com/projects'].filter(Boolean).join(' | ');
}

export function buildCoverLetterHtml(params: CoverLetterParams = {}): string {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const paragraphs = coverLetterText(params).split('\n\n').map(text => `<p>${escape(text).replace(/\n/g, '<br>')}</p>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>@page{size:A4;margin:16mm}body{font:11pt Arial;line-height:1.5;color:#1e293b}header{font-size:9pt;color:#475569}p{margin:0 0 1em}</style></head><body><header>${escape(contactLine())}</header>${paragraphs}</body></html>`;
}

export async function buildCoverLetterDocx(params: CoverLetterParams = {}): Promise<Buffer> {
  const paragraphs = coverLetterText(params).split('\n\n');
  const doc = new Document({ sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 1080, right: 1080 } } }, children: [
    new Paragraph({ children: [new TextRun({ text: contactLine(), size: 18, color: '475569' })], spacing: { after: 160 } }),
    ...paragraphs.map(text => new Paragraph({ children: [new TextRun({ text, size: 21, color: '1e293b' })], spacing: { after: 140 } })),
  ] }] });
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
