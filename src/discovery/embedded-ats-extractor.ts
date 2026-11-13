import { extractAtsLinksFromHtml } from './ats-board-resolver.js';

export function extractEmbeddedAtsSlugsFromHtml(html: string, _sourceUrl?: string): Array<{
  provider: 'greenhouse' | 'ashby' | 'lever' | 'workable' | 'recruitee' | 'breezy' | 'smartrecruiters' | 'workday';
  slug: string;
  directBoardUrl: string;
}> {
  if (typeof html !== 'string' || !html) return [];
  return extractAtsLinksFromHtml(html).map(({ ats, boardSlug, boardUrl }) => ({
    provider: ats, slug: boardSlug, directBoardUrl: boardUrl,
  }));
}
