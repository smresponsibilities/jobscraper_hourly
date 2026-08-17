/**
 * Pure headline-parsing logic for discover-news.ts, split into its own module
 * so selftest.ts can import it without triggering discover-news.ts's `main()`
 * (same reasoning as the probe.ts/board-probe.ts split: importing a script
 * that runs `main()` at module scope would execute the CLI as a side effect).
 */

/** A round was raised, or money changed hands. */
export const FUNDING =
  /\b(raises?|raised|raising|bags?|bagged|secures?|secured|nets?|netted|funding|fundraise|seed round|pre[- ]seed|series\s+[a-j]\b|valuation|invests?\s+(?:(?!\bin\b)\S+\s+){0,3}in\b|backed)\b/i;

/** A company is standing up an India presence. */
export const INDIA_EXPANSION =
  /\b(gcc|global capability cent(?:re|er)|global capacity cent(?:re|er)|india cent(?:re|er)|development cent(?:re|er)|expands? (?:in)?to india|enters india|sets? up .{0,30}\bindia\b|opens? .{0,30}\bindia\b|india (?:office|expansion|operations|hiring|team)|hiring in india)\b/i;

/**
 * Words that start a headline but are never the company. Without this the
 * probe wastes most of its budget on "Exclusive", "Report", weekday names and
 * the like — all of which are legitimately capitalised at the front of a
 * headline.
 *
 * Also covers two noise sources found by auditing live feed output: (1) the
 * FUNDING trigger verbs themselves ("Backed", "Nets", "Raised") get
 * capitalised in title-case headlines and leak through as their own fake
 * candidate; (2) common function words ("And", "To", "For") do the same in
 * fully title-cased headlines (YourStory's roundup-style titles in
 * particular), producing garbage multi-word slices like "Yulu To" or
 * "Investors And".
 */
export const STOPWORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'his', 'her', 'their',
  'exclusive', 'report', 'breaking', 'update', 'opinion', 'analysis', 'interview', 'watch',
  'how', 'why', 'what', 'when', 'where', 'who', 'can', 'will', 'is', 'are', 'was', 'were',
  'new', 'top', 'best', 'first', 'last', 'next', 'more', 'most', 'after', 'before', 'from',
  'india', 'indian', 'indias', 'us', 'usa', 'uk', 'china', 'europe', 'asia', 'global',
  'startup', 'startups', 'unicorn', 'fintech', 'edtech', 'ipo', 'sebi', 'rbi', 'gst',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'ai', 'saas', 'b2b', 'd2c', 'ev', 'evs', 'crypto', 'web3', 'funding', 'revenue', 'profit',
  'loss', 'yoy', 'cr', 'mn', 'bn',
  // Funding-verb leakage in title-case headlines.
  'series', 'backed', 'nets', 'netted', 'raised', 'raises', 'raising',
  // Generic lead-in nouns that precede the real name ("D2C Brand Scrubsy").
  'brand', 'week', 'weekly', 'tracker',
  // Function words, only ever capitalised by a title-case headline.
  'and', 'or', 'to', 'for', 'with', 'by', 'in', 'at', 'of', 'on', 'as', 'into', 'over', 'via', 'per', 'than',
]);

/**
 * Investors, not employers. Funding headlines name the VC at least as often as
 * the company ("X raises $40 Mn led by Accel"), and on the first live run the
 * only boards this found were Lightspeed's and a "Stealth" placeholder — i.e.
 * the extractor was reliably picking the wrong half of the sentence.
 */
export const INVESTORS = new Set([
  'accel', 'sequoia', 'peak xv', 'blume', 'elevation', 'tiger global', 'softbank',
  'lightspeed', 'nexus', 'matrix', 'kalaari', 'chiratae', 'stellaris', 'bessemer',
  'general catalyst', 'insight partners', 'y combinator', 'antler', 'titan capital',
  'info edge', 'fireside', 'westbridge', 'avataar', 'iron pillar', 'trifecta',
  'alteria', 'beenext', 'jungle ventures', 'vertex', 'temasek', 'khosla',
  'andreessen', 'a16z', 'lightbox', 'omidyar', 'prosus', 'naspers', 'stealth', 'kkr',
]);

/** Investor houses share these suffixes; hiring companies rarely do. */
export const INVESTOR_SUFFIX = /\b(ventures?|capital|partners|fund|funds|holdings|\bvc\b|advisors)$/i;

/** Fiscal-year and quarter/half tokens ("FY27", "Q1", "H2") — dated by nature, so matched by shape rather than a literal list that goes stale every year. */
function isDatedToken(word: string): boolean {
  return /^fy\d{2}$/i.test(word) || /^q[1-4]$/i.test(word) || /^h[12]$/i.test(word);
}

function isStopword(word: string): boolean {
  return STOPWORDS.has(word.toLowerCase()) || isDatedToken(word);
}

export function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&#39;|&rsquo;/g, "'")
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .trim();
}

export function headlines(xml: string): string[] {
  return (xml.match(/<title>[\s\S]*?<\/title>/g) ?? [])
    .map((t) => decode(t.replace(/<\/?title>/g, '')))
    .filter((t) => t.length > 15 && t.length < 200);
}

/**
 * Pulls capitalised phrases that could be a company name. Headlines write them
 * as "Zypp Electric", "NewTap Finance", "Zetwerk" — so 1-3 capitalised tokens,
 * with possessives and leading qualifiers stripped.
 */
export function extractNames(headline: string): string[] {
  const cleaned = headline.replace(/[’']s\b/g, '').replace(/[“”"‘’]/g, '');
  const names: string[] = [];

  for (const m of cleaned.matchAll(/\b([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,2})\b/g)) {
    const phrase = m[1]!.trim();
    const words = phrase.split(/\s+/);
    // Trim trailing stopwords ("Zetwerk Revenue" -> "Zetwerk").
    while (words.length && isStopword(words[words.length - 1]!)) words.pop();
    while (words.length && isStopword(words[0]!)) words.shift();
    if (words.length === 0) continue;
    const name = words.join(' ');
    if (name.length < 3 || name.length > 40) continue;
    if (words.every((w) => w.length <= 2)) continue;
    if (INVESTORS.has(name.toLowerCase()) || INVESTOR_SUFFIX.test(name)) continue;
    names.push(name);
  }
  return [...new Set(names)];
}
