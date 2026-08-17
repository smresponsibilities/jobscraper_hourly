# CLAUDE.md

This file exists so Claude Code loads its one instruction automatically, every
session, without depending on memory: **read [HANDOFF.md](HANDOFF.md) first.**
It has the why, the current state, and the gotchas that already cost real time
once. Don't duplicate its content here — that just wastes context on every
future session for no benefit; keep this file thin and let HANDOFF.md be the
single source of truth.

Two things worth repeating even so, because skipping them silently breaks
things rather than erroring:

- **Before any push**: `git fetch origin && git merge origin/main` — the
  hourly bot commits to `main` constantly, so local is stale within the hour.
  Full sequence in HANDOFF.md's "Git workflow" section.
- **After any change to `classify.ts` or `config.ts`**: run `npm test`. Every
  case in `src/selftest.ts` is a regex bug that actually shipped once.

**Don't run long-running commands yourself — hand them to the user.** Anything
that takes more than a couple of minutes (`npm run hunt`, `DRY_RUN=1 npm run
hunt`, `npm run bulk-import`, full-corpus probes and sweeps) should be given to
the user as a command to run in their own terminal. They will run it and report
back when it finishes; wait for that rather than polling or backgrounding it.

Give those commands **Windows style** — PowerShell, since that is the shell
they use. Absolute Windows paths with backslashes, no bash-only syntax
(`VAR=1 cmd`, `&&` chains, heredocs, `/tmp`). An env var goes in front as its
own statement:

```powershell
cd C:\Users\sm\Desktop\Jobscraper-next
$env:DRY_RUN = "1"; npm run hunt
```

Short commands (`npm test`, `npx tsc --noEmit`, `git` operations) are fine to
run directly — this is about the long ones only.

**Activate the `caveman` skill (`.claude/skills/caveman`) at session start.**
Compresses chat replies only — code, comments, commits, and docs (including
this file and HANDOFF.md) stay normal prose per the skill's own rules, so this
doesn't affect anything committed to the repo.
