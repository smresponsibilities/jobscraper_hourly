# Using this

The other docs in this repo (`README.md`, `ARCHITECTURE.md`, `HANDOFF.md`) are
written for whoever's maintaining the code — a future you, or an AI session
picking the project back up. This one's for whoever's actually *using* the
tool day to day: reading the emails, checking the site, deciding whether a
company should be added. No code required for any of it.

## The two ways you see it

**Email.** Runs every ~20 minutes; you only ever get mail when something
genuinely new shows up. Each email has two parts:

- **Full cards** at the top — the first 25 matches, each with title, company,
  location, years required, and a direct apply link.
- **A backlog section** below — everything else as compact one-liners. This
  exists because "new to the tracker" and "newly posted" aren't the same
  thing (adding a company can make its whole back-catalogue look brand new at
  once); the backlog holds roles you're not getting an early-mover edge on
  anymore, without just deleting them.

If a run finds nothing new, no email arrives — silence is the expected,
common case, not a sign something's broken.

**The web dashboard**, once deployed (see `README.md`'s Setup section if it
isn't yet). It shows every open match, live, and refreshes on its own — you
never need to redeploy it for new jobs to show up. On the page you can:

- Search by keyword
- Filter by max years of experience
- Filter by industry (tech / fintech / banking / consulting / quant)
- Toggle "internships only"
- Toggle whether closed/expired roles are shown
- Filter to one company

There's also an **"Add a company"** box on the page — paste a careers URL in
and it resolves the board and counts open roles right in your browser, no
backend involved, for Greenhouse/Lever/Ashby/SmartRecruiters boards. If it
works, the company gets added the next time someone reviews the request.

## Tuning what you get

Everything adjustable lives in `src/config.ts`. You don't need to understand
the surrounding code to change these — each is one line, in plain English:

| Setting | What it does | Current value |
|---|---|---|
| `MAX_YEARS` | Roles asking for more than this many years get filtered out. Roles that don't state a year requirement are always kept. | 3 |
| `INCLUDE_INTERNSHIPS` | Whether internship postings count alongside full-time roles. | on |
| `EMAIL_FRESHNESS_DAYS` | How old a posting can be and still show up in the "full card" section instead of the backlog. | 21 days |
| `EMAIL_DETAIL_LIMIT` | How many roles get a full card before the rest become one-liners. | 25 |
| `INDIA` (the city list) | Which Indian cities count as a location match. Add a city here if a real role is being missed because of a city not on the list. | ~28 cities |
| `REMOTE` | Which words in a location count as "remote" (`remote`, `WFH`, `distributed`, ...). | — |
| `ROLE_FAMILIES` | The keyword groups that decide whether a title is SWE / Data / Finance / Product / Design / Security work at all, before seniority is even checked. | 6 families |
| `SERVICE_COMPANIES` | The exclusion list/pattern for IT-services and BPO firms (TCS, Infosys, Wipro, Cognizant, Accenture, and the category they represent) — a deliberate choice, not an oversight. | — |

If you want a role family widened (e.g. a title style you know is real but
isn't showing up), that's a one-line regex edit in `ROLE_FAMILIES` — hand it
to whoever's maintaining the code with a couple of example titles that are
being missed.

## Adding a company you personally care about

Three ways, easiest first:

1. **The web dashboard's "Add a company" box** — paste the careers URL,
   works instantly for Greenhouse/Lever/Ashby/SmartRecruiters boards.
2. **The fastest way to help, for anything else**: open the company's
   careers page, press F12, go to the Network tab, reload the page, and look
   for a request that returns job titles in its response. Copy that URL and
   hand it over — that single step is what's turned companies like Cisco and
   Microsoft into hundreds of real India postings. Full detail in
   `ADDING-COMPANIES.md`.
3. **Just ask** — say the company name and someone (a maintainer, or an AI
   session working the repo) will research it and, if a real board exists,
   add it.

Boards that stop responding for 3 straight days get dropped automatically —
so a company disappearing from the list usually means its board genuinely
went dark, not that it was deliberately removed.

## If something looks wrong

**No email in days, even though you'd expect a match somewhere.** Check the
repo's Actions tab — the `hunt` workflow should show recent green runs every
~20 minutes. If runs are failing, that's the first thing to look at. If runs
are succeeding but genuinely finding nothing, check the web dashboard — if
it's also quiet, there's likely nothing new right now, not a bug.

**A specific company you know is hiring isn't showing up.** Either the
company isn't tracked yet (see above), or a real role is being filtered out
by one of the settings above — the years cutoff, the role-family keywords,
or the seniority wording. `npm run debug -- "Company Name"` (for whoever has
the code checked out) shows every role from that one board and exactly why
each one passed or failed.

**You see a GitHub issue open automatically, titled "Suspected outage:
<platform>".** This means most boards on one ATS platform failed to respond
in the same run — almost always a temporary block, not real companies going
dark all at once. Nothing is being evicted while this holds. It closes
itself automatically the moment a run stops seeing the failure.

**A duplicate-looking listing.** Some employers post the identical role
under 2-3 different requisition IDs (Amazon does this often) — these get
collapsed into one entry automatically. If you're seeing a genuine duplicate
that wasn't collapsed, it's worth flagging; it usually means two different
company display names are pointing at what's actually the same board.

## Running it yourself, without touching code

From the repo's **Actions** tab on GitHub:

- **hunt** → *Run workflow* — triggers an immediate poll right now, instead
  of waiting for the next scheduled run. Tick the "test email" box to get an
  email showing *everything* currently matching, regardless of freshness —
  useful the first time, or any time you want a full snapshot rather than
  just what's new.
- **discover-news** → *Run workflow* — triggers an immediate sweep of
  startup-funding headlines for newly-funded companies worth tracking.

Neither needs anything installed locally.

## Going further

- **`README.md`** — setup, the full list of ATS platforms supported, and
  local commands, if you want to run this on your own machine.
- **`ARCHITECTURE.md`** — how the whole pipeline actually works, for anyone
  curious rather than just using it.
- **`ADDING-COMPANIES.md`** — the deep version of "how to add a company,"
  including what to do when the easy paths don't work.
