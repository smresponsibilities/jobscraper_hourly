# Morning Autonomous Marathon & Drain Status Report

**Generated**: 2026-11-08 (Live Overnight Autonomous Marathon)
**Git HEAD**: `b54a2bd` (synced with `origin/main`)
**Dashboard**: http://localhost:4321

---

## 1. Verified Live Scoreboard

| Metric | Count | Status Notes |
| :--- | :--- | :--- |
| **Applied (Confirmed Receipts)** | **61** | Verified employer receipts (including Sarvam AI, Enterpret, Point72, Truveta, etc.) |
| **Queued (Active Draining)** | **7,787** | 4 parallel provider lanes active (`greenhouse`, `ashby`, `workday`, `other`) |
| **Skipped (Pre-filtered)** | **10,967** | Closed / expired / YOE mismatch (> 2 YOE) |
| **Failed (True 404s Only)** | **27** | Only genuinely closed / 404 postings retained; zero false stalls |
| **Paused for Review** | **0** | All missing fields auto-healed via semantic memory & concept bags |

---

## 2. Forensic Fixes Deployed (GEN-157 through GEN-160)

1. **GEN-157: `pacedClick` Actionability Timeout Protection**:
   - Fixed 30s Playwright pointer-interception hangs by capping actionability click to 3500ms.
   - Fallback executes `Escape` press, followed by `control.click({ force: true, timeout: 3000 })` and `control.dispatchEvent('click')`.
   - Verified on Ashby and Greenhouse submit buttons.

2. **GEN-158: Post-Submit Receipt Polling Ceiling & Heartbeat**:
   - Replaced unbounded 240s polling loop (`timeoutMs`) with `Math.min(timeout, 25_000)` (25-second ceiling).
   - Injected `watchdog.heartbeat('post_submit_poll')` per cycle, preventing `drain-backfill-and-hourly.ts` hard timeout aborts.

3. **GEN-159: Greenhouse Submit Regex & HTTP Status Codes**:
   - Expanded submit endpoint pattern to `/ApiSubmitApplicationForm|submitApplication|\/embed\/job_app|\/oneclick-ui\/[^?]+\/(?:candidates|applications)|\/jobs\/\d+(?:\/applications)?|\/jobs\/\d+|\/apply\/submit|\/job_app/i`.
   - Permitted HTTP status codes 200 through 399 (including 302/303 redirect confirmations).

4. **GEN-160: Semantic Concept Learning & Memory Refresh**:
   - Added `highest_degree_field_university_grad_year` rule: resolves "Bachelor of Engineering in Computer Science and Engineering, Chitkara University, Class of 2026 (9.35 CGPA)".
   - Added `notice_period_custom` day parsing: resolves numeric "0" when question specifies "in days" or expects integer.
   - Refreshed persistent `semantic-memory.json` entries.

---

## 3. Running Daemons

- **Overnight Marathon Runner**: Running unattended in background with `--submit` across 4 lanes.
- **Dashboard Server**: Live at http://localhost:4321 (`task-4944`).
