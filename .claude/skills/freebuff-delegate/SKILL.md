---
name: freebuff-delegate
description: Delegate grunt work — anything a small/cheap model can do correctly, not just this project's ATS-credential research — to the external tool "freebuff" instead of spending Claude's own tokens on it. Use when a task is mechanical or well-scoped enough that frontier-model reasoning isn't the bottleneck (bulk research/lookups, boilerplate, repetitive mechanical edits), and when picking up or continuing a freebuff round already in progress.
metadata:
  author: project
  version: "2.0"
---

# Delegating grunt work to freebuff

freebuff is a free CLI agent — a raw TUI, model picker then a single prompt
box, backed by small/cheap models (in India: DeepSeek V4 Flash or MiMo 2.5).
It can be run two ways: the user types `freebuff` in their own terminal and
pastes a prompt in by hand, or Claude Code drives it directly via tmux inside
WSL (see "Driving it directly" below).

**The test for what goes to freebuff is capability, not category.** If a
small model can do it correctly — a well-scoped lookup, a repetitive
mechanical edit, boilerplate generation, anything where the hard part is
volume rather than judgment — it doesn't need Claude's own tokens spent on
it. Route it to freebuff. Keep for Claude anything where getting it right
actually depends on frontier-level reasoning or this repo's accumulated
context (e.g. whether a regex change is safe, how a finding should be
integrated).

## The tool's constraints (shape every prompt)

- **One terminal command, model picker, one prompt box.** Typing `freebuff`
  picks a model, then takes one prompt.
- **Single instance only.** No running two freebuff sessions in parallel —
  work is sequential batches, not fan-out.
- **Daily session cap.** 6 sessions/day, resets on a rolling ~16h window. A
  session is consumed the moment a model is picked, not on first submitted
  prompt — don't open one just to look around.
- **No memory of this conversation.** Every prompt must be fully
  self-contained: context, rules, and scope all restated, every time. Never
  write "continue from where you left off" or reference anything only Claude
  Code has seen.
- **It's a real coding agent, not a sandboxed tool.** Its own banner says
  "freebuff will run commands on your behalf to help you build" — it can
  execute shell commands and edit files in whatever directory it's started
  in. Nothing technical stops it beyond what the prompt text asks it not to
  do. What directory to start it in — and therefore what it can actually
  touch — depends on the task type, below.

## Two guardrail modes, pick based on the task

**Pure research/lookup (no repo write needed) — isolate by directory.**
Launch it from a neutral directory outside this repo, so it has no
filesystem path to real project files at all — the safety is "it literally
can't reach them," not just "the prompt asked it not to." This is the
existing ATS-credential-research use case: resolving ATS platforms/tenants
for named companies, verifying whether a company still operates, checking
what platform a careers page runs on. It reports findings to a text file;
Claude integrates afterward.

**Mechanical repo work (bulk edits, boilerplate, running scripts against this
codebase) — isolate by worktree.** If the task needs real repo access,
launch freebuff inside a dedicated `git worktree` on its own branch, never
against `main` or the working tree directly. Review its diff like any other
agent's output before merging — mistakes stay contained to a branch you can
discard.

## Writing a freebuff prompt

Prompts and reports for this project live in the scratchpad folder as
`freebuff-prompt-N.txt` / `freebuff-report-N.txt` (numbered sequentially,
shared across both research and other grunt-work rounds). **Before writing a
new prompt**, check that folder for existing `freebuff-prompt*.txt` /
`freebuff-report*.txt` files — both to see what's already been asked, and to
avoid duplicating work a prior round already finished.

Every prompt must include, every time:

1. **Context, restated in full** (freebuff has no memory) — what this task
   actually is and why, at whatever level of detail freebuff needs to act
   without asking follow-up questions.
2. **Evidence/verification bar** appropriate to the task — e.g. for research,
   2-3 real job titles actually seen on the board per finding, or mark it
   `UNVERIFIED`. Self-reported "verified"/"done" claims from freebuff have
   been right most of the time but not always — a concrete bar is what makes
   re-verification possible afterward.
3. **No bot-check pages in a rendered browser** (research tasks) — mark a
   bot-gated page `UNVERIFIED` rather than trying to push through a
   Cloudflare/Turnstile challenge.
4. **Write-as-you-go**: append output the moment it's done, never hold it in
   memory until the end.
5. **The scope boundary, stated explicitly every time**: for research, that
   it must NOT edit anything — research and report only, integration is
   Claude Code's job. For repo work, that it must stay on the worktree branch
   it was given and not touch anything outside it.
6. **Output location** — the next `freebuff-report-N.txt` for research
   (format: `CompanyName | platform:credentials | ~N India roles | evidence:
   "t1", "t2", "t3"`), or the worktree path + branch name for repo work.
7. **What's already resolved/done**, so it isn't repeated — pull this from
   prior `freebuff-report-*.txt` files and HANDOFF.md.
8. **The actual scope for this round** — specific and bounded. For research,
   HANDOFF.md tracks which sectors are already exhausted.

## Driving it directly (tmux + WSL)

Claude Code can start and feed freebuff itself instead of handing the user a
prompt to paste. **Only works through WSL** — confirmed by testing:
Git-Bash's own tmux install (via MSYS2 pacman, `/c/msys64/usr/bin`) is
broken on this machine, different `msys-2.0.dll` builds can't share IPC, the
server dies or hangs immediately. WSL Ubuntu already has tmux, node, and
freebuff installed with a real Linux pty, and that combination works
cleanly. Always route through `wsl.exe -e bash -lc "..."` from the Bash
tool; don't reinstall tmux on the Windows side again.

**Token cost is the whole design constraint here — a rendered TUI screen is
expensive to read every time, and freebuff runs are the same "long-running,
don't poll" shape as `npm run hunt`.** Concretely:

1. Launch detached, from whichever directory the guardrail mode above calls
   for (neutral dir for research, worktree for repo work):
   `wsl.exe -e bash -lc "tmux new-session -d -s fb -x 100 -y 30 -c <dir> 'freebuff'"`.
2. Sleep a few seconds, `capture-pane -p` **once** to confirm the model
   picker rendered, then `send-keys Enter` to accept the recommended model
   (or `Down` then `Enter` for the other one).
3. Sleep, `capture-pane -p` **once** to confirm the prompt box is up, then
   send the actual prompt as literal text — `tmux send-keys -t fb -l "<prompt>"`
   followed by a separate `tmux send-keys -t fb Enter` (literal mode avoids
   the terminal interpreting prompt text as keybindings).
4. **Then stop watching the pane.** Tell freebuff, as part of the prompt
   itself, to append a plain `=== DONE ===` line to its output file when
   finished. Background the wait (`run_in_background`, same as any other
   long command in this project) and check progress — if ever needed — by
   tailing the **output file**, not by re-running `capture-pane`. The file is
   plain text that only grows with real content; the pane is UI chrome that
   costs a full re-render every time it's captured.
5. Once the output file ends in `=== DONE ===` (or after one final wait),
   read it once, then `tmux kill-session -t fb` to close it out. A
   `capture-pane` check is only a fallback if nothing has landed after a long
   wait and there's no way to tell if it's stuck — not a monitoring habit.

Whether to drive it directly or hand the user a prompt to paste by hand is a
per-round call, not a fixed rule — decide at the time based on what's
actually being asked.

## After freebuff reports back

Read the output directly once it exists — don't ask the user to paste it.
Then, before integrating anything:

- **For research**: re-verify every finding against this repo's own
  `src/fetchers/*.ts`, not against freebuff's self-reported evidence alone,
  before touching `companies.json` or anything in `src/`. A resolved tenant
  is not proof it's the right company — see the IBM-tenant lesson in
  ADDING-COMPANIES.md §4d (three Oracle tenants that *looked* like IBM turned
  out to be unrelated orgs). Findings marked `UNVERIFIED`, on unsupported
  platforms, or without real evidence stay out until a later pass resolves
  them.
- **For repo work**: review the worktree's diff the same way you'd review
  any agent-written change before merging it — nothing lands on `main`
  unreviewed just because a cheaper model wrote it.
- Update HANDOFF.md's "in progress" / research-state section so the next
  session (Claude or freebuff) knows what's resolved and doesn't duplicate
  work.
