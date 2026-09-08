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

The effect: a commit that only touches the scraper, `companies.json` or the
docs no longer builds and deploys the site. Only a commit that actually changes
something under `web/` does.

If the git command itself fails — a clone too shallow for `HEAD^` to exist, for
instance — it exits non-zero, which means "build". That is the right way round:
an unexpected failure here costs one unnecessary deployment, never a missing
one.

## What this is not

This is the second layer, not the fix.

The real problem was `hunt.yml` force-pushing the orphan `data` branch 72 times
a day with a commit message that did not carry `[skip ci]`. Vercel deploys
every branch by default, so that was 72 preview deployments a day against the
Hobby plan's 100-per-day limit, and it is why real deploys started getting rate
limited. That is fixed at the source, in the workflow.

The distinction matters because the two work differently: `[skip ci]` stops
Vercel creating the deployment at all, whereas `ignoreCommand` runs after a
deployment already exists and stops the build inside it. So `ignoreCommand`
reliably saves build minutes; treat it as insurance against a future commit to
`main` that forgets `[skip ci]`, not as a second way to stay under the
deployment count.

The site reads `jobs.json` from raw.githubusercontent at runtime (see
`next.config.mjs`), so new catalogue data has never needed a deploy to go live.
Deploys are for code changes only, which is exactly what `ignoreCommand` now
narrows them to.
