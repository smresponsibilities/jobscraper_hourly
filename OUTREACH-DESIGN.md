# Outreach design — hybrid sending and variation rules

Companion to `COLDMAIL-PLAN.md`. That document covers why contact discovery and
verification work and what the deliverability physics are; this covers the two
design questions that remained open: **who presses send** (a mix of you and the
tool) and **how different each message must be** from the last one so that
neither a spam filter nor the recipient reads it as a mass mailing.

Everything here is sized for the actual target: 15–25 cold messages a day on a
single free Gmail account with an app password, weekdays only, India-time
mornings. Not the 500-company fleet scenario — that version lives in
`COLDMAIL-PLAN.md` §5 and stays there until replies justify paying for
mailboxes.

---

## 1. The mixture model: some sends by the tool, some by hand

### One mailbox carries both

Manual and automated sends go out through the **same second Gmail account**
(never the alert inbox that receives the hourly digest). This is deliberate,
not laziness:

- A mailbox whose entire history is outbound cold first-touches has no
  engagement signal at all. Filters read that as bulk infrastructure.
- A mailbox that also *receives* replies, holds real threads, forwards things,
  and sends occasional ordinary mail looks like a person's working inbox —
  which is exactly what we want the filter to conclude.
- Hand-written mail to your top targets produces those threads naturally. The
  automation benefits from reputation the manual side earns.

The cost of sharing one mailbox is a shared budget, handled below.

### Three tiers, three lanes

| Tier | Who writes | Who sends | Volume |
| --- | --- | --- | --- |
| **A — dream targets** | You, by hand, from the tool's research brief | You, manually | 1–3/day |
| **B — long tail** | The tool, from templates + per-contact facts | The tool, after review | ≤12/day |
| **C — role addresses** | The tool | The tool | remainder of budget |

Tier A exists because personal effort is not evenly distributable: a bespoke
note to a Graviton researcher or an Optiver quant is worth more than twelve
templated ones. The tool's job for tier A is only to assemble the brief — who
the person is, what they shipped recently, which role just opened — so writing
the mail costs you five minutes instead of thirty.

### The shared daily budget

Providers count on a rolling 24-hour window, so both lanes draw down one
counter:

- Total cap while ramping: **20/day/mailbox**, rising toward 25 only after
  several clean weeks.
- Automation self-caps at **12/day** regardless of remaining headroom.
- Manual sends must be logged (`npm run outreach -- --sent-manual <addr>`) so
  the counter stays honest. An unlogged manual send plus a full automation day
  is how an account crosses the behavioural line without anything erroring.

### Draft-first is the default state

**Decision: manual-first is now the *primary* mode, not just a default.**
The tool generates each day's ready-to-send batch; the human presses send.
Rationale: brands run sequencers because they push thousands of messages
through dozens of mailboxes — automation there is a volume necessity. At
15–25/day, hand-sending is strictly better: zero automation fingerprint,
human pacing for free, replies handled natively. (FindHR reached the same
shape commercially: find the contacts, "you write it, you send it.") The
SMTP `--send` path drops from required to optional-later; what survives of
the state machine is suppression (never hand you a contact twice) and the
follow-up queue (which touches are due today).

Concretely, the daily output is:

```
out/outbox/2026-08-23/
  01-first-touch-rakshit-shetty-zerodha.txt   subject + body, copy-paste ready
  02-followup-touch3-...                      due follow-ups mixed in
  ...
```

Each file also carries its research brief (the {fact} candidates) at the top,
below a cut line, so tweaking a sentence needs no extra lookup. Pasting and
sending one runs ~30–45 seconds; fifteen a day is ten minutes. Nothing sends
without a preview step.

---

## 2. What actually gets mail flagged

Research across 2026 practitioner sources converges on this ordering. It is
not the ordering most people assume — wording is near the bottom.

1. **Authentication and domain reputation dominate.** SPF, DKIM, DMARC;
   Microsoft actively rejects unauthenticated high-volume mail (550 5.7.15);
   authenticated senders are roughly 2.7× more likely to reach the inbox. On a
   free Gmail account this layer is borrowed from google.com and is fine at
   low volume — it is also why free Gmail cannot scale later, and why the
   custom-domain path exists as the stage-3 upgrade.
2. **Velocity and ramp.** A new mailbox jumping to 50/day flags within days.
   Ramp 5→10→15 over weeks; never double day-over-day.
3. **Engagement history.** Reply rate is the long-term decider. Google moved
   from soft deferrals to hard rejections in Nov 2025; spam-complaint ceiling
   is effectively **0.10%**; bounces above **2%** poison the mailbox. This is
   why verification-before-send and reply-stops-sequence are enforced in code,
   not left to discipline.
4. **Content fingerprinting.** Providers fuzzy-hash bodies; *hundreds* of
   near-identical messages from one sender read as a mass-mail signature. At
   15–25/day this signal barely registers — but defeating it is essentially
   free (§3), so we do anyway.
5. **Content red flags.** Tracking pixels, attachments on first touch, more
   than a link or two, HTML stationery. All avoidable by construction.

Two negative findings worth recording so nobody reintroduces them:

- **Aggressive spintax backfires.** Spinning function words produces stilted,
  low-coherence text that ML filters specifically flag as machine-generated.
  Practitioner guidance caps spin groups at 2–4 options each and says plainly:
  below a few hundred sends per day, spintax adds nothing.
- **Unedited AI copy measurably fails** — one 2026 analysis measured reply
  rates down ~34% for campaigns sending raw AI-generated text. Recipients
  recognize statistical-average prose. The {fact} hook (below) exists precisely
  because it cannot come from a language model's priors; it comes from the
  contact's own artifact.

---

## 3. Minimum-change criteria: how different each mail must be

There is no published Google/Outlook threshold — filters do not disclose their
similarity math. What follows is the consensus floor, expressed as rules the
renderer enforces rather than advice it hopes you follow.

### Must differ per recipient

| Field | How it varies | Cost |
| --- | --- | --- |
| Subject | Contains company + role fragment (`quick question re: {title}`) | zero — merge field |
| First sentence | The `{fact}` hook: one true thing about *their* recent work — last commit subject, package release note, app changelog entry, talk title | one lookup per contact, already available from Goal-A sources |
| Greeting | Pool of 3–4 (`Hi {first}` / `Hello {first}` / …) | written once |
| Closer | Pool of 3–4 sign-off lines | written once |
| Ask | 2–3 phrasings of the one-line question | written once |

That's the whole list. With these five slots varying, two rendered messages
share well under half their tokens and have different fuzzy hashes by
construction. Nothing else needs to change.

### Deliberately constant

- **Your signature block.** Real people have stable signatures; a rotating
  signature is its own tell. Keep name, course+college, city, one link max.
- Overall structure and length band (60–110 words).
- The opt-out line ("tell me to stop and I will") — constant because it is
  also the etiquette/legal baseline from §7 of the old plan.

### Never

- Attachments on touch one. Resume goes only when asked ("want my resume?
  say sure" — the reply-coupon pattern does the asking for them).
- More than one link.
- Tracking pixels/open-receiver images. They buy nothing at this scale and
  are a top content red flag.
- Synonym-spun filler sentences.
- Byte-identical or near-identical bodies across contacts inside a rolling
  week. The renderer enforces this mechanically: shingle-similarity check of
  each rendered draft against the last N sent bodies, hard-block above ~80%
  similarity. The number is a rule of thumb, not a documented provider limit —
  the point is that hitting it should be impossible given §"must differ".

### The honest summary

> Subject differs, first sentence differs, greeting/closer rotate, everything
> else stays constant on purpose. At fifteen messages a day that is more
> variation than filters ever see from a single sender — and every varying part
> varies because it is *true*, not because syntax shuffled it.

---

## 4. Template anatomy (what old-school craft survives translation)

Each principle earned its place by being measurable in its original medium;
none is decoration.

- **Plain text only** — Halbert's A-pile test: personal-looking letters get
  opened; corporate-looking ones get trashed unread. No logo, no footer image,
  no colors. If it looks pasted from Outlook stationery it dies in preview.
- **One true fact up front** — the Coat-of-Arms letter's mechanism: deep
  personalization on a cheap-to-produce variable. Ours is machine-fillable.
  Fact sources, in priority order: (1) the contact's own git commit subject
  and repo — `contacts.ts` already fetches these messages and currently
  discards them; keying latest non-trivial commit by author email is a small
  change; (2) their package's latest npm/PyPI release note; (3) their app's
  Play Store changelog entry; (4) a conference talk or arXiv paper title;
  (5) company-level launch news as a last resort — weaker because every
  recipient at that company shares it, so it may be used for **one** person
  per company, never several. Artifacts older than ~90 days lose to fresher
  candidates. A contact with no findable fact is skipped entirely — the rule
  is *no fact, no mail*, because a generic opener both reads as spam and
  collides with whatever other factless draft went out that week.
- **Reply coupon close** — direct mail's stamped self-addressed envelope: make
  responding cost one word. "Is this req open to 0–3 yrs? y/n."
- **Pass-along line** — chain-letter routing: "if this isn't yours, who
  should it go to?" converts silent non-repliers into forwarders.
- **Advice before ask** — Bolles' informational-interview opener for senior
  contacts: touch one requests judgment about the role market, never the
  referral. The referral ask rides touch three, after any reply.
- **The trigger is ours alone** — the hourly hunt knows an India-matching role
  went live *hours* ago. "Reason to respond now" is the highest-value line in
  direct-mail practice, and we generate it automatically.

Sequence shape: four touches over two–three weeks, follow-ups carry new
information each time (never "bumping this"), any reply halts the sequence
permanently, pass-along answers route to a fresh thread with the new contact.

---

## 5. Implementation mapping

```
src/outreach.ts        renderer + queue builder (default mode)
  --draft              render today's batch to out/outbox/, no network        [default]
  --send               SMTP-execute lane-B/C items under the shared cap
  --sent-manual <addr> log a hand-sent tier-A mail against the same window
  --replied <addr>     mark replied; halt that contact's sequence
  --fact <org>         print the tier-A research brief for a dream target
state/contacted.json   { addr, company, jobId, lane, touch, lastSentAt,
                         replied, source, confidence }
out/outbox/*.eml       previews; deleting a file = cancelling that send
config.ts              OUTREACH_DAILY_CAP (20), OUTREACH_AUTO_CAP (12),
                       OUTREACH_JITTER_MIN (±15 batch / 3–8 between),
                       OUTREACH_SEND_WINDOW_IST ("08:00-11:30"), WEEKDAYS_ONLY
sender                 raw TLS socket, port 465, app-password auth —
                       same plumbing verify-email.ts already proves works;
                       runs locally now, moves to Actions cron unchanged
                       (only port 25 is blocked there, submission ports aren't)
selftest.ts            similarity guard blocks >80% twin drafts; cap arithmetic
                       across lanes shares one window; reply halts sequence;
                       jitter never collapses two batches together
```

Build order stands as agreed: sender first (B2) so drafts flow end-to-end,
then waterfall sources (A1/A3) to feed it, then the sequence state machine
(B3).

## 6. What spam filtering actually is (deep dive)

Gmail alone runs a four-layer stack over billions of mails daily (TensorFlow-
based models plus Google's own SpamBrain lineage). Outlook differs mainly in
weighting IP reputation higher than engagement. The layers, in check order:

1. **Protocol layer** — SPF (is this server allowed?), DKIM (is the message
   cryptographically signed by the domain?), DMARC (do both align with the
   visible From?), valid PTR/rDNS, TLS. Since Nov 2025 Gmail *rejects*
   non-compliant bulk senders at SMTP time rather than filtering them.
2. **Reputation layer** — domain reputation dominates IP reputation (IPs
   rotate; domains carry history). Built from complaint rates, spam-trap
   hits, and long-run behaviour of every message the domain ever sent.
3. **Content model layer** — transformer classifiers compare the message
   against statistical models of user-approved mail: subject shape,
   salutation style, link pattern, attachment type, HTML structure, header
   formatting. This is the layer people imagine when they say "spam words" —
   in reality no fixed word list decides anything.
4. **Engagement loop — the decisive layer.** Every recipient action trains
   the classifier: reply and read push future deliverability up; delete-
   unread drags it down; "report spam" from even one recipient poisons
   delivery to statistically similar recipients. Practitioner consensus:
   replies are the single strongest positive signal that exists.

The practical consequence: **content variation is a rounding error next to
the engagement loop.** A slightly-repetitive mail that gets replies will
outdeliver a perfectly-spun template that gets silence. Which is why this
design optimizes for the {fact} hook and a one-word-replyable ask rather than
for synonym shuffling.

### Volume decision (updated: two lanes, 100 first-touches)

Target is **up to 200 touches/day** at full tilt, composed as:

| Component | Count |
| --- | --- |
| New first-touches — **triggered lane** (role opened ≤7 days) | ≤50 |
| New first-touches — **random lane** (open roles, daily rotation) | ≤50 |
| Follow-ups due that morning | remainder up to `OUTREACH_DAILY` (default 100 cards/page) |

The lanes exist because they have different jobs: the triggered lane rides
the hourly-fresh trigger worth 15–25% reply rates; the random lane keeps
volume up against the whole catalogue and accepts lower per-mail rates.
Both draw from companies with an open India-matching role so every mail's
"you're hiring X" stays true. Ramp still applies (start ~20 total, double no
faster than weekly). Standing guardrail: if replies drop under ~10% of sends,
hold flat and fix targeting. Per-company pacing is deliberately NOT enforced
(owner decision): dedupe is by address only, a company may re-enter the pool
for each new job opening.

### Micro-checklist (per-mail hygiene beyond §3's variation rules)

- Touch 1 carries **no link**. The job URL appears only where it is the
  direct subject of the question, ideally touch 2+. Links are the loudest
  content red flag short of attachments.
- Subject reads like internal mail: lower-case-ish, plain, specific
  (`quick question re: sde ii req`). Never caps, never emoji, never
  "exciting opportunity".
- Banned vocabulary class: urgent / guaranteed / free / offer /
  dear candidate / respected sir-madam openers. These are what the content
  model was literally trained to catch.
- One recipient per mail. Same-company same-day sends are allowed (owner
  call), but hooks must differ per recipient or the similarity guard drops
  the twin — colleagues who compare inboxes should see research, not a blast.
- Follow-ups continue the **same thread** (reply to your own sent mail).
  Threading preserves context and inherits whatever engagement the earlier
  touch earned; a fresh thread per touch reads as a campaign.
- From-name and signature constant forever (§3). Resume attaches only when
  asked; the reply-coupon line does the asking.
- Sends inside recipient business hours; nothing at midnight, nothing
  Sunday. Manual sending satisfies this by default.

## 7. Review page (local, not deployed)

The drafts page is a **generated local file**, not part of the deployed web
UI: `npm run outreach -- --page` writes `out/outbox/<date>.html`, opened as a
file. Deliberately not on `jobscraper-hourly.vercel.app` — the public site
reads the `data` branch and must never learn which humans you are mailing;
targets and drafts are private state.

Page contents: one card per draft in send order (follow-ups due today mixed
with first-touches), each card showing To / Subject / Body with a
copy-to-clipboard button per field, the research brief collapsed behind the
cut line, and a checkbox whose done-state persists in `localStorage`. Zero
backend, zero network calls after load — the page is static text plus inline
JS small enough to stay reviewable.

### Click-to-send and follow-up maintenance (serve mode)

The review page runs from a **localhost server**, not a bare file, so that
clicking can both open the mail app *and* record what happened:

```
npm run outreach -- --serve     → http://localhost:7700
```

Each card carries two buttons:

- **Gmail** — opens `https://mail.google.com/mail/?view=cm&fs=1&to=…&su=…&body=…`
  with subject/body pre-filled and URL-encoded; works for any signed-in Gmail,
  no OS mail-handler setup.
- **Mail app** — plain `mailto:` link for users whose default client is set.

Clicking either also fires `POST /sent` for that draft id, which advances its
state machine in `contacted.json`: touch count +1, `nextDueAt` set to day
+4/+5/+7 per touch, and at touch 4 the contact closes. A **Not sending**
button suppresses permanently (bad fit, wrong person). Replies are marked by
one click on the card (`POST /replied`) — or auto-detected later via IMAP if
ever wired — which halts that sequence immediately.

Every morning `--serve` regenerates today's page as: due follow-ups sorted by
overdueness, then new first-touches up to the daily budget, each already
carrying its {fact} hook. Missed days simply roll forward — overdue follow-
ups surface first, new-contact count shrinks to keep the 50/day ceiling.
Suppression guarantees a contact never appears twice in one batch, and the
similarity guard (§3) runs across the whole rendered batch before the page
serves, not per-card.


---

## 8. Sending infrastructure: what to buy, from where, and when

### What practitioners ("brands") actually run

The agency stack, from teardowns and vendor docs: several **lookalike root
domains** bought purely for sending (never the brand's main domain), two to
three mailboxes on each, hosted on Google Workspace or Microsoft 365 — or on
budget bulk-mailbox hosts built for exactly this trade (Mailforge/Primeforge
at roughly $2–3 per mailbox per month, or flat-rate multi-domain hosts). A
sequencer (Instantly/Smartlead) rotates across the fleet at 25–30 messages per
mailbox per day, warmup pools run continuously, and domains are retired every
6–9 months because that is roughly their lifespan before replacement is
cheaper than rehabilitation.

The relevant takeaway for a single-sender operation is not the fleet but the
*shape*: sending lives on a **disposable root domain**, never on anything
whose loss would hurt. That is why the answer to "subdomain or domain?" is:

### Subdomain vs. root domain

A subdomain (`hi.yourportfolio.dev`) is the right call **only if a root domain
already exists and is worth protecting** — it costs nothing extra, takes its
own SPF/DKIM/DMARC records, and works fine for phase one. Its weakness:
reputation associations can bleed toward the parent, so a burn is not fully
contained. Practitioners buy *separate roots* precisely because containment
requires a separate registrable domain.

For this project: there is no existing domain, so the choice is free anyway.
Buy one cheap fresh root. It gets full isolation, its own clean domain-age
clock (the 6–8 week gate from `COLDMAIL-PLAN.md` §2 starts at purchase, which
is also the argument for buying early even while phase zero runs on free
Gmail).

### Where to buy

| Registrar | Why | Watch out |
| --- | --- | --- |
| **Cloudflare Registrar** | at-cost pricing, zero markup/renewal games, DNS+CDN included | must use Cloudflare nameservers |
| **Porkbun** | near-at-cost, clean UI, free WHOIS privacy | none significant |
| Namecheap / Hostinger / BigRock | heavy first-year promos (₹199–499 common) | renewal price often 2–3× the promo |

Avoid GoDaddy-style renewal traps: the promo price is not the price. `.com`
lands around **₹850–950/yr at-cost** via Cloudflare/Porkbun; `.in` and
`.dev` variants land cheaper on Indian-registrar promos but renew higher.
Whichever TLD: enable auto-renew, WHOIS privacy on, nothing else needed.

### Mailbox provider comparison (2026 prices, INR)

| Path | Cost | SMTP? | Verdict |
| --- | --- | --- | --- |
| Second free Gmail + app password | ₹0 | yes | phase zero only; freemail penalty at corporate filters |
| **Purelymail** | **$10/yr flat (~₹73/mo)**, unlimited users/domains, fair use | yes | cheapest real custom-domain SMTP |
| **Zoho Mail Lite** | **₹90/user/mo** (annual billing) | yes (IMAP/POP/SMTP) | cheapest mainstream; Chennai company, India DCs |
| Google Workspace **Base** | ₹99/user/mo (India-only plan) | yes | best inbox-deliverability reputation; gmail-compatible |
| Workspace Starter | ₹270+GST ≈ ₹319/mo | yes | only needed for the 2,000/day mechanical cap — irrelevant here |
| Zoho Mail **Free** | ₹0 | **no** — web-only | unusable for automation, confirmed unchanged |
| iCloud+ custom domain | ₹75/mo | limited/app-specific | odd fit, skip |

Practitioner preference ranks Workspace highest for cold-mail deliverability,
but at 15–25/day the difference between Workspace Base, Zoho Lite and
Purelymail is marginal. Note Workspace's own gates: trial accounts cap at
500/day and full limits arrive with account age and accumulated spend —
budget a ramp regardless of provider.

### Which domain (TLD comparison)

The TLD itself is a minor ranking factor next to authentication and
reputation — but cheap-spam-TLD association is real, and the price spread is
large enough to matter annually.

| TLD | Realistic cost/yr | Cold-mail fit | Notes |
| --- | --- | --- | --- |
| **`.com`** | ₹850–950 at-cost | best | default choice, zero perception downside |
| **`.dev`** | ~₹1,000–1,250 | excellent *for this user* | reads "engineer"; HTTPS enforced by registry |
| **`.in`** | ₹199–399 promo, ~₹700 renew | very good for India targets | recipients see a local domain |
| `.me` | ₹700–1,000 | fine | personal-brand friendly |
| `.io` | ₹2,800+ | fine but overpriced | pay for a fashion statement, nothing more |
| `.xyz` / `.online` / `.site` / `.top` | ₹99–200 promo | **avoid** | heavily abused TLDs; filters weight them down |

**What name to register matters more than which TLD:** agencies register
*lookalike* domains because they impersonate companies. A job-seeker should do
the opposite — register **their own name** (`firstname-lastname.com`,
`firstnamelast.dev`). It is credible to a recruiter in a way no lookalike can
be, it doubles as the portfolio URL in the mail signature, and burning it is
survivable because the fallback is just… buying another ₹900 domain.

### Setup checklist once the domain exists

1. **DNS ready** — on Cloudflare Registrar this is automatic; elsewhere,
   accept the registrar's default nameservers.
2. **Pick the mailbox provider** (Zoho Mail Lite / Purelymail / Workspace
   Base per §7's table) and add the domain there; provider gives a **TXT
   verification record** — paste it in DNS, wait for propagation.
3. **MX records** — replace defaults with the provider's (e.g.
   `mx.zoho.com` pair, or `aspmx.l.google.com` set).
4. **SPF** — one TXT record at the apex:
   `v=spf1 include:zohomail.in ~all` (or `include:_spf.google.com ~all`).
   Exactly one SPF record may exist; multiple invalidate all of them.
5. **DKIM** — generate the keypair inside the provider console, publish the
   selector+CNAME/TXT it shows. This is the record that actually carries
   signing reputation; do not skip it the way most solo senders do.
6. **DMARC** — `_dmarc` TXT:
   `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain` — start at `p=none`
   (monitor-only), move toward `quarantine` after two clean weeks.
7. **Create the mailbox** — plain personal identity,
   `firstname@firstname-lastname.tld`. Enable app passwords / generate SMTP
   credentials; these are what `outreach.ts` consumes.
8. **Warm up before any automation**: 2–4 weeks of genuine correspondence —
   subscribe to things with it, write real mails, get replies. Volume ramp
   follows §2's velocity rules (start 5/day, never double day-over-day).
9. **Point the sender at it** — SMTP host/port/creds into env vars;
   `verify-email.ts` already proves the socket path works against port 25,
   and submission (465) works everywhere including Actions.
10. **Optional but high-value**: put a one-page résumé/portfolio at the root
    of the domain and use that URL as the signature's single link. The
    recipient who checks "who is this person" finds exactly what you want
    them to find, on the same domain that sent the mail.
11. **Later, past ~50 sends/day**: register the domain in Google Postmaster
    Tools v2 for placement/compliance dashboards. Skip BIMI/VMC entirely —
    requires a registered trademark, pure enterprise flex.

### Recommended sequence

**Provider decision (recorded): Google Workspace Base, ₹99/user/mo.**
Rationale: measured earlier that ~81% of the target companies sit on Google
Workspace themselves, so Gmail-infra → Gmail-infra delivery is the strongest
single alignment available; setup (SPF/DKIM/DMARC) is the best documented of
the three candidates; Postmaster Tools plugs in natively later. Zoho Mail
Lite (₹90) is the fallback if Workspace's India-only Base plan proves fussy
at signup; Purelymail ($10/yr) is the ultra-budget option with solo-operator
risk. The ₹9/month spread between the top two is noise against what's being
decided.

**Volume plan on one aged mailbox (`sm.com` example):**

| Phase | Calendar | Sends/day | Notes |
| --- | --- | --- | --- |
| Warmup | weeks 0–4 | 0 cold, real correspondence only | no automation yet |
| Ramp | weeks 5–8 | 5 → 10 → 15 → 20 | never double day-over-day; bounce <2%, complaints ~0 |
| Steady | week 9+ | **20–25**, hard code-cap 30 | mechanical cap (2,000) never binds; behavioural does |

At 20/day weekdays with four touches per company: roughly **25 new companies
per week**, ~100/month, on one ₹99 mailbox. Tier-A hand-written mails draw
from the same window (§1).

Concrete bring-up for `sm.com`:

1. Workspace signup → verify domain via the TXT record it shows.
2. MX → `aspmx.l.google.com` set (Workspace prints exact values).
3. SPF apex TXT: `v=spf1 include:_spf.google.com ~all` (only record).
4. DKIM: generate in Admin console → publish `google._domainkey` TXT.
5. DMARC: `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:dmarc@sm.com`.
6. Mailbox `hello@sm.com`, enable 2FA, create app password → env vars for
   the sender. Portfolio one-pager at `https://sm.com`.
7. Four weeks of genuine correspondence, then the ramp table above.

8. **Now (₹0):** phase zero on a second free Gmail + app password, per §1.
9. **Buy the domain immediately after committing** (~₹900/yr): the age clock
   runs whether or not mail flows yet. Point it nowhere harmful meanwhile.
10. **When replies justify it (~month 2–3):** attach the domain to Zoho Mail
    Lite (₹90/mo) or Purelymail (flat), create one mailbox
    (`firstname@domain`), add SPF include, DKIM keys, DMARC `p=none` with
    reporting, then start the 2–4 week warmup ramp from §2's velocity rules
    before any automated volume moves over. Total steady-state: **~₹160–170/mo
    including the domain**, versus $59.99 for FindHR's 45 lookups alone.

---

## 9. Failure modes this design pre-empts

- **"No email arrived"** → impossible-by-default: every draft exists as a
  file in `outbox/` before a human ever sees it, mirroring the lesson learned
  with `new_count` gating the alert email.
- **Double-send / re-targeting** → suppression keyed by address in
  `contacted.json`; the generator never hands you the same contact twice.
  The file commits like `outage.json`, treated as durable state.
- **Silent reputation burn** → at manual volume this collapses into §6's
  engagement loop: reply rate *is* the monitor. If a week passes under ~3%
  replies, pause and fix targeting, not volume.
- **Template drift** → similarity guard makes shipping a near-twin draft
  structurally impossible rather than a review-time judgement call.
