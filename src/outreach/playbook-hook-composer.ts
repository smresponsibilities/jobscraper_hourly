import { selectBestPortfolioProjectForQuestion } from '../autoapply/narrative-composer.js';

/** Compose a draft only. A submission claim requires an independently verified receipt. */
export function composePersonaOutreachEmail(params: { recipientName: string; recipientRole: 'ENGINEERING_LEAD' | 'RECRUITER'; companyName: string; jobTitle: string; jobReqId?: string; ossSignal?: { repoOrPkgName: string; techStack: string }; jdText?: string; applicationReceiptVerified?: boolean }): { subject: string; bodyText: string; wordCount: number; citedPortfolioUrl: string } {
  const clean = (value: string) => value.replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  const recipient = clean(params.recipientName), company = clean(params.companyName), title = clean(params.jobTitle);
  if (!recipient || !company || !title || !['ENGINEERING_LEAD', 'RECRUITER'].includes(params.recipientRole)) throw new Error('Recipient, company, role and title are required');
  const req = params.jobReqId ? clean(params.jobReqId) : '';
  const repo = params.ossSignal?.repoOrPkgName ? clean(params.ossSignal.repoOrPkgName) : '';
  const subject = params.recipientRole === 'RECRUITER' ? `${params.applicationReceiptVerified ? 'Applied' : 'Interest'}: ${title}${req ? ` (${req})` : ''} — Morgan Stanley Technology Apprentice` : `${title} — ${repo ? `${repo} / ` : ''}Morgan Stanley Technology Apprentice`;
  const project = selectBestPortfolioProjectForQuestion(`${params.jdText || ''} ${params.ossSignal?.techStack || ''} ${repo}`);
  const citedPortfolioUrl = 'https://shivammahajan.com/projects/';
  const opening = params.applicationReceiptVerified ? `I applied for the ${title} role at ${company}.` : `I am interested in the ${title} role at ${company}.`;
  const bodyText = params.recipientRole === 'RECRUITER'
    ? `Hi ${recipient},\n\n${opening}\n\nMy background includes:\n- A Technology Apprenticeship at Morgan Stanley working with Kafka and PySpark on more than 5 million CIAM events.\n- A B.E. in Computer Science from Chitkara University, with a 9.35/10 CGPA.\n- Immediate availability and a Bengaluru location.\n\nMy projects are at ${citedPortfolioUrl}. I would appreciate the chance to discuss the role and how my experience fits your team.\n\nBest,\nShivam` 
    : `Hi ${recipient},\n\n${opening} ${repo ? `I noticed ${repo} and its connection to the work your team shares publicly.` : `The engineering work described for the role caught my attention.`} During my Morgan Stanley Technology Apprenticeship, I worked with Kafka and PySpark on more than 5 million CIAM events. My ${project.title} project is another example of my technical work; the portfolio is at ${citedPortfolioUrl}.\n\nI am based in Bengaluru and available immediately. I would appreciate the chance to discuss how my experience could contribute to your team.\n\nBest,\nShivam`;
  return { subject, bodyText, wordCount: bodyText.trim().split(/\s+/).length, citedPortfolioUrl };
}
