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

### 2. npm registry maintainers — built (2026-08-26)

Package manifests publish maintainer and author emails — corporate addresses
for the same reason commits are. Covers companies whose GitHub org is named
nothing like the company, or who ship packages without a public org.

- **Code:** `npmContacts()` in `src/contact-sources.ts`; wired into
  `resolveRecipients()` in `src/outreach.ts` as the fallback when git finds
  no corporate-domain commits. Same `domainMatchesOrg` guard applies.
- **Live test (2026-08-26):** "Razorpay" → 5 real addresses on the first run,
  including `vivek.shindhe@razorpay.com` — independently re-confirming the
  `first.last` pattern the 2026-08-22 hand probe found.
- Uses `/latest` manifests, not full package documents (some packages are
  megabytes across all versions).

### 2b. PyPI author emails — probed, not built

Same trick against Python packages. `GET https://pypi.org/pypi/{pkg}/json`
returns `info.author_email`.

- **Live test (2026-08-26):** `kiteconnect` → `talk@zerodha.tech`,
  author "Zerodha Technology Pvt. Ltd. (India)". Re-confirms the 2026-08-22
  measurement (`snowflake-connector-python` → Snowflake DL address).
- Skews toward team aliases rather than named individuals (npm is better for
  people, PyPI for domain confirmation). Worth building as a second fallback
  behind npm — same shape, ~40 lines.

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

### 5. DMARC rua records — probed, cheap win, not built

`_dmarc.{domain}` TXT carries `rua=mailto:` aggregate-report addresses. Nobody
reads those mailboxes — useless as targets, but their *existence* proves the
domain has live, managed mail infrastructure before any probe or send.

- **Live test (2026-08-26):** meesho.com → `dmarcreports@meesho.com`;
  stripe.com → `dmarc-reports@stripe.com`; zomato.com → vendor-hosted
  (`ag.ap.dmarcian.com`); swiggy.in → vendor-hosted (`rep.dmarcanalyzer.com`);
  razorpay.com publishes none (absence proves nothing).
- One DNS query per domain; natural pre-flight gate in front of SMTP probing.

### 6. Gravatar existence check — built

MD5 the lowercase address, request `gravatar.com/avatar/{md5}?d=404`; 200
means that exact address is registered — near-proof a human owns it.
Positive-only (404 proves nothing). Free tie-breaker for catch-all/gateway
verdicts where SMTP can't decide.

- **Code:** `gravatarExists()` in `src/outreach.ts`, already on the
  verification path for `unknown` verdicts.

### 7. ApplyBolt public endpoint — probed again 2026-08-26: now live

`POST https://api.applybolt.app/public/findEmailByLinkedIn` with
`{"linkedinUrl": ...}` does the LinkedIn-scraping step nobody can safely do
at scale themselves, and returns `{found, email, validation, fullName,
jobTitle, company}` unauthenticated and free.

- **History:** measured 502 on 2026-08-21, written off as "somebody else's
  endpoint, no contract." Retested 2026-08-26: three consecutive HTTP 200s at
  ~1s each, correct real-person results (`satya@[school]` for Nadella,
  `bill.gates@gatesfoundation.org` for Gates), with a `"cached"` flag
  suggesting a result cache in front. One timeout also observed the same day
  — flaky under load but working far more often than not.
- **Verdict:** worth wiring behind a retry-with-timeout adapter, off by
  default (env flag), because there is still no SLA and it could vanish or
  rate-limit without notice. But it is now the highest-upside unbuilt source:
  it covers exactly the companies with no public code footprint.
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
- **Sitemap-based board detection** — different problem (board *finding*, not
  contacts), tried and reverted for a measured 0% hit rate; see HANDOFF.md.
  Listed here so nobody re-proposes it as a contact source either.
- **Breach dumps, WHOIS fishing** — legally/reputationally radioactive; the
  bounce-damage logic that governs `domainMatchesOrg` applies doubly.

## Where the code lives

| File | Contents |
| --- | --- |
| `src/contacts.ts` | Git-commit source, `domainMatchesOrg`, pattern inference/factory, freemail & machine filters |
| `src/contact-sources.ts` | npm registry, website scanner, role addresses, `contact-find` CLI |
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

1. **DMARC pre-flight** (~15 lines): check `_dmarc.{domain}` before probing a
   candidate domain; warn when absent.
2. **PyPI fallback**: mirror `npmContacts()` for companies shipping Python
   SDKs; second fallback behind npm in `resolveRecipients()`.
3. **ApplyBolt adapter**: retry-with-timeout wrapper, env-flag off by default,
   feeding the same Candidate pipeline (it even returns `fullName`, which
   keeps drafts composable). Needs a LinkedIn-URL finder for each target —
   `https://www.linkedin.com/in/{guess}` heuristics or SERP lookup.
4. **Role-address lane**: verify role boxes with existing `verifyEmail`, own
   template in the batch page (no person = different opener), clearly labeled.
5. **Hunter.io account** (free, no card): 25 searches/month is small but the
   API shape is clean; useful as a cross-check for high-value targets.
6. **First real send** — sender infra deployed but nothing sent yet; the
   COLDMAIL-PLAN warmup ramp doesn't start until the first message goes out.
