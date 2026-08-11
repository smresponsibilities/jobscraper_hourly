/**
 * Every tunable lives here. Start wide, tighten after a week of real output —
 * it is much easier to notice noise than to notice a job you never saw.
 */

/** Keep roles at or below this many years. Postings with no stated years are kept. */
export const MAX_YEARS = 3;

/** Full-time and internships both count. */
export const INCLUDE_INTERNSHIPS = true;

/**
 * Drop a board after it has been failing continuously for this long. Time-based
 * rather than a failure count, so a bad afternoon doesn't evict a good company.
 */
export const DROP_AFTER_FAILING_DAYS = 3;

/** Forget a job ID after this long, so the state file stays small. */
export const SEEN_RETENTION_DAYS = 45;

/** Render this many roles as full cards; the rest become compact one-liners. */
export const EMAIL_DETAIL_LIMIT = 25;

/**
 * Concurrent board fetches. Politeness, not a technical limit — but with 500+
 * boards the run was approaching ten minutes at 6, so this is the balance.
 */
export const CONCURRENCY = 9;

export const INDIA = new RegExp(
  [
    'india',
    'bengaluru',
    'bangalore',
    'hyderabad',
    'mumbai',
    'pune',
    'chennai',
    'new delhi',
    'delhi',
    'gurgaon',
    'gurugram',
    'noida',
    'kolkata',
    'ahmedabad',
    'jaipur',
    'indore',
    'kochi',
    'trivandrum',
    'thiruvananthapuram',
    'coimbatore',
    'chandigarh',
    'bhubaneswar',
    'nagpur',
    'vadodara',
    'mysuru',
    'mysore',
    'visakhapatnam',
    'goa',
  ].join('|'),
  'i',
);

export const REMOTE = /\b(remote|work from home|wfh|anywhere|distributed)\b/i;

/**
 * "Remote - US" is not remote for someone applying from India. If a posting
 * names a specific non-India region, we drop it unless India is named too.
 */
export const REGION_LOCKED =
  /\b(united states|u\.?s\.?a?\b|usa|canada|united kingdom|\buk\b|emea|latam|apac only|europe|germany|france|netherlands|poland|brazil|mexico|australia|singapore|japan|china)\b/i;

/** Mass-hiring IT services firms — excluded by request. */
export const SERVICE_COMPANIES =
  /\b(tcs|tata consultancy|infosys|wipro|cognizant|accenture|capgemini|hcl|hcltech|tech mahindra|ltimindtree|mphasis|hexaware|birlasoft|coforge|persistent systems|zensar|mindtree|dxc|atos|virtusa|ust global|quess|randstad|adecco)\b/i;

/** A role only alerts if its title matches one of these families. */
export const ROLE_FAMILIES: Record<string, RegExp> = {
  swe: /\b(software|engineer|developer|sde|swe|programmer|full[- ]?stack|backend|back[- ]end|frontend|front[- ]end|mobile|android|ios|platform|infrastructure|devops|sre|reliability|qa|test|security engineer|systems)\b/i,
  data: /\b(data|machine learning|\bml\b|\bai\b|analytics|scientist|research|nlp|computer vision|deep learning|quantitative|quant)\b/i,
  finance: /\b(analyst|associate|consultant|investment|risk|trading|trader|actuar|audit|finance|banking|strategy|operations analyst)\b/i,
};
