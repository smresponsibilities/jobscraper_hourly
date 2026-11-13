# 100-JOB REAL BROWSER DRY-RUN & DIAGNOSTICS EVIDENCE REPORT (`GEN-305`)
**Generated:** 2026-11-13T10:15:55.600Z  
**Target:** 100 Real Live Queued Distinct-Company Postings Across 5 ATS Providers  
**Execution Mode:** 6 Concurrent Headless Chromium Workers, 45s Hard Timeout per Job  
**Overall Result:** **5/100 READY_TO_SUBMIT (5.0% Pass Rate)** | Average Duration: **67.0s**

---

## 1. Executive Summary Scoreboard by ATS Provider

| ATS Provider | Total Jobs Tested | READY_TO_SUBMIT | Pass Rate % | Avg Duration (s) | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **GREENHOUSE** | 13 | 3 | **23.1%** | 85.3s | 🔴 Action Required |
| **ASHBY** | 2 | 2 | **100.0%** | 43.4s | 🟢 Strong |
| **LEVER** | 0 | 0 | **0%** | 0s | 🔴 Action Required |
| **SMARTRECRUITERS** | 42 | 0 | **0.0%** | 73.3s | 🔴 Action Required |
| **WORKDAY** | 43 | 0 | **0.0%** | 56.5s | 🔴 Action Required |
| **TOTAL** | **100** | **5** | **5.0%** | **67.0s** | **🔴 NEEDS FIX LOOP** |

---

## 2. Failure Bucket Distribution

| Failure Bucket | Count | Description / Root Cause |
| :--- | :---: | :--- |
| `FAILED_0_FIELDS` | **55** | Form inputs failed to mount / custom apply click or iframe unwrap needed |
| `FAILED_TIMEOUT` | **29** | Exceeded 45,000ms browser operation timeout |
| `FAILED_UNFILLED_FIELDS` | **6** | Required question missing from question bank or widget commit failed |
| `FAILED_AUTH_WALL` | **5** | Employer portal enforced login credentials before application form |

---

## 3. Top Unfilled Questions Pareto (Fix Targets)

| Question Prompt | Failures | ATS Providers | Recommended Healer |
| :--- | :---: | :--- | :--- |
| "When are you available to start working on a full-time basis?*" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "What is your current total annual compensation? * 4,00,000 to 6,00,000 per year" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "What is your current total annual compensation? * 7,00,000 to 10,00,000 per year" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "What is your current total annual compensation? * 11,00,000 to 15,00,000 per year" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "What is your current total annual compensation? * 16,00,000 to 20,00,000 per year" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "What is your current total annual compensation? * 21,00,000 to 25,00,000 per year" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "What is your current total annual compensation? * 26,00,000 or more per year" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "What is your last working date?*" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "Personal Data - Required * I accept and agree to Artefact's privacy policy." | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "Personalised Question * Male" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "Personalised Question * Female" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "Personalised Question * Prefer not to say" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "Key achievements which you would like to highlight*" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "What is your CCTC in LPA ?*" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |
| "What is your ECTC in LPA ?*" | **1** | greenhouse | Add to answers.ts conceptRules / portal-question-bank-1000.ts |

---

## 4. Complete 100-Job Empirical Evidence Table

| # | Company | ATS | Fields Distilled | Fields Filled | Submit Btn | Duration (s) | Status | Outcome / Error Detail |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| 1 | **particle41llc** | greenhouse | 57 | 16 | Yes | 74.5 | ❌ `FAILED_UNFILLED_FIELDS` | Required questions unfilled (8 required unfilled / 57 total) |
| 2 | **GitLab** | greenhouse | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 3 | **Graviton Research Capital** | greenhouse | 25 | 9 | Yes | 47.9 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 4 | **Sureify** | greenhouse | 26 | 10 | Yes | 58.4 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 5 | **Artefact** | greenhouse | 39 | 13 | Yes | 65.2 | ❌ `FAILED_UNFILLED_FIELDS` | Required questions unfilled (4 required unfilled / 39 total) |
| 6 | **capco** | greenhouse | 26 | 10 | Yes | 78.1 | ❌ `FAILED_UNFILLED_FIELDS` | Required questions unfilled (4 required unfilled / 26 total) |
| 7 | **IMC Trading** | greenhouse | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 8 | **platformscience** | greenhouse | 23 | 9 | Yes | 59.9 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 9 | **supplyhouse** | greenhouse | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 10 | **stockx** | greenhouse | 30 | 10 | Yes | 62.6 | ❌ `FAILED_UNFILLED_FIELDS` | Required questions unfilled (1 required unfilled / 30 total) |
| 11 | **starrez** | greenhouse | 58 | 17 | Yes | 104.5 | ❌ `FAILED_UNFILLED_FIELDS` | Required questions unfilled (2 required unfilled / 58 total) |
| 12 | **Canonical** | greenhouse | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 13 | **baublebar** | greenhouse | 30 | 12 | Yes | 77.2 | ❌ `FAILED_UNFILLED_FIELDS` | Required questions unfilled (1 required unfilled / 30 total) |
| 14 | **Sarvam AI** | ashby | 20 | 6 | Yes | 34.1 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 15 | **Snowflake** | ashby | 61 | 13 | Yes | 52.6 | ✅ `READY_TO_SUBMIT` | Ready to submit (all core & required fields filled, submit button verified) |
| 16 | **Interviewbit** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 17 | **SQUIRCLE IT CONSULTING SERVICES PVT. LTD** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 18 | **Mattel** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 19 | **Jobs for Humanity** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 20 | **Jitterbit** | smartrecruiters | 0 | 0 | Yes | 7.6 | ❌ `FAILED_0_FIELDS` | job_closed |
| 21 | **AMOL TECHNOLOGIES** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 22 | **Eurofins** | smartrecruiters | 0 | 0 | No | 120.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 23 | **NielsenIQ** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 24 | **Avaloq** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 25 | **BoschGroup** | smartrecruiters | 0 | 0 | Yes | 46.5 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 26 | **NECSWS** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 27 | **Renesas Electronics** | smartrecruiters | 0 | 0 | Yes | 28.3 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 28 | **Juniper Networks** | workday | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 29 | **HPE** | workday | 0 | 0 | Yes | 46.3 | ❌ `FAILED_0_FIELDS` | Position closed / no longer accepting applications |
| 30 | **Cisco** | workday | 0 | 0 | Yes | 51.2 | ❌ `FAILED_0_FIELDS` | Position closed / no longer accepting applications |
| 31 | **Mastercard** | workday | 0 | 0 | Yes | 112.4 | ❌ `FAILED_AUTH_WALL` | Login needs browser review |
| 32 | **Hewlett Packard Enterprise** | workday | 0 | 0 | Yes | 28.3 | ❌ `FAILED_0_FIELDS` | job_closed |
| 33 | **trimble** | workday | 0 | 0 | Yes | 29.7 | ❌ `FAILED_0_FIELDS` | job_closed |
| 34 | **taskus** | workday | 0 | 0 | Yes | 27.9 | ❌ `FAILED_0_FIELDS` | job_closed |
| 35 | **synechron** | workday | 0 | 0 | Yes | 36.7 | ❌ `FAILED_0_FIELDS` | job_closed |
| 36 | **Salesforce** | workday | 0 | 0 | Yes | 49.8 | ❌ `FAILED_0_FIELDS` | Position closed / no longer accepting applications |
| 37 | **Regal Rexnord** | workday | 0 | 0 | Yes | 29.4 | ❌ `FAILED_0_FIELDS` | job_closed |
| 38 | **Quantiphi** | workday | 0 | 0 | Yes | 32.1 | ❌ `FAILED_0_FIELDS` | job_closed |
| 39 | **Palo Alto Networks** | workday | 0 | 0 | Yes | 48.3 | ❌ `FAILED_0_FIELDS` | Position closed / no longer accepting applications |
| 40 | **NXP** | workday | 0 | 0 | Yes | 35.2 | ❌ `FAILED_0_FIELDS` | service_temporarily_unavailable |
| 41 | **NVIDIA** | workday | 0 | 0 | Yes | 35.5 | ❌ `FAILED_0_FIELDS` | job_closed |
| 42 | **Zomato** | smartrecruiters | 0 | 0 | Yes | 23.5 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 43 | **michelinhr** | workday | 0 | 0 | Yes | 32.8 | ❌ `FAILED_0_FIELDS` | job_closed |
| 44 | **Weblee Technologies** | smartrecruiters | 0 | 0 | Yes | 27.0 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 45 | **Medline** | workday | 0 | 0 | Yes | 28.4 | ❌ `FAILED_0_FIELDS` | job_closed |
| 46 | **Sia** | smartrecruiters | 0 | 0 | Yes | 22.0 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 47 | **lnw** | workday | 0 | 0 | Yes | 53.3 | ❌ `FAILED_0_FIELDS` | job_closed |
| 48 | **Sensia** | smartrecruiters | 0 | 0 | No | 122.1 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 49 | **liveramp** | workday | 0 | 0 | Yes | 39.6 | ❌ `FAILED_0_FIELDS` | service_temporarily_unavailable |
| 50 | **RA** | smartrecruiters | 0 | 0 | Yes | 36.8 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 51 | **KLA** | workday | 0 | 0 | Yes | 77.5 | ❌ `FAILED_0_FIELDS` | Position closed / no longer accepting applications |
| 52 | **Luceats** | smartrecruiters | 0 | 0 | Yes | 60.1 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 53 | **kantar** | workday | 0 | 0 | Yes | 79.2 | ❌ `FAILED_0_FIELDS` | job_closed |
| 54 | **Jobnath** | smartrecruiters | 0 | 0 | Yes | 43.2 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 55 | **Johnson Controls** | workday | 0 | 0 | Yes | 70.6 | ❌ `FAILED_0_FIELDS` | Position closed / no longer accepting applications |
| 56 | **InfraCloud** | smartrecruiters | 0 | 0 | Yes | 56.4 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 57 | **Jj** | workday | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 58 | **Bringle Excellence** | smartrecruiters | 0 | 0 | Yes | 42.8 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 59 | **harriscomputer** | workday | 0 | 0 | Yes | 37.4 | ❌ `FAILED_0_FIELDS` | Position closed / no longer accepting applications |
| 60 | **Blend360** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 61 | **harman** | workday | 0 | 0 | Yes | 31.5 | ❌ `FAILED_0_FIELDS` | job_closed |
| 62 | **Syngenta Group** | smartrecruiters | 0 | 0 | Yes | 44.0 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 63 | **greif** | workday | 0 | 0 | Yes | 51.9 | ❌ `FAILED_0_FIELDS` | Position closed / no longer accepting applications |
| 64 | **MSX International** | smartrecruiters | 0 | 0 | Yes | 39.2 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 65 | **globusmedical** | workday | 0 | 0 | Yes | 32.6 | ❌ `FAILED_0_FIELDS` | job_closed |
| 66 | **Informa Group Plc.** | smartrecruiters | 0 | 0 | No | 121.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 67 | **gartner** | workday | 0 | 0 | Yes | 44.8 | ❌ `FAILED_0_FIELDS` | Position closed / no longer accepting applications |
| 68 | **Sutherland** | smartrecruiters | 0 | 0 | Yes | 26.7 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 69 | **Fiserv** | workday | 0 | 0 | Yes | 32.0 | ❌ `FAILED_0_FIELDS` | job_closed |
| 70 | **Smiths Group** | smartrecruiters | 0 | 0 | Yes | 25.5 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 71 | **ddcdine** | workday | 0 | 0 | Yes | 37.6 | ❌ `FAILED_0_FIELDS` | job_closed |
| 72 | **Assent** | smartrecruiters | 0 | 0 | Yes | 24.9 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 73 | **CrowdStrike** | workday | 0 | 0 | Yes | 29.3 | ❌ `FAILED_0_FIELDS` | job_closed |
| 74 | **Talentanywhere1** | smartrecruiters | 0 | 0 | Yes | 22.9 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 75 | **copart** | workday | 0 | 0 | No | 120.4 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 76 | **Ramboll2** | smartrecruiters | 0 | 0 | Yes | 22.3 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 77 | **Citi** | workday | 0 | 0 | Yes | 28.7 | ❌ `FAILED_0_FIELDS` | job_closed |
| 78 | **QAD, Inc.** | smartrecruiters | 0 | 0 | Yes | 17.9 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 79 | **Centific** | workday | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 80 | **Lesaffre** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 81 | **barclays** | workday | 0 | 0 | Yes | 27.4 | ❌ `FAILED_0_FIELDS` | job_closed |
| 82 | **CustomizedEnergySolutions** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 83 | **aveva** | workday | 0 | 0 | Yes | 113.9 | ❌ `FAILED_AUTH_WALL` | Login needs browser review |
| 84 | **CogitateTechnology** | smartrecruiters | 0 | 0 | Yes | 20.7 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 85 | **Amgen** | workday | 0 | 0 | Yes | 117.7 | ❌ `FAILED_AUTH_WALL` | Login needs browser review |
| 86 | **BetaCraftTechnologies** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 87 | **Airbus** | workday | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 88 | **AmazaticSolutions** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 89 | **Adobe** | workday | 0 | 0 | Yes | 24.9 | ❌ `FAILED_0_FIELDS` | job_closed |
| 90 | **METRO/MAKRO** | smartrecruiters | 0 | 0 | Yes | 17.5 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 91 | **accendra** | workday | 0 | 0 | Yes | 106.0 | ❌ `FAILED_AUTH_WALL` | Login needs browser review |
| 92 | **T-Systems ICT India Pvt. Ltd.** | smartrecruiters | 0 | 0 | Yes | 17.4 | ❌ `FAILED_0_FIELDS` | Browser operation timed out; inspect the saved review |
| 93 | **Abbott** | workday | 0 | 0 | Yes | 98.5 | ❌ `FAILED_AUTH_WALL` | Login needs browser review |
| 94 | **AFRY** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 95 | **thehartford** | workday | 0 | 0 | Yes | 25.5 | ❌ `FAILED_0_FIELDS` | job_closed |
| 96 | **J.S. Held LLC** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 97 | **qualys** | workday | 0 | 0 | Yes | 24.3 | ❌ `FAILED_0_FIELDS` | job_closed |
| 98 | **ASSYSTEM** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |
| 99 | **Wustl** | workday | 0 | 0 | Yes | 22.8 | ❌ `FAILED_0_FIELDS` | job_closed |
| 100 | **Ramboll** | smartrecruiters | 0 | 0 | No | 120.0 | ❌ `FAILED_TIMEOUT` | Job execution timed out after 120s |

---
*Report generated autonomously by `scripts/dry-run-100-jobs-harness.ts` on 2026-11-13T10:15:55.603Z.*
