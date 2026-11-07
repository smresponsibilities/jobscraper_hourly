# Morning Autonomous Marathon & Drain Status Report

**Generated**: 2026-11-08 04:30 IST (Live Overnight Autonomous Marathon)
**Git HEAD**: `7c1b85b` (synced with `origin/main`)
**Dashboard**: http://localhost:4321
**Periodic Monitor**: Active (`*/10 * * * *` recurring cron)

---

## 1. Verified Live Scoreboard

| Metric | Count | Status Notes |
| :--- | :--- | :--- |
| **Applied (Confirmed Receipts)** | **61** | Verified employer receipts (including Sarvam AI, Enterpret, Point72, Truveta, etc.) |
| **Queued (Active Draining)** | **7,752** | 4 parallel provider lanes active (`greenhouse`, `ashby`, `workday`, `other`) |
| **Skipped (Pre-filtered)** | **10,996** | Closed / expired / YOE mismatch (> 2 YOE) |
| **Failed (True 404s Only)** | **33** | Only genuinely closed / 404 postings retained; zero false stalls |
| **Paused for Review** | **0** | All recoverable timeout jobs resurrected and auto-healed |

---

## 2. Forensic Fixes Deployed & Synced

1. **`waitChanged` 12s Hard Ceiling**:
   - Fixed 240s hard timeout when "Next" button failed to advance due to validation errors.
   - Replaced unbounded `timeout` with `Math.min(timeout, 12_000)` in `AutoApplyRunner.waitChanged`.
   - Now triggers `selfHealValidationErrors` and fast review exit in 12s instead of 240s.

2. **Ashby & Greenhouse PacedClick Capping (3500ms)**:
   - Wrapped actionability click with 3500ms timeout + Escape + force click + dispatchEvent fallback.

3. **Post-Submit Receipt 25s Ceiling & Heartbeat**:
   - Capped post-submit loop to 25s with `watchdog.heartbeat('post_submit_poll')`.

4. **Greenhouse Submit Regex & 200-399 Status**:
   - Accepts modern Greenhouse Remix endpoints and 302/303 redirect receipts.

5. **SQLite WAL Mode & 10s Busy Timeout**:
   - `queue.sqlite` configured in WAL mode (`journal_mode = WAL`), eliminating concurrent lock contention.

---

## 3. Running Daemons & Monitor

- **Overnight Marathon Runner**: Active in background (`task-6253`), executing 40-job chunks across 4 isolated provider lanes with `--submit`.
- **Periodic Monitor**: Standing recurring schedule (`task-6263`, `*/10 * * * *`) inspecting progress, reconciling transient stalls, and reporting status every 10 minutes.
- **Operations Dashboard**: Live at http://localhost:4321 (PID 28516).
