# Open-source lead tooling — what exists, what to take

Companion to `CONTACT-DISCOVERY.md` (which covers the address-finding ladder
this repo already runs) and `COLDMAIL-PLAN.md` (deliverability and volume).
This file exists because the research in those two documents was thin in one
specific way: its survey of prior art was commercial-heavy (FindHR, JobCopilot,
Hunter, Apollo, ApplyBolt), its open-source survey was a single table of five
GitHub OSINT repos that was then dismissed, and almost every number in it came
from cold-email vendor marketing rather than from a primary source.

Swept 2026-09-07 across six angles — email finding, verification, sequencing
and warmup, job-seeker-specific tooling, enrichment/company data, and primary
evidence. Every entry below carries the licence and last-activity date as
actually fetched on that date, not as remembered.

**Read the honesty note in section 6 before acting on the enrichment and
verification rows** — two of the six angles lost their fact-checking pass to a
session limit, and their rows are leads, not confirmed facts.

---

## 1. The verdict

**Nothing found makes this repo's outreach stack redundant, and that is the
correct outcome rather than a disappointing one.** The OSS world has mature
answers to the two problems this repo does *not* have — bulk campaign delivery
(listmonk, Postal, Mautic) and mailbox warmup at fleet scale (warmbly) — and
essentially nothing for the problem it does have, which is: a single human
sending 1:1 mail off a hiring trigger they detected themselves.

The commercial claim in `COLDMAIL-PLAN.md` section 3 ("no product found detects
a role going live and sends a timed, sequenced follow-up on the strength of that
trigger") **survives contact with the open-source ecosystem too** — now actually
tested rather than assumed. `career-ops` (MIT, pushed 2026-09-06) is draft-only
and one-shot. JobFunnel is archived, and never had a contact layer. AIHawk is
30,318 stars and no longer a job applier at all. `trustpilot-outreach-automation`
(ISC) proves the trigger-to-draft-to-spaced-send pattern exists in OSS, but aims
it at review requests rather than hiring.

What the sweep did produce is a long list of **small, licence-clean things to
lift** — three new registry endpoints, four vendorable data files, a bounce
classifier, and a set of primary-source citations that correct real numbers
currently written in the docs. That is the shape this repo already prefers:
absorb the technique, never the dependency.

## 2. The absorb ladder

Ranked by value per unit of effort for a system that has sent zero mail.

### Free wins — vendorable data files, no logic to write

These are static lists this repo currently hand-maintains or lacks entirely.
Same pattern already used for `elliottdehn/open-jobs` (CC0): vendor the raw
file, refresh periodically.

| What | Source | Licence |
| --- | --- | --- |
| Disposable-domain list | `disposable-email-domains/disposable-email-domains` | CC0-1.0 |
| Freemail domain list | `Kikobeats/free-email-domains` | MIT |
| Role-account local parts | `mixmaxhq/role-based-email-addresses` | MIT |

`contacts.ts` already filters freemail and machine addresses with its own
hand-written sets; these replace guesswork with a maintained list. The
role-account list is also what `roleAddresses()` should be generated from,
rather than the handful of prefixes it hard-codes today.

### Three more registry rungs — one fetch each

The npm/PyPI/Maven step in `contact-sources.ts` generalises to three more
ecosystems at near-zero cost. All three were fetched live and returned a real
address on a real package:

- **GitLab commits** (`/api/v4/projects/:id/repository/commits`) returns
  `author_email` in plaintext, unauthenticated — confirmed against
  `gitlab-org/gitlab`. This is `COLDMAIL-PLAN.md` section 5's lever 6, and it
  reuses `domainMatchesOrg` and the pattern inference unchanged. Caveat: GitLab
  has no clean org-search equivalent to GitHub's, so it only helps once a
  company's GitLab presence is already known from elsewhere.
- **CRAN via `crandb.r-pkg.org`** — the `Maintainer` field, confirmed
  (`ggplot2` returns `thomas.pedersen@posit.co`). Niche: R shops are a thin
  slice of this corpus.
- **Packagist** (`repo.packagist.org/p2/<vendor>/<pkg>.json`) — `authors[].email`
  on the latest release. Verified real, and verified *inconsistent*: on
  `monolog/monolog` only the newest release carries the field at all, so expect
  a materially lower hit rate than the npm rung.

### Bounce classification — the currently-empty half of the loop

`verify-email.ts` does pre-send SMTP probing and nothing else; a bounce is
learned only when the human clicks a button. Three absorbs:

- `crisp-oss/email-bounce-parser` (MIT, npm, same language) parses an NDR into
  a reason. Small enough to read rather than depend on, if preferred.
- listmonk's bounce heuristic is **AGPL-3.0 — do not read its source into this
  repo.** What is worth taking is the shape, which is unoriginal engineering and
  freely reimplementable: RFC 3463 status codes (4.x.x soft, 5.x.x hard) plus a
  small phrase table, defaulting to *soft* when nothing matches.
- Microsoft publishes the literal string `550 5.7.515` for its high-volume
  sender rejection. That is an authentication failure, not a dead mailbox, and
  the bounce gate should special-case it as "fix your auth" rather than
  suppressing the address forever.

### Reply detection — the number the whole strategy is gated on

`OUTREACH-DESIGN.md` section 9 says to pause if replies fall below a threshold,
and nothing in the repo can currently measure a reply except a manual click.

- **Gmail API `users.history.list` polling** (`googleapis`, Apache-2.0, v178
  published 2026-08-31): store a `historyId` per sending account and poll it on
  a schedule this repo already runs. Roughly 20-30 lines, an official client, no
  webhook or Pub/Sub billing surface.
- **Match replies by `References`/`In-Reply-To`**, not by subject or body — the
  technique in `arnaudjnn/outbound-tools`. That repo has **no LICENSE file**
  (all rights reserved by default), so take the idea, never the text. Its
  nine-value reply taxonomy (interested, meeting_request, information_request,
  not_interested, wrong_person, do_not_contact, out_of_office, unsubscribed,
  bounced — split into terminal and non-terminal) is a better starting schema
  than inventing one.
- **Plus-addressing (RFC 5233)** is the cheapest possible correlation key, but
  it is a precision layer on top of reply-polling rather than a substitute for
  it, and some corporate filters mangle the `+` part.

### Warmup — the one architectural rule worth writing down

`warmbly/warmbly` (Apache-2.0, 225 stars, pushed 2026-09-06) is real
infrastructure — Go workers, Postgres, Redis — and far too heavy to adopt. Its
architecture carries one rule this repo's plan does not state: **warmup traffic
must leave through each mailbox's own provider, never a shared sending IP**, and
warmup is scheduled real send/receive pairs between owned mailboxes rather than
"genuine correspondence" left to discipline. That belongs as a sentence in
`COLDMAIL-PLAN.md`, not as code, because nothing here automates sending yet.

### Company name to domain — the biggest unbuilt lever, and its best sources

75.1% of the 12,988 companies swept produced no domain at all, which is the
single largest gap in the whole pipeline. Two permissive datasets look like the
cheapest attack, **both unverified — see section 6**:

- **Wikidata P856** (official website) — CC0, queryable by SPARQL or as a dump.
- **BigPicture free company dataset** (`bigpictureio/companies-2023-q4-sm` on
  HuggingFace) — ODC-BY, a name-to-domain table to load once and look up locally.

## 3. Probe before building

In this repo's measure-first style. Each is a command with a pass mark.

1. **Wikidata coverage.** Take 50 company names sampled from the 9,750 the sweep
   found no domain for, run them through a P856 SPARQL query, and count how many
   resolve to a domain that survives `domainMatchesOrg`. Pass at 20% or better;
   below 10%, drop it — that is the bar the sitemap experiment failed.
2. **BigPicture coverage**, same 50 names, same bar. Run both before writing
   either, since they attack the identical gap and only one is worth keeping.
3. **Packagist / CRAN / GitLab yield.** Run each against 30 companies the
   existing ladder currently misses. Pass is 3 or more corporate addresses each.
   These are cheap enough that even a low pass rate is worth keeping.
4. **`githubContacts()` repoLimit.** Raise 3 to 10 for known-good orgs, but
   **measure the GraphQL `cost` field first** — `contacts.ts`'s existing
   "cost: 1" note was measured against `commitLimit`, not `repoLimit`, so the
   flat-cost assumption is unproven for this change.
5. **Port 25 from CI** stays unsolved. The only concretely-verified escape found
   is a cheap VPS that permits outbound port 25 (around $11/yr); Reacher's
   hosted service is AGPL-or-commercial and is not a free path. No action until
   verification volume actually justifies a second machine.

## 4. Corrections to the existing docs

Every one of these replaces a vendor-blog citation with a primary source.

- **Complaint-rate thresholds.** `COLDMAIL-PLAN.md`'s 0.10%/0.30% figures are
  correct but cited to practitioner blogs. Cite Google directly
  (`support.google.com/a/answer/81126` and `/14229414`). Yahoo's Sender Hub
  publishes the same 0.3% ceiling independently — worth a second citation, and
  worth noting Yahoo does **not** simply mirror Google's 5,000/day bulk line.
- **The Microsoft rejection code.** The docs say `550 5.7.15`; Microsoft's own
  support page for high-volume sender rejection says **`550 5.7.515`**. The
  May 2025 effective date remains third-party-corroborated only.
- **"42% of replies come from follow-ups."** Traced to Instantly.ai and
  Saleshandy — both cold-email vendors publishing their own telemetry. It may
  well be true; it is not independent evidence, and the doc should label it as
  vendor telemetry rather than as a measurement.
- **Academic literature.** There is **no academic measurement of job-seeker-
  initiated cold email to a hiring contact.** The nearest anchor is the
  correspondence/audit-study literature on resume callbacks (AER/NBER), which
  measures a different mechanism entirely. A confirmed absence is a real result
  and belongs in the doc rather than being papered over.
- **RCPT-TO probing.** `verify-email.ts`'s header implies RFC 5321 sanctions
  callback verification. It does not. RFC 2505 and the Postfix/Exim documentation
  both caution against it, and probing at volume is itself a blocklisting risk.
  This is a comment fix, not a code change — but the code should stop implying
  that a standard blesses what it does.
- **"India has no strict opt-in regime."** Uncited today, and incomplete: the IT
  Act 2000 indeed carries no anti-spam provision, but the **DPDPA 2023** imposes
  consent obligations on personal data including scraped personal data, and the
  government's stated position (August 2024) does not exempt publicly-available
  personal data the way GDPR partially does. Name the DPDPA explicitly.
- **GDPR for the EU-based slice of the list.** "Legitimate interest covers B2B
  cold email" is an oversimplification: GDPR Recital 47 contemplates direct
  marketing as a legitimate interest, but the **ePrivacy Directive separately
  requires consent for unsolicited email**, and it is still the controlling
  instrument. Given the swept list skews US/EU, this deserves two honest
  sentences rather than one confident one.
- **Stop citing AIHawk as a job-applier.** It relicensed to MIT on 2026-09-02
  and is no longer that tool; every distribution before that date remains
  AGPL-3.0.

## 5. Assessed and rejected

One line each, so nobody re-proposes them.

- **reacherhq/check-if-email-exists** — AGPL-3.0-or-commercial, Rust. More
  restrictive than the GPL this project already refuses. Read, never vendor.
- **listmonk / Mautic / Postal / Mailtrain** — bulk-marketing engines. Postal is
  MIT and well documented, but all of them assume a fleet and a sending server
  with its own IP reputation, which is the opposite of this repo's model.
- **GONZOsint/gitrecon** — GPL-3.0 and dormant five years. Technique already built.
- **AfterShip/email-verifier** — MIT but Go; the payload is its per-provider
  quirk table, worth reading, not installing.
- **truemail** (MIT, Ruby) — one portable idea only: self-audit the probing host
  (a PTR lookup plus an A-record cross-check) before trusting its own verdicts.
- **deep-email-validator** — its SMTP layer duplicates `verify-email.ts`; only
  its data-file dependencies are interesting, and those are listed in section 2.
- **parsedmarc** (Apache-2.0) — genuinely useful, but only once this repo sends
  from its own domain with a `rua` mailbox. Nothing to parse today.
- **OpenCATS** (MPL-2.0) — confirms "a requisition has an owning human" is a real
  ATS schema concept, mildly validating the SmartRecruiters creator technique
  already built. No code to take.
- **JobFunnel** (MIT) — archived 2025-12-10, never had a contact layer.
- **GLEIF LEI golden copy** (CC0) — legal-entity reference data, no domains.
  The wrong dataset for the name-to-domain problem.
- **crates.io / RubyGems** — this repo's earlier rejection stands; neither
  exposes an email anywhere in its API.
- **Tranco top-1M** — a popularity list, not a name-to-domain map. At most a
  corroboration bit, never a source.

## 6. What was NOT checked

Stated plainly, because two of these groups would otherwise read as verified.

- **The enrichment and verification angles lost their fact-checking pass** to a
  session limit. Their findings — Wikidata P856, the BigPicture dataset, the
  vendorable domain lists, the truemail / deep-email-validator / AfterShip
  reads, `mailauth`, `checkdmarc`, `crisp-oss/email-bounce-parser`, the Twenty
  CRM provenance type, and the job-title classifiers — were reported by a
  researcher but never independently re-fetched. Treat every one as a lead to
  verify, not a fact. The section 3 probes exist precisely to settle the two
  that matter most.
- **No hit rate was measured for anything in section 2.** Every yield claim is a
  structural argument ("this endpoint contains addresses"), not a measurement
  against this corpus. That is exactly the mistake the sitemap experiment made.
- **Open-source CRMs were surveyed shallowly.** Twenty's contact-provenance
  model was the only thing pulled out of that category, and it was not verified.
- **No dataset of real cold-email outcomes was found.** The closest is a
  single-author 79-account content study (`dearhiringmanager.io`), which is
  qualitative and explicitly not a rate. The honest substitute remains the user
  measuring their own first hundred sends.
