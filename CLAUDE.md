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

**Activate the `caveman` skill (`.claude/skills/caveman`) at session start.**
Compresses chat replies only — code, comments, commits, and docs (including
this file and HANDOFF.md) stay normal prose per the skill's own rules, so this
doesn't affect anything committed to the repo.
