# 100-JOB REAL BROWSER DRY-RUN & DIAGNOSTICS EVIDENCE REPORT (`GEN-305`)
**Generated:** 2026-11-10T01:40:20.227Z  
**Target:** 100 Real Live Queued Distinct-Company Postings Across 5 ATS Providers  
**Execution Mode:** 6 Concurrent Headless Chromium Workers, 45s Hard Timeout per Job  
**Overall Result:** **13/100 READY_TO_SUBMIT (13.0% Pass Rate)** | Average Duration: **44.2s**

---

## 1. Executive Summary Scoreboard by ATS Provider

| ATS Provider | Total Jobs Tested | READY_TO_SUBMIT | Pass Rate % | Avg Duration (s) | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **GREENHOUSE** | 28 | 2 | **7.1%** | 42.5s | 🔴 Action Required |
| **ASHBY** | 26 | 6 | **23.1%** | 45.6s | 🔴 Action Required |
| **LEVER** | 20 | 5 | **25.0%** | 58.7s | 🔴 Action Required |
| **SMARTRECRUITERS** | 12 | 0 | **0.0%** | 39.1s | 🔴 Action Required |
| **WORKDAY** | 14 | 0 | **0.0%** | 28.9s | 🔴 Action Required |
| **TOTAL** | **100** | **13** | **13.0%** | **44.2s** | **🔴 NEEDS FIX LOOP** |

---

## 2. Failure Bucket Distribution

| Failure Bucket | Count | Description / Root Cause |
| :--- | :---: | :--- |
| `FAILED_TIMEOUT` | **57** | Exceeded 45,000ms browser operation timeout |
| `FAILED_0_FIELDS` | **24** | Form inputs failed to mount / custom apply click or iframe unwrap needed |
| `FAILED_UNFILLED_FIELDS` | **4** | Required question missing from question bank or widget commit failed |
| `FAILED_AUTH_WALL` | **2** | Employer portal enforced login credentials before application form |

---

## 3. Top Unfilled Questions Pareto (Fix Targets)

| Question Prompt | Failures | ATS Providers | Recommended Healer |
| :--- | :---: | :--- | :--- |
| "Attach" | **5** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |

---

## 4. Complete 100-Job Empirical Evidence Table

| # | Company | ATS | Fields Distilled | Fields Filled | Submit Btn | Duration (s) | Status | Outcome / Error Detail |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| 1 | **splice** | greenhouse | 0 | 0 | No | 4.3 | ❌ `FAILED_0_FIELDS` | browserContext.newPage: Target crashed  |
| 2 | **3Cloud** | greenhouse | 0 | 0 | No | 5.3 | ❌ `FAILED_AUTH_WALL` | browserType.launch: Target page, context or browser has been closed
Browser |
| 3 | **metroveincenters** | greenhouse | 0 | 0 | No | 4.5 | ❌ `FAILED_0_FIELDS` | browserContext.newPage: Target crashed  |
| 4 | **unanet** | greenhouse | 0 | 0 | No | 4.1 | ❌ `FAILED_0_FIELDS` | browserContext.newPage: Target crashed  |
| 5 | **SpaceX** | greenhouse | 0 | 0 | No | 4.2 | ❌ `FAILED_0_FIELDS` | browserContext.newPage: Target crashed  |
| 6 | **Apartment Life** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 7 | **At-Bay** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 8 | **Synack SRT** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 9 | **Scout Space** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 10 | **Interbrand** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 11 | **IntelliDyne Jobs for Veterans** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 12 | **Keeper Security** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 13 | **Keen Software House** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 14 | **Amwins Global Risks** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 15 | **Diligent Robotics** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 16 | **Global Fishing Watch RFP** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 17 | **Toast** | greenhouse | 0 | 0 | No | 60.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 18 | **Udemy** | greenhouse | 3 | 2 | Yes | 29.8 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 19 | **Dropbox** | greenhouse | 1 | 1 | Yes | 23.9 | ❌ `FAILED_UNFILLED_FIELDS` | Required questions unfilled (1 required unfilled / 1 total) |
| 20 | **Tanium** | greenhouse | 1 | 1 | Yes | 23.1 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 21 | **JFrog** | greenhouse | 1 | 1 | Yes | 23.0 | ❌ `FAILED_UNFILLED_FIELDS` | Required questions unfilled (1 required unfilled / 1 total) |
| 22 | **Neo4j** | greenhouse | 1 | 1 | Yes | 23.0 | ❌ `FAILED_UNFILLED_FIELDS` | Required questions unfilled (1 required unfilled / 1 total) |
| 23 | **Starburst** | greenhouse | 1 | 1 | Yes | 23.3 | ❌ `FAILED_UNFILLED_FIELDS` | Required questions unfilled (1 required unfilled / 1 total) |
| 24 | **BetterHelp** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 25 | **Geotab** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 26 | **bswift** | greenhouse | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 27 | **MobilityWare** | greenhouse | 0 | 0 | No | 60.3 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 28 | **Clickstop** | greenhouse | 0 | 0 | No | 60.3 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 29 | **GRVT TECHNOLOGIES** | ashby | 21 | 7 | Yes | 46.4 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 30 | **Saronic Technologies** | ashby | 0 | 0 | Yes | 29.7 | ❌ `FAILED_0_FIELDS` | Job timed out or runner closed |
| 31 | **Euphoric Global** | ashby | 0 | 0 | Yes | 17.1 | ❌ `FAILED_0_FIELDS` | Job timed out or runner closed |
| 32 | **Sprinter Health** | ashby | 0 | 0 | Yes | 5.0 | ❌ `FAILED_0_FIELDS` | Job timed out or runner closed |
| 33 | **Sailpeak** | ashby | 0 | 0 | Yes | 5.6 | ❌ `FAILED_0_FIELDS` | Job timed out or runner closed |
| 34 | **Fundamental** | ashby | 0 | 0 | Yes | 5.6 | ❌ `FAILED_0_FIELDS` | Job timed out or runner closed |
| 35 | **Thought Machine** | ashby | 0 | 0 | Yes | 16.1 | ❌ `FAILED_0_FIELDS` | Job timed out or runner closed |
| 36 | **Thorit** | ashby | 22 | 8 | Yes | 59.2 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 37 | **DOSS** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 38 | **Doppel** | ashby | 12 | 4 | Yes | 36.2 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 39 | **Hiya** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 40 | **Hiverge Ltd** | ashby | 31 | 12 | Yes | 42.7 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 41 | **Hims & Hers** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 42 | **Immersive** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 43 | **Apify Technologies s.r.o.** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 44 | **Restream** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 45 | **The Browser Company** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 46 | **Chalk** | ashby | 27 | 9 | Yes | 49.2 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 47 | **Meshy LLC** | ashby | 9 | 3 | Yes | 32.5 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 48 | **MeridianLink** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 49 | **Espa Labs** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 50 | **Sparrow** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 51 | **Mysten Labs** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 52 | **Colonist** | ashby | 0 | 0 | No | 60.2 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 53 | **Circular Economy Systems** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 54 | **Chromatic** | ashby | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 55 | **Doonails** | lever | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 56 | **Kyivstar** | lever | 26 | 7 | Yes | 55.3 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 57 | **Skillerszone** | lever | 29 | 8 | Yes | 57.8 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 58 | **CI&T** | lever | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 59 | **Panopto** | lever | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 60 | **PIP Labs** | lever | 25 | 6 | Yes | 50.4 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 61 | **Lodgify** | lever | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 62 | **ANA** | lever | 0 | 0 | No | 60.8 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 63 | **Ampeco Ltd** | lever | 29 | 10 | Yes | 54.1 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 64 | **Amanotes** | lever | 0 | 0 | No | 60.4 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 65 | **Qualysoft** | lever | 21 | 6 | Yes | 54.8 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 66 | **Makpar** | lever | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 67 | **Outsourced Staff** | lever | 0 | 0 | No | 60.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 68 | **Dijital Team** | lever | 0 | 0 | No | 60.3 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 69 | **Anchorage Digital** | lever | 0 | 0 | No | 60.2 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 70 | **Provectus** | lever | 0 | 0 | No | 60.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 71 | **Palantir** | lever | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 72 | **LRDG Language Research Development Group** | lever | 0 | 0 | No | 60.3 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 73 | **Cura** | lever | 0 | 0 | No | 60.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 74 | **Careers In Travel \| Destination Planners** | lever | 0 | 0 | No | 60.3 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 75 | **Interviewbit** | smartrecruiters | 0 | 0 | No | 60.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 76 | **Eurofins** | smartrecruiters | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 77 | **BoschGroup** | smartrecruiters | 0 | 0 | Yes | 7.9 | ❌ `FAILED_0_FIELDS` | job_closed |
| 78 | **Wabtec** | smartrecruiters | 0 | 0 | Yes | 10.9 | ❌ `FAILED_0_FIELDS` | job_closed |
| 79 | **Ubisoft** | smartrecruiters | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 80 | **T-Systems ICT India Pvt. Ltd.** | smartrecruiters | 0 | 0 | Yes | 9.1 | ❌ `FAILED_0_FIELDS` | job_closed |
| 81 | **Sutherland** | smartrecruiters | 0 | 0 | Yes | 12.7 | ❌ `FAILED_0_FIELDS` | job_closed |
| 82 | **SQUIRCLE IT CONSULTING SERVICES PVT. LTD** | smartrecruiters | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 83 | **Smiths Group** | smartrecruiters | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 84 | **Sia** | smartrecruiters | 0 | 0 | No | 60.2 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 85 | **REXEL** | smartrecruiters | 0 | 0 | Yes | 8.4 | ❌ `FAILED_0_FIELDS` | job_closed |
| 86 | **Renesas Electronics** | smartrecruiters | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 87 | **Mastercard** | workday | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 88 | **Juniper Networks** | workday | 0 | 0 | Yes | 16.8 | ❌ `FAILED_0_FIELDS` | job_closed |
| 89 | **HPE** | workday | 0 | 0 | Yes | 16.6 | ❌ `FAILED_0_FIELDS` | job_closed |
| 90 | **Cisco** | workday | 0 | 0 | Yes | 17.3 | ❌ `FAILED_0_FIELDS` | job_closed |
| 91 | **Hewlett Packard Enterprise** | workday | 0 | 0 | Yes | 16.5 | ❌ `FAILED_0_FIELDS` | job_closed |
| 92 | **Cencora** | workday | 0 | 0 | Yes | 48.6 | ❌ `FAILED_AUTH_WALL` | Login needs browser review |
| 93 | **zoom** | workday | 0 | 0 | Yes | 8.9 | ❌ `FAILED_0_FIELDS` | Job posting is closed or no longer available (404/expired) |
| 94 | **zebra** | workday | 0 | 0 | Yes | 7.9 | ❌ `FAILED_0_FIELDS` | Job posting is closed or no longer available (404/expired) |
| 95 | **Valeo** | workday | 0 | 0 | No | 60.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 96 | **trimble** | workday | 0 | 0 | Yes | 8.0 | ❌ `FAILED_0_FIELDS` | Job posting is closed or no longer available (404/expired) |
| 97 | **Trading Technologies** | workday | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 98 | **tcsedsystem** | workday | 0 | 0 | No | 60.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 60s |
| 99 | **taskus** | workday | 0 | 0 | Yes | 7.7 | ❌ `FAILED_0_FIELDS` | Job posting is closed or no longer available (404/expired) |
| 100 | **synechron** | workday | 0 | 0 | Yes | 16.3 | ❌ `FAILED_0_FIELDS` | job_closed |

---
*Report generated autonomously by `scripts/dry-run-100-jobs-harness.ts` on 2026-11-10T01:40:20.228Z.*
