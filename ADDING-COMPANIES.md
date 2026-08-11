# Adding companies

## The short version

Open the company's careers page, **click through to their actual job listings**,
and copy the URL from the address bar. That URL is all I need.

The one thing that matters: the careers page on the company's own domain is
usually a marketing page. Keep clicking ("View all jobs", "Search openings",
"See openings") until the address bar changes to a *different domain* or a
`/careers/jobs`-style path that lists real roles. **That** is the URL to send.

```
❌ https://www.razorpay.com/careers/          marketing page, useless
✅ https://job-boards.greenhouse.io/razorpaysoftwareprivatelimited
```

Guessing never works reliably — Razorpay's board token is
`razorpaysoftwareprivatelimited` (their registered entity) and PhysicsWallah's
Darwinbox tenant is `pwhr`. Neither is derivable from the brand name.

## Exactly what URL is wanted, per platform

If you can tell which platform it is, here's the shape. If you can't, just send
the URL — identifying it is my job.

| Platform | URL that works | What gets extracted |
|---|---|---|
| **Greenhouse** | `job-boards.greenhouse.io/`**`acme`** or `boards.greenhouse.io/`**`acme`** | token |
| **Lever** | `jobs.lever.co/`**`acme`** | token |
| **Ashby** | `jobs.ashbyhq.com/`**`acme`** | token |
| **SmartRecruiters** | `jobs.smartrecruiters.com/`**`Acme`** | token (case-sensitive) |
| **Workday** | **`acme`**`.`**`wd5`**`.myworkdayjobs.com/en-US/`**`Acme_Careers`** | tenant + pod + site — **all three**, so send the whole URL |
| **Oracle** | **`acme`**`.fa.`**`us2`**`.oraclecloud.com/hcmUI/CandidateExperience/en/sites/`**`CX_1001`** | tenant + pod + site number |
| **Phenom** | just the hostname: **`careers.acme.com`** | the hostname *is* the tenant |
| **Eightfold** | **`apply.careers.acme.com`** + the `domain=` value in its network calls | host + domain |
| **Darwinbox** | **`acme`**`.darwinbox.in/ms/candidatev2/`**`a62d7a6e288992`**`/careers` | tenant + companyId. Older tenants use `/ms/candidate/careers` with no hash — then the tenant alone is enough |
| **TurboHire** | **`acme`**`.turbohire.co/careerpage/`**`4d757ba0-3d57-448a-b82c-238ed87ac90f`** | subdomain + org GUID |

Workday and Oracle are the ones people truncate. `acme.wd5.myworkdayjobs.com`
alone is not enough — without the site path (`Acme_Careers`) there's nothing to
query.

## If clicking through doesn't leave the page

Some careers pages load jobs by background request and never change the URL
(Zomato, Swiggy, Flipkart, Dream11 are all like this). Then:

1. Press **F12** → **Network** tab
2. Click **Fetch/XHR**
3. Reload the page
4. Look for a request returning JSON with job titles in it
5. Right-click it → **Copy** → **Copy link address**

Send me that. It's exactly how Microsoft and Cisco got added.

## Where it goes

`companies.json`, at the repo root. One object per board:

```json
{
  "name": "Razorpay",
  "ats": "greenhouse",
  "token": "razorpaysoftwareprivatelimited",
  "industry": "fintech",
  "source": "curated"
}
```

Workday needs two extra fields:

```json
{
  "name": "Capital One",
  "ats": "workday",
  "token": "capitalone",
  "host": "wd12",
  "site": "Capital_One",
  "industry": "banking",
  "source": "curated"
}
```

Oracle needs the pod and site number:

```json
{
  "name": "Oracle",
  "ats": "oracle",
  "token": "eeho",
  "host": "fa.us2",
  "siteNumber": "CX_45001",
  "industry": "tech",
  "source": "curated"
}
```

Phenom takes the hostname as the token:

```json
{
  "name": "Cisco",
  "ats": "phenom",
  "token": "careers.cisco.com",
  "industry": "tech",
  "source": "curated"
}
```

### `industry` is not cosmetic

It selects which seniority vocabulary applies. Tag it wrong and the filter
misreads the whole company — "Associate" is junior at a bank and mid-senior at a
tech firm.

| Value | Use for |
|---|---|
| `tech` | product and software companies, GCCs, SaaS |
| `fintech` | payments, lending, brokerages — uses the tech vocabulary |
| `banking` | investment banks, insurers, asset managers |
| `consulting` | MBB, Big Four |
| `quant` | trading firms and hedge funds |

## Check it worked

```bash
npm run debug -- "Capital One"
```

Prints every role the board returns, whether it passed, and the exact reason it
didn't — `5y minimum`, `seniority`, `role family`, `location`.

## Doing it in bulk

```bash
npm run detect -- domains.txt
```

Resolves careers pages to boards automatically. Put one domain per line
(`razorpay.com,fintech`). **Use this first** — it handles the token-isn't-the-brand-name
problem for you, and reports any company running a platform with no adapter yet.

```bash
npm run probe -- candidates.txt
```

Guesses board tokens from company names across Greenhouse, Lever, Ashby and
SmartRecruiters. Works for the many companies whose token *is* their name, and
tries both `acmecorp` and `acme-corp`. Only keeps boards that currently have an
India or remote role.

```bash
npm run discover
```

Common Crawl sweep. Runs weekly on its own; you shouldn't need to trigger it.

---

# What's still missing

~5 companies sit behind three walls. Each needs a different fix, and none yields
to the techniques that got the other 317 boards.

## 1. ~~Google and Meta~~ — SOLVED, Uber and Walmart still open

**Google (100 postings) and Meta (10)** now run through a Playwright adapter that
reads the rendered DOM. They expose no API — Google runs `boq-hiring`, an internal
batchexecute RPC.

The design decision worth keeping: it anchors on the **job-URL pattern**, not CSS
classes. Google's class names are obfuscated and rotate (`div.sMn82b`), so a
selector-based scraper would break within weeks; `/jobs/results/{id}` does not.
Meta needed a second fix — it renders every card inside one shared container, so
the title has to come from the anchor's own text and be split from the location
it's glued to.

To add another rendered site, find its link shape first:

```bash
npx tsx src/render-probe.ts "https://careers.example.com/jobs?location=India"
```

then add an entry to `SITES` in `src/fetchers/rendered.ts`.

**Uber** is in too (400 postings). Its list lives at `jobs.uber.com/en/jobs`, not
the `uber.com/careers` URL the site links to, and its own location filter values
return zero results for every format tried — so it pulls unfiltered and lets the
India filter decide. That needed one more option: Uber's anchor holds *only* the
title, with the location four levels up the DOM, hence `cardUp`.

Watch for that trap when adding a site: if a listing isn't India-filtered by URL,
leave `indiaOnly` false. Setting it true made 399 of Uber's 400 global roles
inherit "India" and sail straight through the filter.

**Walmart is still open**, and it is not a selector problem — under headless
Chromium its results page renders no job links, no card containers and no result
count at all. That signature means bot detection, which a stealth plugin might
beat but nothing in this codebase will.

## 2. ~~Darwinbox~~ — SOLVED

**PhysicsWallah · Porter · LeadSquared · Tata 1mg · Licious · PharmEasy ·
Unacademy · Subex** are all polling now.

The documented API needs a key from Darwinbox's integration team, but the public
careers widget calls an unauthenticated endpoint:
`POST {tenant}.darwinbox.in/ms/candidateapi/job/alljobs`.

Two traps cost real time to find, both recorded in `src/fetchers/darwinbox.ts`:
`companyId` must be in the POST **body** (query string alone returns a
successful-looking empty result), and Cloudflare fingerprints the TLS handshake,
so Node's fetch is 403'd regardless of headers while `curl` passes.

Still missing on this platform: **upGrad** (tenant unresponsive) and **CleverTap**
(tenant resolves but reports zero open jobs).

Note: subdomain probing is useless here — `*.darwinbox.in` is a wildcard, so
`zzqqxxnotreal9999.darwinbox.in` responds exactly like a real tenant.

## 3. ~~TurboHire~~ — SOLVED

**Flipkart (61) · Purplle (55) · Navi (45)** are all polling now.

`POST thapi.azurewebsites.net/api/careerpagev2/filteredjobs?orgId={GUID}&pageType=2`,
with an anonymous bearer from `/api/token/noauth` — which only issues a token when
the request carries `Origin` and `Referer` for the tenant's careers domain.

The trap worth recording: **`pageType` selects the result set and the default is
wrong.** `0` returns a fixed 10-row teaser, `1` returns 6,862 rows (the full
historical corpus), and `2` returns the genuinely-open roles. Every pagination
parameter is ignored.

## 4. iCIMS — HTML only

**DocuSign** (and it fronts Atlassian, though they publish JSON separately)

Serves HTML with no JSON or RSS feed. DocuSign's APJ portal is
`apjcareers-docusign.icims.com`, so India roles exist — reading them needs an
HTML parser, which is a real adapter rather than a quick add.

## 5. Newly announced GCCs — two solved, three genuinely empty

The first sweep for these used `curl` on static HTML and found nothing. Re-probing
with headless Chromium — which sees content that only exists after JS runs —
turned up two of the five:

- **Vanguard** ✅ — `vanguardjobs.com/job-search-results/?country=India`, 458 jobs,
  with the city encoded in the URL slug (`…-hyderabad-in/`). That prompted a
  general improvement: location is now matched against the href as well as the
  card text, since slugs routinely carry a city the rendered card omits.
- **DAZN** ✅ — `careers.dazn.com/en`, 123 postings on its own platform (the
  `/postings/{uuid}` shape looks like Lever or Ashby but is neither; both APIs
  return zero for every token spelling).

**McDonald's, T-Mobile and Best Buy render no job links at all**, even headless.
T-Mobile reports 2,087 jobs on the page yet exposes no per-job link shape; Best
Buy times out. All three are US-centric sites whose India centres were announced
but are not yet posting requisitions — there is nothing to read until they do.

Both Vanguard and DAZN currently return **0 matches**, which is the correct
answer, not a broken adapter: their live India roles are senior, and their new
centres haven't opened entry-level requisitions. Both are polled hourly, so the
first fresher role either posts will reach you within the hour.

---

## Fastest way to help

For any company you actually care about from the lists above:

1. Open their careers page
2. F12 → **Network** → **Fetch/XHR** → reload
3. Find the JSON response containing job titles
4. Copy the link address and send it to me

That single step is what turned Cisco into 247 India jobs and Microsoft into 160.
