# Cold outreach plan

Companion to HANDOFF.md. Covers the proposed "find a human at the company, mail
them when a matching role opens" feature. Stages 1 and 2 are built; the rest is
the design, the measured constraints, and the open decisions.

## 1. What the ApplyBolt LinkedIn email finder actually does

Tested live on 2026-08-21 against https://www.applybolt.app/linkedin-email-finder.
The UI narrates its own pipeline through three stages, which is the whole design:

1. `Matching the name and company…` — fetches the public LinkedIn profile and
   pulls the person's name and current employer from it.
2. Builds "the most likely work email" from that name plus the company's domain
   — i.e. pattern guessing (`first.last@`, `flast@`, `first@`, and so on).
3. `Checking the mail server…` / `Verifying it's really deliverable…` — an SMTP
   probe against the company's MX to see whether the address is accepted.

Its own page states the limits plainly: it only works "for profiles with a
current job", and it cannot return personal Gmail or Outlook addresses.

**Reliability, measured:** two lookups, two failures. `satyanadella` (a real,
public, currently-employed profile) reached stage 3 and then returned
"Something went wrong. Please try again in a moment." after roughly 60 seconds.
A second lookup failed the same way. The sample is small, but the conclusions
that matter do not depend on the hit rate:

- **Roughly 60 seconds per lookup.** Five hundred companies per run would be
  over eight hours of serial work, before any failures or retries.
- **It is not a moat.** Steps 2 and 3 are about sixty lines of Node with no
  dependencies (`dns/promises`'s `resolveMx` plus a `net` socket speaking
  SMTP). Step 1 — LinkedIn — is the only hard part, and it is hard for us too.

### The endpoint it calls

The form does not use a Next.js server action; it calls a separate API host.
Captured by hooking `window.fetch` in the page and submitting the form:

```
POST https://api.applybolt.app/public/findEmailByLinkedIn
content-type: application/json

{"linkedinUrl":"https://www.linkedin.com/in/williamhgates"}
```

No API key, no auth header, no cookie, no CSRF token, no Cloudflare challenge
on the API host itself (the challenge script seen on the page belongs to the
marketing site, not to `api.applybolt.app`). It is callable straight from
`curl` with no browser involved.

**Current status: the backend is down.** All three profiles tried
(`satyanadella`, `williamhgates`, `jeffweiner08`) returned Cloudflare's
`error code: 502` after a consistent ~21 seconds, which is an origin failure,
not a block on us — and it matches the "Something went wrong" the UI shows.
The endpoint is reachable; the service behind it is not answering right now.

That leaves the interesting question unanswered: what its rate limit is when
it *is* up. The page advertises "no signup, no credit card, and no daily cap",
but an unauthenticated free endpoint fronted by Cloudflare will have per-IP
limiting of some kind regardless of what the copy says. **This has to be
measured once the backend recovers** — a slow ramp (one lookup, then a few,
then a burst) before anything depends on it. Building a pipeline on somebody
else's free unauthenticated endpoint also means accepting that it can add auth,
add a cap, or disappear on any given day, which is a reason to keep it as one
source behind an interface rather than as the pipeline itself.

## 2. What the constraints actually are

The original shape was: scrape LinkedIn for people at 500 companies, verify the
addresses, mail all of them every other day. Every one of those three steps has
a hard limit worth knowing before any code is written — and in two cases the
measured answer turned out better than the first guess, not worse.

### LinkedIn at scale is the blocker, not the email part

LinkedIn is among the most aggressively anti-scraped sites on the web. Most
profile pages sit behind an auth wall for logged-out clients, and the ones that
do not are rate-limited by IP within a few dozen requests. Doing it while
logged in trades an IP ban for a permanent account ban. Thousands of profile
fetches every two days is not something that survives its first run. This is
why the plan below treats LinkedIn as a last resort rather than the primary
source.

### SMTP verification works better than expected, given who we target

An earlier draft of this document claimed verification was largely theatre
because Google and Microsoft both tarpit recipient probes. That was wrong in an
important way: the two behave very differently, and the difference runs in the
direction that helps here.

Published comparisons put **Google Workspace at 90.6% conclusively valid and
5.4% conclusively invalid**, against **Microsoft-hosted domains at 51.4% valid
with a 39.3% invalid rate** — Microsoft's SMTP frontends routinely accept
`RCPT TO` for mailboxes that no longer exist, or throttle probes into
ambiguity. Google is the reliable case; Microsoft is the broken one.

That matters because of what this project actually targets. **Measured on
2026-08-21** — MX lookup over the twelve companies the git sweep found, plus
nine other well-known product companies:

| Mail provider (lowest-priority MX) | Companies | Share |
| --- | --- | --- |
| Google Workspace | 17 | 81% |
| Mimecast (swiggy.in, flipkart.com) | 2 | 10% |
| Proofpoint (atlassian.com) | 1 | 5% |
| Other (groww.in) | 1 | 5% |
| **Microsoft 365** | **0** | **0%** |

Indian product and startup engineering orgs are overwhelmingly on Google
Workspace, which is the provider where SMTP verification actually answers
honestly. Not one of the twenty-one was on Microsoft 365. So for roughly four
in five targets here, verification is a real signal rather than a coin flip.

The caveats still stand, and they still shape the implementation:

- **Catch-all domains are 30–40% of B2B generally**, and higher behind
  enterprise gateways — which is exactly what Mimecast and Proofpoint are. A
  catch-all returns `250` for every address, including invented ones, so
  probing must include a control: query a deliberately absurd local part at the
  same domain first, and if that is accepted, the domain is catch-all and every
  result from it is `unknown`.
- **The three-state return stays**: `valid`, `invalid`, `unknown`. Catch-all,
  throttled, and timed-out all map to `unknown`. Calling those "verified" would
  be a lie the bounce rate later corrects, and the bounce rate is expensive —
  see below.
- **Bounces are the real cost of guessing wrong.** A hard bounce rate above
  **2%** marks a sending domain as unreliable, and above **5%** inbox placement
  drops sharply for *all* recipients, not just the bounced ones. Reputation
  damage is domain-wide, so one careless unverified batch degrades every later
  message.

### Where the verifier can actually run

Verification needs outbound TCP port 25, and that is not available everywhere.
**Confirmed working from the user's own machine on 2026-08-21** — a raw socket
to `aspmx.l.google.com:25` returned `220 mx.google.com ESMTP`, and
`eu-smtp-inbound-1.mimecast.com:25` answered likewise.

GitHub-hosted Actions runners are Azure infrastructure, and Azure blocks
outbound port 25 by default across most subscription types specifically to
protect its IP reputation; the documented workaround is an authenticated relay
on port 587, which is a *sending* path and cannot perform recipient
verification. **The practical conclusion is that verification runs locally (or
on a VPS that permits port 25), not in CI.** This should be confirmed with one
throwaway workflow run rather than taken on inference, but the design should
assume it: contact discovery and verification are a local or scheduled-VPS
step whose *output* gets committed, and the CI workflow only sends.

### Sending volume is what actually kills the idea

Five hundred companies "bi-daily" is somewhere between 250 and 1,000 messages a
day depending on which reading is meant. Against that:

- **A free Gmail account allows 500 messages a day through the browser but
  only 100 a day over SMTP.** That distinction matters more than any other
  number here, because a GitHub Actions workflow can only send over SMTP —
  so the free-Gmail ceiling for this project is 100/day, not 500. Practical
  limits on new accounts are lower still, commonly 100–200/day, and Gmail
  rate-limits bursts before the daily cap is reached (roughly 20/hour is the
  usual advice).
- **A new Google Workspace account does not get 2,000/day either.** The 2,000
  figure is the mature-account ceiling; trial accounts are capped at 500/day,
  and the limit ramps with account age and spend — one source puts full access
  at around $100 of accumulated Workspace fees, i.e. well over a year at
  Starter pricing. Budget for a ramp, not a switch.
- **Microsoft 365 is materially more generous than Google**: 10,000 recipients
  per day, 500 per message, throttled at 30 messages per minute. If the
  mechanical cap ever became the binding constraint, that is where to look —
  though the behavioural limits below still apply, so it mostly is not.
- Limits reset on a **rolling 24-hour window**, not at local midnight, and the
  standard advice is to stay at **70–80% of the cap** rather than pushing to
  it.

Those are the mechanical ceilings, and they are **not** the binding constraint.
- The binding constraint is reputation. Published practitioner guidance
  converges on **20–30 cold emails per warmed inbox per day** (some sources say
  up to 50; the cold-email-agency consensus for a lookalike domain is the
  tighter 20–30), and **10–20 for a new one** — one to two orders of magnitude
  below Google's own hard cap. Gmail does not throttle cold outreach by volume;
  it flags behavioural signals (near-identical bodies, no prior thread, low
  reply rate, high bounce rate) and suspends on those. A brand-new sending
  domain emitting hundreds of cold messages a day lands in spam within the
  first week and stays there.
- **Domain age is its own gate, separate from warmup.** Microsoft enforces a
  hard 14-day minimum domain age in 2026 and Gmail's equivalent is algorithmic
  but lands in the same place; a 30–60 day old domain measurably outperforms a
  7-day-old one by 15–20% on inbox placement *after identical warmup*.
  Realistic purchase-to-first-real-campaign is **6–8 weeks**. Buy the domain
  now even if nothing else gets built, because that clock runs independently
  of any code.
- **The alert Gmail must not be the sending account.** It is the address the
  hourly job alerts arrive at; getting it flagged would cost the existing,
  working product in order to power a speculative new one.

#### Why not just use the Gmail account

Beyond the suspension risk to the alert inbox, a `@gmail.com` From address is
structurally weak for this specific job. There is no domain reputation to
build — the sender is borrowing gmail.com's, which Google does not extend to
outbound cold mail — and corporate filters, Microsoft 365 in particular, score
consumer freemail senders down hard on business-to-business mail. Nor is there
any DKIM signature under a domain the sender controls, so none of the
deliverability work in stage 3 has anywhere to attach.

Gmail is genuinely fine for two things: the stage 0 self-test, and manual
low-volume outreach in the 10–20/day range. It is not a foundation for 250 to
1,000 messages a day.

#### Follow-ups multiply the volume — and they are not optional

The single most consequential number found in this research: **42% of all
replies come from follow-ups, not from the first message**, and most positive
replies land on the third to fifth touch. Follow-ups raise reply rate roughly
**2.5x**. For job-seeker outreach specifically the recommended shape is
**three to four messages over two to three weeks**.

So the unit of outreach is not one email per company — it is **four**. Every
volume estimate in the original plan was therefore off by 4x in the wrong
direction, and a one-shot blast is the version of this that provably does not
work.

#### What the target volume actually costs

Taking 25/day/mailbox as the working ceiling and 4 touches per company:

| Reading of "bi-daily" | New companies/cycle | Sends/day at steady state | Warmed mailboxes | Rough ₹/month |
| --- | --- | --- | --- | --- |
| 500 every second day | 500 | ~1,000 | ~40 | ₹12,800 |
| 500 twice a day | 500 | ~4,000 | ~160 | ₹51,000 |
| **500 spread over a month** | ~35 | ~70 | **3** | **₹960** |

Costed at Google Workspace Starter, listed at ₹270/user/month on an annual
commitment plus 18% GST (≈ ₹319 effective). Google also lists an India-only
self-service "Base" plan at ₹99 — worth checking directly, as reseller and
Google-direct pricing differ, and this figure came from a secondary source.

The third row is the point. **The 500-company target is not unreasonable; the
two-day deadline on it is.** Stretch the same 500 companies across a month,
with a proper four-touch sequence, and it fits on three mailboxes for under a
thousand rupees a month — versus forty mailboxes and a cold-email platform to
do it in two days, badly. Same reach, roughly 1/13th the cost, and a
dramatically higher reply rate because the sequence is what produces replies.

#### The multi-domain setup, if it ever scales past one mailbox

The standard practitioner pattern, for reference: buy **lookalike secondary
domains** — never the main one — put **2–3 mailboxes on each**, cap each
mailbox at 20–30/day, warm everything **14–21 days**, 301-redirect the
lookalike domains to the real site, and rotate domains every **6–9 months**.
The point of lookalikes is that when one gets burned, the burn is contained.

#### Bulk-sender rules, and why they mostly do not bite here

Google's and Yahoo's bulk-sender requirements trigger at **5,000+ messages a
day to personal Gmail/Yahoo addresses**. At the volumes above this project is
nowhere near that threshold, and the recipients are corporate domains rather
than personal inboxes — so the *bulk* tier does not apply. What applies to
everyone regardless of volume: valid **SPF, DKIM, PTR and TLS**, with DMARC
published (`p=none` is an acceptable start, progressing toward `quarantine`).
Unauthenticated mail can now be rejected outright.

Two thresholds are worth knowing even below the bulk tier, because they are
what "spam folder forever" actually means in numbers: a **spam-complaint rate
at or above 0.30%** makes a domain ineligible for Google's delivery
mitigation until it stays under for seven consecutive days, and the
recommended safe target is **below 0.10%**. Combined with the 2% bounce
threshold from section 2, the entire margin for error is about one complaint
in a thousand and one bad address in fifty.

One-click unsubscribe (RFC 8058, the `List-Unsubscribe` and
`List-Unsubscribe-Post` headers) is required for bulk marketing mail. A 1:1
job-seeker email is not marketing mail, so the header is not strictly
required — but including it, plus honouring any "stop" reply within two days
via the suppression list, costs nothing and is unambiguously the right side of
the line.

Every one of those mailboxes needs its own three-to-four-week warmup, and a
mailbox fleet at that size is really a cold-email platform's job (Instantly,
Smartlead and similar exist precisely to rotate inboxes), not a GitHub Actions
workflow calling `smtp.gmail.com`.

#### Bulk email services are not a shortcut here

Amazon SES, SendGrid, Resend and similar are the obvious "just use an API"
answer and are the wrong tool twice over. Their acceptable-use policies
require opt-in consent and explicitly prohibit unsolicited mail — AWS's policy
requires that messages be "specifically requested by the recipient", and
sending cold outreach through SES risks suspension of the whole AWS account,
not just the mail service. Separately, they are built for transactional and
marketing mail from shared infrastructure, whereas cold outreach that expects
a human reply needs to come from a real mailbox that can receive one. Use a
mailbox provider, not an ESP.

Zoho, often suggested as the free alternative, no longer works either: its
Forever Free plan is web-access only, IMAP/POP/SMTP having been moved to the
paid Mail Lite tier — reportedly *because* free accounts were being used for
bulk SMTP sending. A free plan with no SMTP cannot be driven from a workflow
at all.

### The reply-rate numbers, which settle the volume argument outright

The strategic case against volume stopped being a matter of opinion once the
benchmarks were checked. Published 2026 cold-email figures:

| Approach | Reply rate |
| --- | --- |
| Overall cold-email average | **3.43%** |
| Template sequences | **under 1%** |
| Generic but competent | ~9% |
| Advanced personalisation | ~18% |
| **Referencing a specific trigger event** (funding round, leadership change, **hiring surge**) | **15–25%** |

That last row is the entire thesis of this feature, independently confirmed.
Trigger-referencing outreach runs roughly **5x** the baseline, and "this
company just opened a role I match" is exactly such a trigger — one that the
hourly hunt detects automatically and that almost nobody else acts on within
hours of it appearing.

Run the arithmetic against the options. Five hundred templated messages at
under 1% yields perhaps four replies and a burnt domain. Thirty-five
trigger-referenced, sequenced messages at 15% yields five replies, on three
mailboxes, with the domain intact and repeatable next month. **The low-volume
version is not a compromise on the original goal — it produces more replies in
absolute terms, for a thirteenth of the cost.**

## 3. Prior art — is anyone already doing this?

Checked before building anything, because the cheapest version of this feature
is the one that turns out to already exist. The answer is that **all three
pieces exist separately and nothing found combines them**.

### The contact-finding layer is a solved, commoditised product

Several products do almost exactly the "paste a job, get the human" step:

- **FindHR** is the closest match to the original idea. Paste a job link and it
  returns, in about fifteen minutes, "2 Hiring Manager and 2 Recruiters filling
  that specific role's LinkedIn and Email", verified. Crucially it **only
  finds** — "you write it, you send it from your own inbox". Pricing: free tier
  2 lookups, Starter $9.99/week for 5, Plus $29.99/month for 21, Pro
  $59.99/month for 45.
- **JobCopilot** offers hiring-manager/recruiter search at any company with
  email and LinkedIn side by side.
- **ApplyBolt** — the tool that started this whole thread — pairs its free
  LinkedIn email finder with automated applying.
- **Hunter** and **UpLead** are the general-purpose versions (Hunter's free
  tier is 25 searches + 50 verifications a month; UpLead claims 60M contacts at
  95% accuracy).

The number that matters is FindHR's: **$59.99 for 45 lookups is about $1.33 per
company**. Extrapolated to 500 companies that is roughly **$665 a month** —
against ₹960 (~$11) of mailboxes plus a free contact source. That ratio is the
entire economic case for building rather than buying, and it only holds at
volume. Below about fifty companies a month, paying FindHR and sending by hand
is genuinely the cheaper answer, and this document should say so plainly.

### The git-commit technique is established OSINT, not a discovery

The commit-email method in section 4 is a well-known reconnaissance technique
with mature tooling behind it. That is reassurance rather than disappointment —
it means the approach is validated by people who have run it at scale:

| Tool | Stars | Last push | Licence |
| --- | --- | --- | --- |
| `laramies/theHarvester` | 17,148 | 2026-08-20 | none stated |
| `GONZOsint/gitrecon` | 322 | 2021-03-25 | GPL-3.0 |
| `chm0dx/gitSome` | 54 | 2025-08-26 | none stated |
| `vulnbe/github-osint` | 33 | 2022-03-30 | MIT |
| `zcrosman/git-emails` | 1 | 2024-06-18 | none stated |

None of them should be pulled in as a dependency. theHarvester is a large,
actively maintained Python OSINT suite and everything else here is TypeScript;
gitrecon has been dormant for five years and is GPL, which is the wrong licence
to entangle with. The actual work — call the commits endpoint, filter noreply
and freemail addresses, tally domains — stays about thirty lines. Their
existence is the evidence that it works, not a reason to import it.

### Nobody found is doing the combination

The open-source projects in this space (several LinkedIn-scraper-plus-OpenAI
mailers, various job-scraper-to-email-digest tools) stop at either scraping or
blasting. The commercial products stop at the contact hand-off. **No product
found detects a role going live and sends a timed, sequenced follow-up to a
person at that company on the strength of that trigger.**

That gap is real, and it is precisely the part this repository already has for
free: the hourly hunt knows which roles went live in the last hour, which is
the trigger worth 15–25% reply rates rather than 3%. The contact layer is
buyable or obtainable through public OSINT; the trigger is not sold by anyone
because it requires already running a job scraper. **Build the sequencing and
the contact resolution; the expensive-looking part is the part already owned.**

## 4. Revised architecture

Same goal, sources reordered cheapest-and-safest first, volume right-sized.

### How to get a company person's email

There are really only two mechanisms underneath every tool in this space,
including ApplyBolt: **find an address that is already published somewhere**,
or **guess it from a name and confirm the guess**. Everything below is one of
those two.

Guessing is more tractable than it sounds, because companies standardise. About
**47.7% of B2B addresses are `first.last@`** and another **26.8% are bare
`first@`** — the two together cover roughly three quarters of everything, and
about eight patterns cover nearly all of the rest. The split tracks company
size: around **74% of employers with 10,000+ staff use `first.last@`**, against
**38% of those with 1–10**, where a bare `first@` is the default until name
collisions force something longer. So the practical unit of work is not "guess
this person's address" but "learn this *domain's* pattern once, then construct
everyone". Learning a pattern needs exactly one known-good address at that
domain — which is what makes source 1 below the keystone of the whole design.

#### 1. Public git commit metadata — free, measured, and the strongest source

Every git commit carries the author's email in plain text, and GitHub serves it
through its public REST API with no scraping and no authentication needed:

```
GET https://api.github.com/repos/{owner}/{repo}/commits?per_page=50
```

Each entry has `commit.author.email`. Engineers pushing from a work laptop
commit under their work address, so a company's own public repositories leak
their corporate addresses directly.

**Measured on 2026-08-21**: fifteen Indian product companies, top three
most-recently-pushed repos from each org, filtering out `users.noreply.github.com`
and consumer freemail. **Twelve of fifteen yielded corporate addresses.**

| Org | Domain found | Corporate addresses seen |
| --- | --- | --- |
| dream11 | `@dream11.com` | 16 |
| meesho | `@meesho.com` | 15 |
| browserstack | `@browserstack.com` | 15 |
| razorpay | `@razorpay.com` | 14 |
| zomato | `@zomato.com` | 12 |
| flipkart | `@flipkart.com` | 10 |
| swiggy | `@swiggy.in` | 9 |
| hasura | `@hasura.io` | 5 |
| phonepe | `@phonepe.com` | 3 |
| juspay | `@juspay.in` | 2 |
| cred-club | `@cred.club` | 1 |
| zerodha | `@zerodha.com` | 1 |
| groww, urbanclap, postman-insights | — | 0 |

Two things in that table matter more than the hit rate. First, the addresses
returned are provably *in use* — someone committed from them — which is a
stronger signal than any SMTP probe, and it sidesteps the catch-all problem in
section 2 entirely. Second, look at `swiggy.in`, `juspay.in` and `cred.club`:
**guessing the mail domain from the company name would have been wrong for a
quarter of the hits.** This method returns the real domain and the real pattern
together (Razorpay's sample — `mahlaqa.haque@`, `manish.soni@` — resolves it to
`first.last@` immediately).

Cost and limits: the unauthenticated GitHub API allows 60 requests an hour,
which the fifteen-company sweep above nearly exhausted (54 used). With a token
it is 5,000 an hour — and `hunt.yml` already runs in Actions with `GITHUB_TOKEN`
available, so this is free at the scale needed. Finding a company's org is one
extra call (`/orgs/{name}/repos?sort=pushed`), and org names mostly match
company names with the obvious normalisations.

The people this surfaces are engineers and engineering managers, not recruiters.
For job-hunting outreach that is arguably the better audience: referrals come
from engineers, and recruiter inboxes are already saturated.

#### 1b. Package registries — the same trick, a second corpus

npm and PyPI publish maintainer and author addresses in their public JSON, and
those are corporate addresses for exactly the same reason commit metadata is:
somebody published from a work machine. Measured 2026-08-22:

```
GET https://registry.npmjs.org/{package}      -> maintainers[].email,
                                                 versions[latest].author.email,
                                                 versions[latest].contributors[].email
GET https://pypi.org/pypi/{package}/json      -> info.author_email,
                                                 info.maintainer_email
```

| Package | Addresses returned |
| --- | --- |
| `@razorpay/blade` | `vivek.shindhe@razorpay.com`, `neha.singhal@razorpay.com`, `tools+npmadmin@razorpay.com` |
| `next` | `infra+release@vercel.com`, `team@zeit.co` |
| `@mui/material` | `diego@mui.com` |
| `@sentry/node` | `accounts@sentry.io` |
| `snowflake-connector-python` (PyPI) | `snowflake-python-libraries-dl@snowflake.com` |
| `sentry-sdk` (PyPI) | `hello@sentry.io` |

npm is clearly the better of the two: it returns *named individuals*
(`vivek.shindhe@`, `neha.singhal@` — confirming Razorpay's `first.last` pattern
a second way), while PyPI's fields are usually a team alias. Both are free,
unauthenticated, and have no rate limit worth worrying about at this scale.

The value is not the volume — it is that npm covers companies whose GitHub org
is named differently from the company, or who publish packages without a public
org at all. It belongs as a fallback for the ~87% the git sweep missed, not as
a replacement for it.

#### 1c. DMARC records — domain confirmation, not contacts

`_dmarc.{domain}` TXT records carry `rua=mailto:` addresses. Measured:
`dmarcreports@meesho.com`, `dmarc-reports@stripe.com`, `rua@cloudflare.com`,
and vendor-hosted ones for Zomato and OpenAI (`@ag.dmarcian.com`). Razorpay
publishes none.

Nobody reads a DMARC aggregate mailbox, so these are useless as outreach
targets. They are worth exactly one thing: **confirming that a guessed domain
is the company's real mail domain and is actively managed.** A free, single-DNS
-query sanity check on a domain before anything gets sent to it.

`security.txt` was checked at the same time and is not worth implementing —
Cloudflare, Stripe and GitHub all point at a HackerOne URL rather than an
address.

#### 2. The rest of the ladder

In order, stopping at the first that yields an address:

1. **Public git commits**, as above. Free, zero risk, ~80% hit rate on product
   companies, and it is the only free source that yields a *confirmed* address
   rather than a guess.
2. **Pattern construction plus verification.** With the domain's pattern known
   from step 1, any name becomes an address in one step. Cache the pattern per
   domain in `state/email-patterns.json` so it is learned once, not per person.
   Where the pattern is unknown, fall back to generating the standard eight
   candidates and verifying — but never by sending to all eight and watching
   for bounces, which burns exactly the sender reputation the whole plan is
   trying to protect.
3. **Role addresses.** `careers@`, `jobs@`, `hr@`, `talent@`, MX-verified. Low
   reply rate, but zero risk and no name needed, so it is the natural floor
   for the ~20% of companies with no useful public repos.
4. **The ATS posting itself.** Some platforms expose recruiter or hiring-team
   fields in their public JSON. Measured so far: Greenhouse's board API returns
   a `Recruiting Team Responsible` metadata field — a team name (e.g. "GCO
   Recruiting"), not a person and not an address. Worth a sweep across the
   platforms in `src/fetchers/` since it is free, but it looks thin.
5. **Company website surfaces** — team and about pages, press releases, PDF
   whitepapers, conference speaker bios, `security.txt`. Cheap, uneven, and
   mostly useful for the domain and pattern rather than for a specific person.

   A cheap adjunct here: **Gravatar as an existence check**. MD5 the lowercase
   address and request `https://gravatar.com/avatar/{md5}?d=404`; a `200` means
   that exact address is registered with Gravatar and therefore real. Verified
   working on 2026-08-21 (`torvalds@linux-foundation.org` → `200`, invented
   addresses → `404`). It is positive-only — a `404` proves nothing — and
   coverage skews heavily toward developers and open-source contributors, but
   it costs one HTTP request, touches no mail server, and cannot damage
   anything. Useful as a free tie-breaker between candidate patterns.
6. **A commercial API with real terms.** Free tiers as of 2026:
   **Hunter.io** — 25 searches plus 50 verifications a month, recurring, no
   card required, the most generous *recurring* free tier;
   **Apollo.io** — nominally unlimited email credits under a fair-use policy
   that caps free accounts at **10,000 credits a month** against a 270M-contact
   database, but with a 10-row CSV export limit that makes getting the data
   *out* the bottleneck; **Snov.io** — 50 credits as a one-off trial, not
   recurring. Apollo's number is far larger than this project needs and worth
   checking first; the export cap may or may not apply to its API, which is the
   thing to verify before planning around it.
7. **`api.applybolt.app/public/findEmailByLinkedIn`**, called directly (see
   section 1). Free, unauthenticated, no browser needed, and it does the
   LinkedIn step — the step we cannot safely do ourselves. It is also somebody
   else's endpoint, currently returning 502, with an unmeasured rate limit and
   no contract. Worth wiring up behind the same interface as every other
   source; not worth depending on.
8. **LinkedIn directly** — only if everything above is exhausted, and then via
   search-engine result snippets (name and title as they appear in SERP text)
   rather than by fetching linkedin.com.

Sources 2 and 6 need a *name* before they can produce anything. Sources 1, 3
and 7 do not — which, together with its hit rate, is why source 1 moved to the
front and why the LinkedIn problem that framed the original plan largely
dissolves.

**Sending:** a separate domain, never the alert Gmail. SPF, DKIM and DMARC all
published and passing before the first message goes out — not optional polish,
but the difference between the inbox and the spam folder. A per-run cap in
`config.ts`, starting low and raised only against measured results.

**Suppression:** `state/contacted.json`, keyed by address, so nobody is ever
mailed twice by accident. This file is what keeps the feature from becoming the
spam campaign described above, so it should be committed and treated as durable
state, in the same spirit as `state/outage.json`.

### The sending cadence: why a clean cron is the wrong shape

The natural instinct on this repo is to reuse what already works — `hunt.yml`
runs on a fixed cron, so run the mailer on one too, five messages every twenty
minutes. The instinct to reuse the workflow shape is right. The numbers and the
regularity are both wrong, and the regularity is the more interesting mistake.

**The arithmetic first.** Five messages every twenty minutes is 15 an hour:

| Window | Messages/day | Against the limits |
| --- | --- | --- |
| Round the clock | **360** | 3.6x the free-Gmail SMTP cap, 12–18x the behavioural cap |
| Business hours only (9h) | **135** | still 1.35x the SMTP cap, 5x the behavioural cap |
| **5 batches, ~2h apart** | **25** | inside every limit, with headroom |

A free Gmail account allows 100 messages a day over SMTP, so the round-the-clock
version hits a hard wall around hour seven and the account starts refusing.
Long before that it hits the softer and more damaging limit: 20–30 cold messages
per mailbox per day is where practitioner guidance converges, and sustained
sending well above it is what gets accounts flagged rather than merely throttled.

**The regularity is a signal in itself.** Sending on a precise twenty-minute
grid is not what a person does, and filters are explicitly looking for that:
rigid automation without randomised spacing produces a mathematical sending
pattern that reads as non-human traffic. Emails spread across business hours at
human-like intervals measurably outperform batches fired at a fixed instant.
Gmail also moved from soft filtering to active rejection for bulk senders in
November 2025, so the cost of looking mechanical went up.

**The shape that keeps the idea and fixes both problems:**

- **Five messages per batch, five batches a day, roughly two hours apart.**
  That is the same "5 per run" the original instinct wanted, at 25/day.
- **Jitter everything.** ±15 minutes on batch start, and 3–8 minutes randomised
  between the individual messages inside a batch. GitHub Actions cron is
  approximate anyway, which helps rather than hurts here.
- **Weekdays only**, and prefer **Tuesday to Thursday, 8–10am in the
  recipient's timezone**, which is worth 1–2 percentage points of reply rate
  over random scheduling.
- **Follow-ups 4–7 days apart**, not daily.

Note the timezone clause conflicts with the current contact list: the 1,637
companies the sweep found skew US and European, whose 8–10am is the middle of
the night in IST. Either bucket contacts by region and schedule per bucket, or
accept worse timing — but decide it deliberately rather than by accident.

25/day across five weekdays is 125 messages a week. At four touches per company
that is about 31 new companies a week, or roughly 135 a month, on one mailbox.
Which lands exactly where section 2's cost table did: **500 companies a month
needs about three mailboxes**, and no cron schedule can get around that.

#### A second Gmail account is right for testing and wrong for the campaign

Using a different account than the one the hourly alerts arrive at is correct
and important — getting the alert inbox flagged would break the working product
to power a speculative one. But a second free `@gmail.com` fixes only that:

- 100/day over SMTP, which is fine for 25/day, so the cap is not the problem.
- No domain reputation to build — the sender borrows gmail.com's, which Google
  does not extend to outbound cold mail.
- Corporate filters score consumer freemail down on business-to-business mail.
- No DKIM signature under a domain you control, so none of the authentication
  work has anywhere to attach.

It is genuinely the right vehicle for the stage 0 self-test and the first
handful of real sends, while the real domain ages through its 6–8 week clock.
It is not the thing to build the campaign on.

## 5. The 75/day plan

75 messages a day is **three warmed mailboxes at 25 each**, which is the same
number section 2's cost table arrived at from the opposite direction. It is a
coherent target rather than an arbitrary one, and everything below is sized to
it.

### What 75/day actually buys

| | Value |
| --- | --- |
| Messages/day (weekdays only) | 75 |
| Messages/week | 375 |
| Touches per company | 4 |
| **New companies/week** | **~94** |
| **New companies/month** | **~400** |
| Mailboxes needed | 3 |
| Cost | ~₹960/month (Workspace Starter ×3) |

That reaches the original "500 companies" ambition in about five weeks, on
three mailboxes, with a full four-touch sequence behind every one of them —
versus forty mailboxes to do it in two days with a single blast that would
convert at under 1%.

The current contact list holds 1,637 companies, so at ~400/month it is roughly
four months of runway before contact discovery becomes the bottleneck again.

### The ramp — 75/day is a destination, not a starting point

Nothing sends 75 on day one. Two clocks run at once and both must finish:

1. **Domain age.** Microsoft enforces a hard 14-day minimum; a 30–60 day old
   domain outperforms a 7-day-old one by 15–20% on placement after identical
   warmup. Buy the domain first, before any code.
2. **Per-mailbox warmup.** Start at 5/day/mailbox, add ~5 every two to three
   days, reach 25/day/mailbox in about three weeks.

| Week | Per mailbox/day | Total/day |
| --- | --- | --- |
| 1 (warmup only, no real sends) | 5 | 15 |
| 2 | 10–15 | 30–45 |
| 3 | 20 | 60 |
| 4+ | **25** | **75** |

Realistic domain-purchase to steady-75 is **6–8 weeks**. The first two of those
weeks need no code at all, which is why the domain should be bought now
regardless of what gets built.

### The daily schedule

Per mailbox: **5 messages per batch, 5 batches a day, ~2 hours apart.** Three
mailboxes staggered so they never fire together — a synchronised burst across
three senders on the same domain is the pattern this whole design is avoiding.

Non-negotiables, all of them because rigid regularity is itself a spam signal:

- **±15 minutes of jitter on every batch start.**
- **3–8 minutes randomised between individual messages inside a batch.**
- **Stagger the three mailboxes** by ~40 minutes against each other.
- **Weekdays only.** No weekend sends, no overnight sends.
- **First touches preferentially Tuesday–Thursday, 8–10am recipient local
  time**, worth 1–2 points of reply rate.
- **Follow-ups 4–7 days apart**, never daily.
- **A reply stops that contact's sequence immediately**, always.

Hard stops that must be enforced in code rather than trusted to configuration:

- Never exceed 25/day for any single mailbox, counted on a **rolling 24-hour
  window** (not local midnight — that is how the providers count).
- Never send to an address whose verification verdict is not `valid`.
- Never send twice to the same address, ever.
- Halt the entire run if the bounce rate crosses 2%, and do not resume until a
  human looks at it. Above 5%, inbox placement collapses for every recipient,
  not just the bounced ones.

### Getting more emails — where the remaining 87% actually is

The sweep of all 12,988 companies broke down as:

| Outcome | Count | Share |
| --- | --- | --- |
| Usable hit (domain + name match) | 1,637 | 12.6% |
| Rejected — domain did not match the company | 1,601 | 12.3% |
| **No domain found at all** | **9,750** | **75.1%** |

Also worth noting: 260 hits produced no inferable pattern, and 316 hits rest on
a single author, which is thin evidence for a house style.

Ranked by expected yield per unit of work:

1. **Wider org-name candidates over the 9,750 misses.** Only two candidates are
   tried today — the normalised company name and the ATS board token. Adding
   hyphenated forms, `-inc`, `-io`, `-hq`, `-labs`, `-eng`, `-oss`, `-tech`
   suffixes, and GitHub's own org search as a last resort attacks three
   quarters of the corpus. Biggest single lever by a wide margin.
2. **npm and PyPI registries.** Measured working (section 4). npm returns named
   individuals; PyPI mostly team aliases. Reaches companies whose GitHub org is
   named nothing like the company, or who publish packages without a public org
   at all — precisely the population step 1 will still miss.
3. **Deepen the 1,637 known-good orgs.** Only the three most-recently-pushed
   repos are read. Raising that to ten for orgs already known to hit costs
   little and directly fixes the 316 single-author companies and the 260 with
   no pattern.
4. **Re-examine the 1,601 rejections.** Some are real: a company that rebranded,
   a subsidiary mailing under its parent's domain. The cheap discriminator is
   whether the rejected domain's MX and DMARC records look like a real,
   actively-managed corporate mail domain, plus whether more than one author
   shares it. Handle with care — this is the guard that stopped half the raw
   results from being wrong, and loosening it carelessly undoes the sweep's
   main safety property.
5. **Role addresses** (`careers@`, `jobs@`, `hr@`, `talent@`) for any company
   with a confirmed domain but no individuals. Low reply rate, zero risk, and
   the natural floor for whatever the steps above still miss.
6. **GitLab**, same technique against a different host, for the companies that
   self-host or publish there instead.

### What can and cannot be delegated

Steps 1–6 above are bulk mechanical work with objective pass/fail criteria —
exactly the shape that belongs with a cheaper model. They read public APIs,
write to a JSON measurement file, and can be checked by re-running the sweep.

**The sending path must not be delegated, and must not be built by anything
with shell access it does not need.** Specifically, nothing outside this repo's
reviewed code should touch: SMTP credentials, `state/contacted.json`, the
per-mailbox daily counters, or the suppression list. The failure modes there
are not "wrong answer, try again" — they are double-sends to real people,
messages to unverified addresses, and a burnt sending domain that takes weeks
to rebuild. Contact discovery is recoverable; reputation is not.

## 6. Build order

Each stage is independently useful and independently abandonable.

**Stage 0 — send one mail to yourself.** A new `src/outreach.ts` that takes one
job out of `data/jobs.json`, renders a message from a template, and sends it via
the same Gmail SMTP path `hunt.yml` already uses, addressed to the user. Proves
the template and the send path with no new infrastructure and no third party
involved. This is the "test it on my email first" step.

**Stages 1 and 2 are built and live-verified as of 2026-08-21.** See
`src/verify-email.ts` and `src/contacts.ts`, plus their cases in
`src/selftest.ts` (`npm test`). Run them with `npm run verify -- addr@company.com`
and `npm run contacts -- razorpay meesho`. Measured behaviour:

| Probe | Result |
| --- | --- |
| `manish.soni@razorpay.com` (real, Google Workspace) | `valid` |
| `definitely-not-a-real-person-8821@razorpay.com` | `invalid` — Google's own `550 5.1.1 NoSuchUser` |
| `nobody-here-4471@swiggy.in` (Mimecast) | `unknown` — gateway rejection is not conclusive |
| `nobody-here-4471@atlassian.com` (Proofpoint) | `unknown` — control probe proved the domain catch-all |
| `someone@nonexistent-domain-xyzzy-991.com` | `invalid` — no MX |

Every one of the three states is reachable against real mail servers, and the
two `unknown` cases are exactly the ones a two-state verifier would have
reported as `invalid` and been wrong about.

`contacts.ts` against four orgs returned `razorpay.com`/`first.last` (22
authors), `meesho.com`/`first.last` (15), `swiggy.in`/`first.last` (11),
`zomato.com`/`first.last` (15), and correctly returned nothing for `groww`.
Zomato is the case that justifies the majority tally: it mixes `first.last`
(`anshul.goyal@`) with `last.first` (`chhabra.kunal@`, from "Kunal Chhabra"),
so a single sample would have picked the wrong house style. Many commit author
names are GitHub handles rather than real names (`rajesh-meesho`,
`amit-shekhar`); those simply fail to infer a pattern and drop out of the
tally instead of corrupting it.

One implementation note worth keeping: `resolveMx` talks to the nameserver on
port 53 directly, which some networks block outright even where ordinary
socket connects work (`dns.lookup` goes through the OS instead). The verifier
falls back to DNS-over-HTTPS when the system resolver is unreachable — added
because it actually failed that way during development, not speculatively.

**Stage 1 — the verifier.** `src/verify-email.ts`: `resolveMx` from
`dns/promises`, then a `net` socket doing `HELO` / `MAIL FROM` / `RCPT TO`.
Returns `valid | invalid | unknown`. Two rules make it honest rather than
decorative: probe a deliberately absurd local part at the same domain first and
mark the whole domain `unknown` if that is accepted (catch-all detection), and
force `unknown` for any MX belonging to a provider known to answer unreliably —
Microsoft 365 above all, plus the enterprise gateways. No dependencies. Runs
**locally, not in CI**, because Azure blocks outbound port 25 and GitHub-hosted
runners are Azure; port 25 is confirmed open from the user's own machine. Gets
a case in `src/selftest.ts` — the provider-classification and catch-all
branches especially, since those are the parts that would silently start lying
if they broke.

**Stage 2 — contact discovery.** `src/contacts.ts`, starting with the git
source alone: resolve a company to a GitHub org, pull recent commit authors,
filter out `users.noreply.github.com` and consumer freemail, and derive the
domain plus the address pattern. Authenticate with `GITHUB_TOKEN` for the
5,000/hour limit. That single source covered 12 of 15 companies in testing, so
build it, measure it against a real slice of `companies.json`, and only add the
next rung for whatever it misses. Do not build all eight.

**Stage 3 — sending infrastructure.** New domain, mailbox, SPF/DKIM/DMARC, and
the warmup ramp. Roughly a month of calendar time at low volume, mostly waiting.
Worth starting early precisely because it is the slow part.

**Stage 4 — the sequence, not the blast.** This is where the follow-up logic
lives, and it is the stage that determines whether any of the rest was worth
building. `state/contacted.json` stops being a suppression list and becomes a
small state machine: per contact, which touch they are on, when the last one
went, and whether they replied (a reply stops the sequence immediately, always).
Four touches over two to three weeks. Every day's send queue is a mix of first
touches and follow-ups due today, capped at the mailbox limit, with follow-ups
taking priority over new contacts when the cap binds — they are the ones that
produce 42% of the replies.

**Stage 5 — schedule it.** A new `.github/workflows/outreach.yml` on a daily
cron, reusing the existing SMTP secrets pattern but with a different sending
identity. It only sends: contact discovery and verification ran locally in
stages 1–2 and committed their output, because CI cannot do port 25.

**Stage 6 — measure.** Reply rate is the only metric that matters, and there
are now real numbers to measure against (section 2's message-quality figures).
If it lands under 3%, the message or the targeting is wrong; adding volume will
make it worse, not better.

## 7. Legal and etiquette baseline

Job-seeker outreach to a named person at a company is about the least
objectionable form of cold email there is, and India has no strict opt-in
regime. Recipients are global, though, so the cheap safeguards are worth taking
regardless: a real name and physical location in the signature, an honest
subject line, a one-line opt-out ("tell me to stop and I will"), and honouring
it immediately via the suppression list. These cost nothing and are also, not
coincidentally, what keeps a domain off blocklists.

## 8. Open decisions

- **Cadence.** The research turned this from "twice a day or every second day"
  into a different question: both readings cost 40–160 mailboxes once follow-ups
  are counted, and both underperform 500 companies spread over a month on three
  mailboxes. The open question is whether to accept the month-long spread.
- **Does GitHub Actions actually block port 25?** Inferred from Azure's
  documented default, not tested. One throwaway workflow settles it, and the
  answer decides whether verification can ever live in CI.
- **Build or buy the contact layer.** FindHR at $59.99/month covers 45
  companies with no code at all. Below roughly fifty companies a month that is
  the cheaper answer and this feature should not be built; the case for
  building only opens up at the hundreds-per-month scale originally asked for.
  Worth spending the free tier's two lookups on a real target first, to see
  what "verified hiring manager" actually returns.
- **How many people per company.** The git source typically returns 10–16
  distinct addresses at a company, not one. Mailing all of them is how a
  targeted approach becomes a spam campaign; one or two per company, chosen
  for relevance to the open role, is the version that works.
- **Sending identity** — new domain plus a paid mailbox, versus staying on the
  existing Gmail at low volume. Anything free and web-only (Zoho's free tier)
  is unusable, because the workflow needs SMTP.
- **Whether to depend on `api.applybolt.app` at all**, once its backend is up
  and its real rate limit has been measured. It solves the hardest part of the
  problem for free, and it can vanish without notice; both of those are true at
  the same time.
