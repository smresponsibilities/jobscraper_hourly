# jobscraper-next

Near-hourly email alerts for fresher / entry-level roles in India and
genuinely-remote, pulled straight from company ATS boards. No database, no
paid services, no proxies.

**Picking this project up in a new session? Read [HANDOFF.md](HANDOFF.md) first** —
it has the decisions and gotchas that aren't obvious from the code alone (the
git-merge workflow you need every time, a regex bug class that's shipped three
times, why the email has a "backlog" section, what's deliberately unfinished).

**Just using it — reading the emails, tuning what you get, adding a company
you care about?** Read [USAGE.md](USAGE.md) instead — no code required.

Verified working against **13,700+ boards**: past dry runs have seen **600,000+
live postings → ~800 open matches** in a single pass. Only up to `BOARDS_PER_RUN`
(8,000) are polled per run — hot boards (ones that have ever shown an India role)
are polled every run without exception; the rest rotate in on a schedule, so the
corpus can keep growing without the run time growing with it.

The board list grows on its own several ways: a weekly Common Crawl sweep walks
the CDX index one block per run, and `npm run bulk-import` pulls from published
tenant lists (crawled by other open-source projects) and keeps only boards that
currently have an India or remote role.

## How it works

```
GitHub Actions (every 20 minutes)
  └─ poll up to 8,000 of 13,700+ ATS boards ─► diff against seen state ──► classify ──► filter
                                                                                       │
                                                                                       │
                                                       new matches? ──► email via Gmail SMTP
                                                                 └────► data/jobs.json ──► web UI
```

Roles are matched by requisition ID, so a posting that disappears from a board
that answered normally is marked `closedAt` rather than deleted. Duplicate
requisitions for the same role are collapsed — Amazon lists one job under three
IDs, but it's still one application.

There is no scraping in the HTML sense. Every source is a public JSON endpoint the
company already publishes to power its own careers page:

| ATS | Endpoint | Notes |
|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs` | Descriptions fetched per-job, only for new roles |
| Lever | `api.lever.co/v0/postings/{token}?mode=json` | Descriptions and salary inline |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{token}` | Always ships full descriptions (~10 MB for large boards) |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{token}/postings` | Returns 200 + `totalFound: 0` for unknown companies, never 404 |
| Workday | `{tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` | POST, paginated, relative dates only. Reports `total` **only on the first page** — later pages say `0` while still returning results, so trusting it per page caps every board at 40 jobs. One tenant can host several career sites (`site`), auto-discovered from `robots.txt`; a multi-location posting's "6 Locations" placeholder is resolved to real place names via a cached per-id detail fetch |
| Oracle HCM | `{tenant}.fa.oraclecloud.com/hcmRestApi/…/recruitingCEJobRequisitions` | Powers JPMorgan and many banks |
| Workable | `apply.workable.com/api/v1/widget/accounts/{token}` | |
| Trakstar | `{token}.hire.trakstar.com/jobfeeds/{token}` | |
| iCIMS (legacy) | `{token}/api/jobs` | `token` is the full board hostname, not a subdomain — iCIMS has no predictable subdomain pattern |
| Zoho Recruit | `{token}` (full board URL) | Same reason as iCIMS — no predictable subdomain |
| Recruitee | `{token}.recruitee.com/api/offers/` | One unpaginated call, full description inline |
| Amazon | `amazon.jobs/en/search.json` | Own search API; queried for India directly |
| Atlassian | `atlassian.com/endpoint/careers/listings` | Custom. Fronts iCIMS but publishes plain JSON with descriptions and compensation |
| Phenom | `POST {careers-host}/widgets` | Undocumented but identical across every deployment — Cisco, HPE, Mastercard, eBay, BCG, Fiserv, GSK, Lilly. The careers hostname *is* the tenant; queried against the India facet directly |
| Eightfold | `{careers-host}/api/pcsx/search?domain=…` | Powers Microsoft. Returns 10 per call and ignores any page-size parameter you pass |
| Darwinbox | `POST {tenant}.darwinbox.in/ms/candidateapi/job/alljobs` | Eight large Indian employers. `companyId` must be in the **body**, not just the query string, or you get a successful-looking empty result. Behind Cloudflare, which fingerprints the TLS handshake — so this adapter shells out to `curl` |
| TurboHire | `POST thapi.azurewebsites.net/api/careerpagev2/filteredjobs` | Flipkart, Purplle, Navi. Needs an anonymous bearer from `/api/token/noauth`, which only issues one when `Origin` and `Referer` are set. `pageType=2` is the live-openings set — `0` returns a 10-row teaser and `1` the full historical corpus |
| Rendered (Playwright) | headless Chromium reads the DOM | **Google, Meta, Uber, Vanguard, DAZN.** They expose no API at all — Google runs an internal batchexecute RPC. Anchored on the job-URL pattern rather than obfuscated class names, so a restyle doesn't break it. Degrades to returning nothing if Playwright is absent |
| SuccessFactors | `{host}/sitemal.xml` (modern) or `{host}/career?…&resultType=XML` (legacy) | SAP, Volvo, ZF, Mahindra, HSBC. A credential-free XML feed the search page itself pulls from |

Plus a set of **India-specific ATS adapters nobody else in this space has**:
Keka, Freshteam, Recruiterflow, GreytHR, PeopleStrong, PyjamaHR, ZappyHire,
Zimyo. Full endpoint shapes for all of these are in
[ADDING-COMPANIES.md](ADDING-COMPANIES.md).

New roles are detected by **requisition ID**, never by date. Workday only exposes
relative dates ("Posted Today") and companies routinely bump timestamps when they
repost, so IDs are the only reliable signal.

## Setup

1. Push this repo to GitHub (public — needed later so the UI can read the data).
2. Turn on 2-Step Verification, if it isn't already: [myaccount.google.com/signinoptions/two-step-verification](https://myaccount.google.com/signinoptions/two-step-verification)
   → **Get started** → verify with your phone. App Passwords only appears
   once this is on.
3. Generate an app password: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   → name it anything (e.g. "jobscraper") → **Create** → copy the
   16-character password shown (spaces don't matter, and it's shown once —
   if you navigate away before copying it, just generate a new one).
4. Repo Settings → Secrets and variables → Actions → **New repository
   secret**, add all three:
   - `GMAIL_USER` — the sending Gmail address
   - `GMAIL_APP_PASSWORD` — the app password from step 3 (**not** your regular Gmail password)
   - `ALERT_TO` — where alerts should land (can be the same address as `GMAIL_USER`)
5. Actions tab → **hunt** → Run workflow, to confirm it works.

### Email stopped sending (Gmail password was reset/changed)

Changing your Google account password revokes every existing App Password —
`GMAIL_APP_PASSWORD` in GitHub goes stale silently, and `hunt`/`discover-news`
start failing on the send-email step. Fix:

1. [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   → generate a new one (needs 2-Step Verification on; the old app password is
   already dead, no need to revoke it manually).
2. Repo → Settings → Secrets and variables → Actions → `GMAIL_APP_PASSWORD` →
   **Update** → paste the new 16-character password (spaces don't matter).
3. Actions tab → **hunt** → Run workflow, confirm the run goes green.

`GMAIL_USER` and `ALERT_TO` don't change in this scenario — only the app
password needs replacing.

The first real run marks everything currently posted as seen and emails nothing.
That's deliberate — otherwise run one would send you every currently-open match
at once, which for a corpus this size is hundreds of roles. To see them once,
run **hunt** manually with the test-email box ticked.

## The web UI

Live at **https://jobscraper-hourly.vercel.app/**.

`web/` is a static Next.js site. It fetches `data/jobs.json` from GitHub at
runtime, so the hourly workflow's commit updates the live site **without a
redeploy** — Vercel only rebuilds when you change the UI code itself.

Deploy your own:

1. Go to [vercel.com/new](https://vercel.com/new) and import the repo.
2. Set **Root Directory** to `web`.
3. Add environment variable `NEXT_PUBLIC_REPO` = `yourname/jobscraper-next`.
4. Deploy.

Without `NEXT_PUBLIC_REPO` the page reads same-origin files instead, so you can
preview locally by copying `data/jobs.json` into `web/public/data/`:

```bash
npm run dev --prefix web
```

The **Add a company** box takes a pasted careers URL, resolves the board, and
counts its open jobs **in your browser** — Greenhouse, Lever, Ashby and
SmartRecruiters all send `Access-Control-Allow-Origin: *`, so no backend is
needed to validate a board before you add it. Workday is parsed but not counted;
it blocks cross-origin reads.

## Tuning

Everything adjustable lives in [`src/config.ts`](src/config.ts): `MAX_YEARS`,
`INCLUDE_INTERNSHIPS`, city list, remote handling, role families, the
IT-services exclusion list, and `EMAIL_FRESHNESS_DAYS`.

### "New" means new to the tracker, not newly posted

A role's requisition ID being unseen and its posting date being recent are
different claims. Add a company, or have a board recover after days of
errors, and its entire current listing looks "new" even if much of it is
months old — 573 of 1,101 dated roles in the catalog were 30+ days old on one
sample day, including a role alerted as "new" that had been open 111 days.

There's no early-mover edge left on a role like that, so **the email only
surfaces postings within `EMAIL_FRESHNESS_DAYS` (21)** of their real posting
date. Nothing is dropped — every match still enters `data/jobs.json`
regardless of age, so the catalogue/UI stays complete; only the alert email is
gated. Roles with no parseable posting date (most Workday boards never expose
one) are always treated as fresh, since absence of a date isn't evidence of
staleness. The manual test-email run (`workflow_dispatch` with the checkbox
ticked) skips this gate entirely — it's a diagnostic meant to show everything
currently matching, not a preview of normal alerts.

Seniority rules are per-industry in [`src/classify.ts`](src/classify.ts), because
title vocabulary is not portable across sectors:

- **"Associate"** — junior at JPMorgan, mid-senior at Stripe
- **"Analyst"** — entry-level in banking and consulting, often mid-level in tech
- **"Engineer II"** — never entry level, in any industry

If JPMorgan's ~60 controller/associate roles are more than you want, narrow
`FINANCE.junior` to `analyst|graduate|trainee|summer` and the associate tier drops out.

## Growing the company list

`companies.json` has grown to 13,700+ boards through several channels: curated
additions, a weekly Common Crawl sweep (`discover.yml`), and bulk imports from
published tenant lists crawled by other open-source projects. Every path keeps
only boards that currently have at least one India or remote role — without
that gate, a harvest adds thousands of companies that can never produce a
single alert. Companies matching `SERVICE_COMPANIES` in `src/config.ts`
(mass-hiring IT-services/BPO firms — TCS, Infosys, Accenture, and the category
they represent) are excluded everywhere a candidate gets kept, by request, not
by accident.

```bash
npm run bulk-import -- --platform workable --bar india    # one ATS's whole tenant list
npm run bulk-import -- --rediscover --bar india            # find a Workday tenant's other career sites
npm run bulk-import -- --file slugs.txt --bar india         # import from a local slug/hostname list
```

This reaches boards `detect`/`probe` structurally cannot — a published tenant
list sidesteps needing a careers-page link or a guessable token. Every
candidate is polled and checked for a real India role before being kept, since
a tenant slug resolving is not evidence of a real company. See
[ADDING-COMPANIES.md](ADDING-COMPANIES.md) for the full flag reference.

**Best method — resolve the careers page.** Put company domains in `domains.txt`:

```bash
npm run detect -- domains.txt
```

It fetches each careers page, extracts the linked ATS board, validates it, and
appends it. Use this in preference to slug guessing, because the token often
isn't the brand name — Razorpay's Greenhouse token is
`razorpaysoftwareprivatelimited`, and PhysicsWallah's Darwinbox tenant is `pwhr`.
It also reports companies running platforms with no adapter yet, so gaps stay visible.

**Slug guessing** still works for the many companies whose token *is* their name.
Put candidates in `candidates.txt` and run:

```bash
npm run probe -- candidates.txt
```

It tries each name against Greenhouse, Lever, Ashby and SmartRecruiters (both
`acmecorp` and `acme-corp` spellings), keeps only boards with at least one
India/remote role, and appends them. Pass `--all` to keep every live board.

This works because those four derive the token from the company name. It cannot
work for Workday or Oracle — those tenants are opaque.

To add one by hand, take it from the careers URL:

| URL | Entry |
|---|---|
| `jobs.lever.co/acme` | `{ "ats": "lever", "token": "acme" }` |
| `boards.greenhouse.io/acme` | `{ "ats": "greenhouse", "token": "acme" }` |
| `jobs.ashbyhq.com/acme` | `{ "ats": "ashby", "token": "acme" }` |
| `acme.wd5.myworkdayjobs.com/en-US/Careers` | `{ "ats": "workday", "token": "acme", "host": "wd5", "site": "Careers" }` |

Workday and Oracle tenants can't be guessed from the company name — JPMorgan is
`jpmc`, not `jpmorgan`. Read them off the URL or let Common Crawl find them.

Boards that fail continuously for three days are dropped automatically; tokens rot
when companies rename or migrate ATS.

## State without a database

Seen IDs, per-board poll times/failure streaks, and a few other rolling
caches all live in the **Actions cache** between runs and are never
committed — git stores a full copy per commit, not a delta, so committing any
of this every 20 minutes would add gigabytes of history a year for data
that's fully regenerable. If the cache is ever evicted, a run degrades
gracefully (re-seeds `seen` from the committed catalogue and stays silent one
cycle; treats every board as never-polled, which the rotation logic already
sorts first) rather than breaking. `companies.json` still gets committed
normally, but now only when a board is actually added, dropped, or first
goes hot — not on every poll — which is also what keeps the repo active
enough that GitHub doesn't auto-disable the schedule after 60 days. Full
detail in [ARCHITECTURE.md](ARCHITECTURE.md).

## Local use

```bash
npm install
npm run dry         # poll everything, classify, write out/matches.json, persist nothing
npm run preview     # render the last dry run to out/preview.html
npm run hunt        # the real thing
npm run probe -- candidates.txt   # bulk-test candidate board slugs
npm run discover    # Common Crawl harvest
npm run bulk-import -- --bar india   # import from published tenant lists
```

Descriptions are fetched **after** title/location screening, not before.
Skipping that ordering would be dramatically slower for no extra matches,
since it would enrich every previously-unseen posting instead of only the
small fraction that survives location/role/seniority screening on title and
location alone — typically well under 10% of what a full run sees.

## Known limits

- **Salary is almost always absent.** The field is wired up for Lever and Ashby,
  but most boards don't opt into publishing it.
- **Workday's unfiltered sweep is capped** at ~300 newest roles per board
  (results are newest-first, so nothing recent is missed); the India-specific
  search goes to 1,500. A posting's back catalogue beyond that isn't enumerated.
- **Classification is regex, not an LLM.** Expect roughly 85% accuracy. Every
  mistake is one line in `classify.ts`.
- **Many careers pages render client-side**, so `detect` finds no link in the
  raw HTML — Zomato, Swiggy, Flipkart, Dream11, Zerodha and others. Their public
  job pages do publish `schema.org/JobPosting` JSON-LD for Google for Jobs, which
  is the most promising route in without per-company reverse engineering.
- **A published tenant-list crawl is not evidence of a real company** — a
  plausible-looking slug can resolve to an unrelated org that happens to share
  a name (a staffing agency, a school district, a sandbox tenant). Every
  `bulk-import` candidate is polled and its real job titles checked, not just
  its HTTP status, before being kept.
