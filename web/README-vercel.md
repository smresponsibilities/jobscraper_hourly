# Why this directory has a vercel.json

The Vercel project's Root Directory is `web`, so this is where Vercel looks for
`vercel.json` — the repository root holds the scraper, which has no Next app in
it and is never what Vercel builds.

## ignoreCommand

Vercel runs `ignoreCommand` before building and reads its exit code backwards
from the usual convention: **exit 0 means skip the build**, any other exit code
means build. `git diff --quiet` exits 0 when the paths it was given did not
change, which lines up exactly.

The pathspec is `':/web'`, not `web` or `../web`. The leading `:/` is git's
"from the top of the repository" magic prefix, so the command means the same
thing regardless of which directory Vercel happens to run it from — and it runs
it from the Root Directory, not the repository root.

Every parent is checked, not just the first, and that is the whole reason this
command is a loop rather than a one-liner. The first version compared `HEAD^`
against `HEAD`, which is the first parent — and on a merge commit the first
parent is the branch you were already on. Merging `origin/main` into a local
branch that carried the web changes therefore produced a head whose
first-parent diff contained only what the merge brought in (bot commits to
`companies.json`), so the build was skipped and the web changes never shipped.
That happened, on the very first deployment this file governed. A merge
introduces the web change relative to its *other* parent, so the rule has to be
"build unless nothing under `web/` changed against any parent."

The effect: a commit that only touches the scraper, `companies.json` or the
docs no longer builds and deploys the site. Only a commit that actually changes
something under `web/` does.

The explicit `git rev-parse HEAD^` guard at the front exists for the same
reason. If `HEAD^` cannot be resolved — a clone too shallow for it, or a root
commit — the loop would iterate over nothing and fall out with a zero exit,
which means skip. Failing open like that is backwards: an unexpected failure
here should cost one unnecessary deployment, never a missing one, so the guard
turns it into a build.

## What this is not

This is the second layer, not the fix.

The real problem was `hunt.yml` force-pushing the orphan `data` branch 72 times
a day with a commit message that did not carry `[skip ci]`. Vercel deploys
every branch by default, so that was 72 preview deployments a day against the
Hobby plan's 100-per-day limit, and it is why real deploys started getting rate
limited. That is fixed at the source, in the workflow.

The distinction matters because the two work differently: `[skip ci]` is meant
to stop Vercel creating the deployment at all, whereas `ignoreCommand` runs
after a deployment already exists and stops the build inside it. So
`ignoreCommand` reliably saves build minutes, and is not a second way to stay
under the deployment count.

Do not assume `[skip ci]` is being honoured here, either. On 2026-09-08 the
deployment list showed `companies: board list update [skip ci]` built and
promoted to Production from `main`, which is a commit Vercel was supposed to
have skipped outright. Whatever the reason, the observed behaviour is what to
plan against: the only thing known to reliably stop a branch producing
deployments on this project is the branch setting in the Vercel dashboard, and
the only thing known to reliably stop a build is this file.

The site reads `jobs.json` from raw.githubusercontent at runtime (see
`next.config.mjs`), so new catalogue data has never needed a deploy to go live.
Deploys are for code changes only, which is exactly what `ignoreCommand` now
narrows them to.
