# Contact discovery — consolidated research

Single reference for every method this project knows about for finding a real
person's email at a target company. Consolidates the contact-finding research
from `COLDMAIL-PLAN.md` §1/§4 (measured 2026-08-21/22), the sources built since
then, and fresh live probes from 2026-08-26. Sending-side decisions live in
`COLDMAIL-PLAN.md` and `OUTREACH-DESIGN.md`; this file is only about *finding
the address*.

Status vocabulary: **built** (code shipped, wired into `npm run outreach`),
**CLI** (usable via `npm run contact-find`, not yet auto-wired), **probed**
(live-tested by hand, not built), **assessed** (researched, deliberately not
built).

---

## The ladder, current state

In priority order, stopping when an address is found. Sources 1–2 are built;
each later rung covers companies the earlier ones miss.

### 1. Public git commit metadata — built

A company's own public repos carry engineer work-addresses in commit author
fields; free, no LinkedIn, and returns the *real* mail domain rather than a
guess (`swiggy.in`, `juspay.in`, `cred.club` all defeat name-guessing).

- **Code:** `githubContacts()` in `src/contacts.ts`; sweep across all tracked
  companies via `npm run contacts-sweep` (cached in gitignored
  `state/contact-sweep.json`).
- **Measured hit rate:** 12.6% across all 12,988 companies (1,637 usable,
  8,722 addresses) — lower than the ~80% product-company figure because most
  *tracked* companies are not GitHub-heavy product firms.
- **The load-bearing guard:** `domainMatchesOrg()` rejects domains that don't
  plausibly belong to the company (outside contributors out-committing
  employees report wrong-company domains with total confidence). Loosening it
  buys hit rate and pays in bounces; bounces damage the sending domain for
  everyone.
- Also exports pattern inference: the eight standard corporate shapes
  (`first.last`, `firstlast`, …) inferred from name/address pairs, so one
  confirmed address yields every colleague's.
- **Transport switched from REST to GraphQL (2026-09-02)**, same data, same
  guards, no yield change — this is an efficiency fix, not a new source. The
  REST path cost `1 + repoLimit` calls per company (list repos, then commits
  per repo) against the 5000/hr token budget; GraphQL batches the same shape
  into one query. Live-measured: `organization(repoLimit: 3, commitLimit:
  100)` against a real org came back `cost: 1`. Only matters once call volume
  is high enough to approach the ceiling — `outreach.yml` moving from once a
  day to hourly is exactly that shift, so this shipped alongside it rather
  than waiting for a rate-limit incident to force it.
- **The full sweep (`state/contact-sweep.json`) is gitignored — deliberately,
  it's 1.6MB and rewritten wholesale — which meant every hosted run on a
  GitHub Actions runner started with zero of it**, re-guessing every company's
  org from an ATS token instead of using the 3,238 already-resolved orgs this
  sweep found locally. Found 2026-09-01 from a live run's logs, where
  companies the sweep had already matched were still logging "no GitHub org."
  Fixed with a second, committed file: `state/contact-sweep-index.json`
  (233KB — org/domain/matched only, no addresses, so it's safe in this public
  repo unlike the full sweep). `loadSweepLower()` in `outreach.ts` prefers the
  full local sweep and falls back to this index when the full file is absent
  (i.e. every hosted run). Regenerate it after any local `contacts-sweep` run
  via the sweep's own `save()` — no separate command needed, it writes both
  files together.

### 2. npm registry maintainers — built (2026-08-26)

Package manifests publish maintainer and author emails — corporate addresses
for the same reason commits are. Covers companies whose GitHub org is named
nothing like the company, or who ship packages without a public org.

- **Code:** `npmContacts()` in `src/contact-sources.ts`; wired into
  `resolveRecipients()` in `src/outreach.ts`'s `alternates()` as the fallback
  when git finds no corporate-domain commits *or* the commits it found belong
  to outside contributors. That second case used to `return []` outright
  instead of falling through — fixed 2026-09-02 after a live run showed Citi,
  Sprinklr, Logitech, LSEG and Unisys all dying there while their npm/PyPI
  packages went unqueried. Same `domainMatchesOrg` guard applies regardless.
- **Live test (2026-08-26):** "Razorpay" → 5 real addresses on the first run,
  including `vivek.shindhe@razorpay.com` — independently re-confirming the
  `first.last` pattern the 2026-08-22 hand probe found.
- Uses `/latest` manifests, not full package documents (some packages are
  megabytes across all versions).

### 2b. PyPI author emails — built (2026-08-26)

Same trick as npm against Python package manifests.
`GET https://pypi.org/pypi/{pkg}/json` returns `info.author_email` /
`maintainer_email` (often `Name <addr>` formatted — parsed out).

PyPI has no JSON search API and its search page bot-walls plain fetches, so
the source probes exact name candidates (slug plus `-sdk`/`sdk`/`-python`/`py`
variants) instead of searching. Coverage is narrower than npm's search but the
hits are real corporate addresses; freemail and wrong-domain results are
dropped by the same guards (`paytm` on PyPI belongs to an unrelated developer
and must never ship). Companies whose package is named nothing like them
(Zerodha ships `kiteconnect`) stay uncovered here.

- **Code:** `pypiContacts()` in `src/contact-sources.ts`; second fallback in
  `resolveRecipients()` after npm. Also surfaced by the CLI.
- **Live test (2026-08-26):** "Snowflake" →
  `snowflake-python-libraries-dl@snowflake.com` via `snowflake`; re-confirms
  the 2026-08-22 measurement. "Razorpay"/"Zerodha" → nothing corporate
  (expected: Razorpay's PyPI entry has no email, Zerodha's package is named
  `kiteconnect`).

### 2c. Maven Central developer emails — built (2026-09-02)

Third registry-metadata source, third fallback after npm/PyPI, and a
different mechanism than either: Maven Central's search API returns no
author/email fields at all, so the address comes from the artifact's own POM
file, which corporate Java/Android SDKs commonly publish a `<developers>`
block into.

- **Code:** `mavenContacts()` in `src/contact-sources.ts`; third fallback in
  `outreach.ts`'s `alternates()`, after npm and PyPI both come up empty.
  `groupId` is guessed under the reverse-domain prefixes real corporate
  packages use (`com.`, `io.`, `org.`, `in.` + slug) and searched via Maven
  Central's Solr API; the first few matching artifacts' POMs are fetched and
  scanned for a `<developers><developer><email>` block, paired per-developer
  so a multi-author POM can't cross-wire a name to the wrong email. Same
  `domainMatchesOrg`/`isCorporateAddress` guards as everywhere else.
- **Live test (2026-09-02):** "Razorpay" → `developers@razorpay.com` via
  `com.razorpay:standard-core`'s POM, matching what a manual fetch of
  `com.razorpay:razorpay-java`'s POM showed independently.
- **crates.io and RubyGems checked for the same trick and rejected — both are
  real dead ends, not just narrow.** crates.io's public API never exposes an
  email anywhere; `/api/v1/crates/{name}/owners` returns only a linked GitHub
  username. RubyGems' `email` field came back `null` on every real gem probed
  (`stripe`, `twilio`, `sendgrid-ruby`, `razorpay`, `rails`) — the field
  exists in the API shape but the registry doesn't populate it from gemspecs
  anymore. Both confirmed live, not from documentation, before writing any
  code against them.

### 2d. SmartRecruiters requisition creators — built (2026-09-02)

Every SmartRecruiters posting publicly names the person who created the
requisition (`creator.name`) — a real, individual name, no auth, on the same
list call the fetcher already makes for job data itself. Unlike every other
source above, this is a **name, never an address** — SmartRecruiters has
nothing resembling an email field anywhere in its public API — so it is only
usable once a domain and pattern are already known from source 1 (git).

- **Code:** `smartRecruitersCreators()` in `src/contact-sources.ts`. Wired
  into `resolveRecipients()` in two places: (a) job-specific — the fetcher
  (`src/fetchers/smartrecruiters.ts`) now captures `creator.name` as
  `postedBy` on the job itself (free, same response, no extra call), threaded
  through `RawJob`/`CatalogEntry` unconditionally (a few bytes, unlike
  `text`), and used first — "you posted this exact role" beats any git
  commit as a fact; (b) company-wide fallback — a full `smartRecruitersCreators()`
  sweep of the company's open postings when the specific job's creator wasn't
  captured. Both apply `applyPattern()` (the same tested function git-derived
  names use) against the domain/pattern git already resolved. `buildFirstDraft()`
  renders a source-aware fact line so the mail never claims a commit that
  doesn't exist.
- **Live test (2026-09-02):** Werner & Mertz GmbH's SmartRecruiters board →
  5 distinct real names across 5 postings (e.g. "Carolin Reichert"), each
  tied to its own requisition.

### 3. Role addresses — built as candidates, verification pending

`careers@ / jobs@ / hiring@ / talent@ / hr@ / recruit@` at a known domain.
No name needed, so it floors the ~20%+ of companies with no public engineers
anywhere. Low expected reply rate, but zero risk if verified first.

- **Code:** `roleAddresses()` in `src/contact-sources.ts`; surfaced by the CLI.
- **Not draft-composable yet:** `buildFirstDraft()` needs a person (greeting +
  opening fact). Would need its own template lane in `outreach.ts`.
- Must go through `verifyEmail()` before anything ships — never send blind.

### 4. Company website surfaces — built as scanner

mailto: links and plaintext addresses on the company's own pages.

- **Code:** `websiteContacts()` + `extractEmails()` in
  `src/contact-sources.ts`; scans homepage plus `/contact`, `/about`,
  `/careers`, `/team`. Only addresses on the site's own root domain (or
  matching the company name) survive — third-party addresses on those pages
  belong to recruiters, agencies and chat-widget vendors.
- **Live test (2026-08-26):** razorpay.com published nothing scannable.
  Uneven by design; mostly useful for confirming domain + pattern rather than
  finding a person.

### 5. DMARC rua records — built (2026-08-26)

`_dmarc.{domain}` TXT carries `rua=mailto:` aggregate-report addresses. Nobody
reads those mailboxes — useless as targets, but their *existence* proves the
domain has live, managed mail infrastructure before any probe or send.

- **Code:** `dmarcRua()` + `parseDmarcRua()` in `src/contact-sources.ts`; runs
  as a pre-flight warning in `outreach.ts`'s `finalize()` before SMTP probing
  (one cached DNS query per company domain) and prints status in the CLI.
- **Live test (2026-08-26):** meesho.com → `managed (rua dmarcreports@meesho.com)`;
  razorpay.com → `not published — verify extra carefully`. Both paths shown.

### 6. Gravatar existence check — built

MD5 the lowercase address, request `gravatar.com/avatar/{md5}?d=404`; 200
means that exact address is registered — near-proof a human owns it.
Positive-only (404 proves nothing). Free tie-breaker for catch-all/gateway
verdicts where SMTP can't decide.

- **Code:** `gravatarExists()` in `src/outreach.ts`, already on the
  verification path for `unknown` verdicts.

### 7. ApplyBolt public endpoint — built as adapter (2026-08-26, off by default)

`POST https://api.applybolt.app/public/findEmailByLinkedIn` with
`{"linkedinUrl": ...}` does the LinkedIn-scraping step nobody can safely do
at scale themselves, and returns `{found, email, validation, fullName,
jobTitle, company}` unauthenticated and free.

- **Code:** `applyboltLookup()` + `parseApplyBolt()` in
  `src/contact-sources.ts`. `APPLYBOLT_ENABLED=1` to turn on; one retry then a
  30-minute cool-down on hard failures so a dead endpoint can't burn timeouts.
  Single-profile CLI mode: `npm run contact-find -- https://linkedin.com/in/...`
- **Live test (2026-08-26):** satyanadella profile →
  `satya@uchicago.edu (Satya Nadella, Member Board Of Trustees)` with the flag
  set; returns nothing without it.
- **Remaining gap:** the endpoint takes a LinkedIn *URL*; finding the right
  profile URL per company is its own unbuilt problem (name+company SERP lookup
  or `linkedin.com/in/{guess}` heuristics). Until that exists the adapter is a
  manual tool, not part of `resolveRecipients()`.
- Input is a LinkedIn URL — finding the right profile is a separate problem
  (see §9).

### 8. Commercial APIs — assessed, key-gated, not built

Both checked 2026-08-26; both reject unauthenticated calls, so free-tier
evaluation needs an account first.

| Service | Free tier | Notes |
| --- | --- | --- |
| Hunter.io | 25 searches + 50 verifications/month, recurring, no card | Best recurring free tier; clean REST API |
| Apollo.io | ~10,000 credits/month fair-use, 270M-contact DB | CSV export capped at 10 rows; whether the API bypasses that cap is the thing to verify before planning around it |
| Snov.io | 50 credits one-off | Not recurring; skip |

Apollo's database is far larger than this project needs; the export/API cap
question is the only blocker to taking it seriously.

### 9. LinkedIn directly — last resort, unchanged

Still among the most aggressively anti-scraped sites on the web. If ever
needed: search-engine SERP snippets (name + title as they appear in results),
never fetching linkedin.com. With ApplyBolt live again, this recedes further.

---

## Assessed and rejected

- **security.txt** — Cloudflare/Stripe/GitHub all point at HackerOne URLs,
  not addresses. Checked twice now (2026-08-22, spot-rechecked 08-26); stays
  rejected.
- **Greenhouse board metadata** — re-checked 2026-08-26 against a live board
  (`optiverus`, 50-job sample): metadata fields are only Workflow /
  Website Level Mapping / Requisition Type / Leadership Owner, the last typed
  as a user id but null throughout. Still thin; still not worth a sweep.
- **Oracle Cloud HCM's `ExternalContactName`/`ExternalContactEmail`/`HiringManager`
  fields — same shape of finding as Greenhouse above, checked 2026-09-02.**
  Only visible on the per-requisition *detail* endpoint
  (`recruitingCEJobRequisitionDetails`), not the list one — a real schema, and
  `ExternalContactEmail` would be a genuine address field, better than
  SmartRecruiters' name-only leak. Checked 9 real requisitions across 4
  different tenants (Wesco, Hillside, Hilton Grand Vacations, Hologic
  Careers): every field came back `null` on every one. Present in the
  schema, unpopulated in practice — not worth building on with this
  evidence. Oracle covers 515 tracked companies, so if this ever becomes a
  priority, a wider sample (20-30 tenants) is the next step before writing
  it off completely, not more code against 4 data points.
- **Eightfold, Workable, Darwinbox — audited 2026-09-02, no contact-shaped
  fields found.** Eightfold's position object (checked against Microsoft's
  board) carries nothing person-shaped. Workable structurally can't have
  this: no per-job JSON endpoint exists at all, confirmed in the fetcher's
  own code comment — description only lives on the rendered HTML page.
  Darwinbox (checked against Udaan's board, needed a real browser
  User-Agent to clear Cloudflare — header-only fix, same class as the CIBC
  precedent, not a true TLS-fingerprint wall) returns only internal IDs and
  location metadata. Together with SmartRecruiters/Greenhouse/Lever/Ashby/
  Workday (source 2d above and elsewhere in this doc), that's 8 of the top 9
  platforms by tracked-company volume now audited for this specific
  leak-shaped signal.
- **Sitemap-based board detection** — different problem (board *finding*, not
  contacts), tried and reverted for a measured 0% hit rate; see HANDOFF.md.
  Listed here so nobody re-proposes it as a contact source either.
- **Breach dumps, WHOIS fishing** — legally/reputationally radioactive; the
  bounce-damage logic that governs `domainMatchesOrg` applies doubly.

## Where the code lives

| File | Contents |
| --- | --- |
| `src/contacts.ts` | Git-commit source, `domainMatchesOrg`, pattern inference/factory, freemail & machine filters |
| `src/contact-sources.ts` | npm/PyPI/Maven registries, SmartRecruiters creators, website scanner, role addresses, `contact-find` CLI |
| `src/outreach.ts` | `resolveRecipients()` ladder wiring, SMTP verify + Gravatar path |
| `src/contacts-sweep.ts` | Whole-corpus measurement sweep (`npm run contacts-sweep`) |
| `src/verify-email.ts` | Raw SMTP RCPT probing with catch-all control (local-only: port 25 blocked on Actions runners) |

CLIs:

```
npm run contacts -- <org>            # git commits for one GitHub org
npm run contact-find -- "Name" https://site.com [domain]   # npm + website + roles
npm run contacts-sweep               # whole-companies.json measurement run
```

## Open next steps

1. **LinkedIn-URL finder**: map company → right profile URL so applyboltLookup
2. **Role-address lane**: verify role boxes with existing `verifyEmail`, own
   template in the batch page (no person = different opener), clearly labeled.
3. **Hunter.io account** (free, no card): 25 searches/month is small but the
   API shape is clean; useful as a cross-check for high-value targets.
4. **First real send** — sender infra deployed but nothing sent yet; the
   COLDMAIL-PLAN warmup ramp doesn't start until the first message goes out.
5. **Oracle wider sample** (20-30 tenants, not 4) before fully writing off
   `ExternalContactEmail` — real field, real value if even a handful of the
   515 tracked Oracle companies populate it, no evidence yet either way.
6. **Remaining small-volume platforms** (SuccessFactors, Phenom, TurboHire,
   PeopleStrong, and the rest under ~20 companies each) never got the same
   raw-field audit sources 2d/Oracle/Eightfold/Workable/Darwinbox above did.
   Low priority — diminishing returns given the top 9 platforms by volume
   are now covered — but flagged so nobody assumes it was exhaustive.
7. **Source-level reply measurement** — `ContactState.source` (git/npm/
   pypi/maven/smartrecruiters) is wired end to end as of 2026-09-02 but has
   nothing to measure yet; becomes real the moment #4 happens.
