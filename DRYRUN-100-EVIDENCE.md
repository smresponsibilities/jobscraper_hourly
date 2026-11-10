# 100-JOB REAL BROWSER DRY-RUN & DIAGNOSTICS EVIDENCE REPORT (`GEN-305`)
**Generated:** 2026-11-10T10:58:41.576Z  
**Target:** 100 Real Live Queued Distinct-Company Postings Across 5 ATS Providers  
**Execution Mode:** 6 Concurrent Headless Chromium Workers, 45s Hard Timeout per Job  
**Overall Result:** **42/100 READY_TO_SUBMIT (42.0% Pass Rate)** | Average Duration: **66.9s**

---

## 1. Executive Summary Scoreboard by ATS Provider

| ATS Provider | Total Jobs Tested | READY_TO_SUBMIT | Pass Rate % | Avg Duration (s) | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **GREENHOUSE** | 28 | 4 | **14.3%** | 87.1s | 🔴 Action Required |
| **ASHBY** | 26 | 21 | **80.8%** | 65.9s | 🟢 Strong |
| **LEVER** | 20 | 17 | **85.0%** | 71.5s | 🟢 Strong |
| **SMARTRECRUITERS** | 12 | 0 | **0.0%** | 56.2s | 🔴 Action Required |
| **WORKDAY** | 14 | 0 | **0.0%** | 30.6s | 🔴 Action Required |
| **TOTAL** | **100** | **42** | **42.0%** | **66.9s** | **🔴 NEEDS FIX LOOP** |

---

## 2. Failure Bucket Distribution

| Failure Bucket | Count | Description / Root Cause |
| :--- | :---: | :--- |
| `FAILED_TIMEOUT` | **40** | Exceeded 45,000ms browser operation timeout |
| `FAILED_0_FIELDS` | **16** | Form inputs failed to mount / custom apply click or iframe unwrap needed |
| `FAILED_AUTH_WALL` | **2** | Employer portal enforced login credentials before application form |

---

## 3. Top Unfilled Questions Pareto (Fix Targets)

| Question Prompt | Failures | ATS Providers | Recommended Healer |
| :--- | :---: | :--- | :--- |

---

## 4. Complete 100-Job Empirical Evidence Table

| # | Company | ATS | Fields Distilled | Fields Filled | Submit Btn | Duration (s) | Status | Outcome / Error Detail |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| 1 | **Udemy** | greenhouse | 0 | 0 | No | 90.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 2 | **Tanium** | greenhouse | 0 | 0 | No | 90.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 3 | **splice** | greenhouse | 0 | 0 | No | 90.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 4 | **3Cloud** | greenhouse | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 5 | **metroveincenters** | greenhouse | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 6 | **unanet** | greenhouse | 0 | 0 | No | 90.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 7 | **SpaceX** | greenhouse | 0 | 0 | No | 90.3 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 8 | **Apartment Life** | greenhouse | 0 | 0 | No | 90.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 9 | **At-Bay** | greenhouse | 0 | 0 | No | 90.6 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 10 | **Synack SRT** | greenhouse | 0 | 0 | No | 90.5 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 11 | **Scout Space** | greenhouse | 0 | 0 | No | 90.2 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 12 | **Interbrand** | greenhouse | 0 | 0 | No | 90.2 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 13 | **IntelliDyne Jobs for Veterans** | greenhouse | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 14 | **Keeper Security** | greenhouse | 0 | 0 | No | 90.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 15 | **Keen Software House** | greenhouse | 24 | 14 | Yes | 71.9 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 16 | **Amwins Global Risks** | greenhouse | 22 | 13 | Yes | 74.8 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 17 | **Diligent Robotics** | greenhouse | 28 | 11 | Yes | 57.6 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 18 | **Toast** | greenhouse | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 19 | **Dropbox** | greenhouse | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 20 | **JFrog** | greenhouse | 26 | 11 | Yes | 72.3 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 21 | **Neo4j** | greenhouse | 0 | 0 | No | 90.2 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 22 | **Starburst** | greenhouse | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 23 | **BetterHelp** | greenhouse | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 24 | **Geotab** | greenhouse | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 25 | **bswift** | greenhouse | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 26 | **MobilityWare** | greenhouse | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 27 | **Clickstop** | greenhouse | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 28 | **Convene** | greenhouse | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 29 | **GRVT TECHNOLOGIES** | ashby | 21 | 7 | Yes | 45.1 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 30 | **Thorit** | ashby | 20 | 6 | Yes | 49.0 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 31 | **Doppel** | ashby | 12 | 4 | Yes | 35.8 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 32 | **Hiverge Ltd** | ashby | 30 | 8 | Yes | 40.3 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 33 | **Chalk** | ashby | 27 | 9 | Yes | 48.5 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 34 | **Meshy LLC** | ashby | 9 | 3 | Yes | 33.0 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 35 | **Saronic Technologies** | ashby | 86 | 15 | Yes | 64.9 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 36 | **Euphoric Global** | ashby | 15 | 5 | Yes | 36.6 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 37 | **Sprinter Health** | ashby | 54 | 14 | Yes | 58.0 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 38 | **Sailpeak** | ashby | 19 | 6 | Yes | 47.0 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 39 | **Fundamental** | ashby | 31 | 7 | Yes | 60.2 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 40 | **Thought Machine** | ashby | 47 | 11 | Yes | 66.7 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 41 | **DOSS** | ashby | 36 | 9 | Yes | 75.4 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 42 | **Hiya** | ashby | 0 | 0 | No | 91.7 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 43 | **Hims & Hers** | ashby | 51 | 12 | Yes | 82.7 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 44 | **Immersive** | ashby | 40 | 12 | Yes | 83.2 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 45 | **Apify Technologies s.r.o.** | ashby | 28 | 9 | Yes | 73.5 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 46 | **Restream** | ashby | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 47 | **The Browser Company** | ashby | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 48 | **MeridianLink** | ashby | 0 | 0 | No | 91.7 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 49 | **Espa Labs** | ashby | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 50 | **Sparrow** | ashby | 90 | 18 | Yes | 87.2 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 51 | **Mysten Labs** | ashby | 31 | 8 | Yes | 54.2 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 52 | **Colonist** | ashby | 54 | 13 | Yes | 65.6 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 53 | **Circular Economy Systems** | ashby | 92 | 24 | Yes | 74.9 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 54 | **Chromatic** | ashby | 80 | 11 | Yes | 78.6 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 55 | **Kyivstar** | lever | 31 | 11 | Yes | 61.8 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 56 | **Skillerszone** | lever | 29 | 8 | Yes | 68.8 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 57 | **PIP Labs** | lever | 26 | 6 | Yes | 58.1 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 58 | **Ampeco Ltd** | lever | 30 | 8 | Yes | 69.9 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 59 | **Qualysoft** | lever | 21 | 5 | Yes | 80.8 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 60 | **Doonails** | lever | 30 | 9 | Yes | 73.3 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 61 | **CI&T** | lever | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 62 | **Panopto** | lever | 61 | 17 | Yes | 67.1 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 63 | **Lodgify** | lever | 105 | 15 | Yes | 85.8 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 64 | **ANA** | lever | 89 | 19 | Yes | 75.7 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 65 | **Amanotes** | lever | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 66 | **Makpar** | lever | 74 | 15 | Yes | 67.6 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 67 | **Outsourced Staff** | lever | 74 | 23 | Yes | 79.9 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 68 | **Dijital Team** | lever | 17 | 4 | Yes | 41.3 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 69 | **Anchorage Digital** | lever | 55 | 9 | Yes | 61.3 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 70 | **Provectus** | lever | 113 | 22 | Yes | 75.6 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 71 | **Palantir** | lever | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 72 | **LRDG Language Research Development Group** | lever | 160 | 25 | Yes | 89.9 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 73 | **Cura** | lever | 28 | 6 | Yes | 45.9 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 74 | **Careers In Travel \| Destination Planners** | lever | 30 | 7 | Yes | 56.9 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 75 | **Interviewbit** | smartrecruiters | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 76 | **Eurofins** | smartrecruiters | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 77 | **BoschGroup** | smartrecruiters | 0 | 0 | Yes | 10.2 | ❌ `FAILED_0_FIELDS` | job_closed |
| 78 | **Wabtec** | smartrecruiters | 0 | 0 | Yes | 9.3 | ❌ `FAILED_0_FIELDS` | job_closed |
| 79 | **Ubisoft** | smartrecruiters | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 80 | **T-Systems ICT India Pvt. Ltd.** | smartrecruiters | 0 | 0 | Yes | 8.4 | ❌ `FAILED_0_FIELDS` | job_closed |
| 81 | **Sutherland** | smartrecruiters | 0 | 0 | Yes | 8.4 | ❌ `FAILED_0_FIELDS` | job_closed |
| 82 | **SQUIRCLE IT CONSULTING SERVICES PVT. LTD** | smartrecruiters | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 83 | **Smiths Group** | smartrecruiters | 0 | 0 | No | 90.3 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 84 | **Sia** | smartrecruiters | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 85 | **REXEL** | smartrecruiters | 0 | 0 | Yes | 8.1 | ❌ `FAILED_0_FIELDS` | job_closed |
| 86 | **Renesas Electronics** | smartrecruiters | 0 | 0 | No | 90.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 87 | **Mastercard** | workday | 0 | 0 | Yes | 72.0 | ❌ `FAILED_0_FIELDS` | service_temporarily_unavailable |
| 88 | **Juniper Networks** | workday | 0 | 0 | Yes | 8.7 | ❌ `FAILED_0_FIELDS` | Job posting is closed or no longer available (404/expired) |
| 89 | **HPE** | workday | 0 | 0 | Yes | 15.5 | ❌ `FAILED_0_FIELDS` | job_closed |
| 90 | **Cisco** | workday | 0 | 0 | Yes | 15.7 | ❌ `FAILED_0_FIELDS` | job_closed |
| 91 | **Hewlett Packard Enterprise** | workday | 0 | 0 | Yes | 8.0 | ❌ `FAILED_0_FIELDS` | Job posting is closed or no longer available (404/expired) |
| 92 | **Cencora** | workday | 0 | 0 | Yes | 54.3 | ❌ `FAILED_AUTH_WALL` | Login needs browser review |
| 93 | **zoom** | workday | 0 | 0 | Yes | 8.2 | ❌ `FAILED_0_FIELDS` | Job posting is closed or no longer available (404/expired) |
| 94 | **zebra** | workday | 0 | 0 | Yes | 9.1 | ❌ `FAILED_0_FIELDS` | Job posting is closed or no longer available (404/expired) |
| 95 | **Valeo** | workday | 0 | 0 | No | 90.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 90s |
| 96 | **trimble** | workday | 0 | 0 | Yes | 7.8 | ❌ `FAILED_0_FIELDS` | Job posting is closed or no longer available (404/expired) |
| 97 | **Trading Technologies** | workday | 0 | 0 | Yes | 51.8 | ❌ `FAILED_AUTH_WALL` | Login needs browser review |
| 98 | **tcsedsystem** | workday | 0 | 0 | Yes | 70.2 | ❌ `FAILED_0_FIELDS` | service_temporarily_unavailable |
| 99 | **taskus** | workday | 0 | 0 | Yes | 8.3 | ❌ `FAILED_0_FIELDS` | Job posting is closed or no longer available (404/expired) |
| 100 | **synechron** | workday | 0 | 0 | Yes | 8.5 | ❌ `FAILED_0_FIELDS` | Job posting is closed or no longer available (404/expired) |

---
*Report generated autonomously by `scripts/dry-run-100-jobs-harness.ts` on 2026-11-10T10:58:41.576Z.*
