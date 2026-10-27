import json
import os

RAW_DATA_PATH = r"D:\jobscraper-next\data\oliver_cordingley_all.json"
PLAYBOOK_PATH = r"D:\jobscraper-next\OLIVER-CORDINGLEY-JOB-SEARCH-PLAYBOOK.md"
ALL_VIDEOS_PATH = r"D:\jobscraper-next\docs\OLIVER-CORDINGLEY-ALL-VIDEOS.md"

with open(RAW_DATA_PATH, "r", encoding="utf-8") as f:
    videos = json.load(f)

print(f"Loaded {len(videos)} videos from {RAW_DATA_PATH}")

# ==============================================================================
# 1. BUILD THE MASTER JOB SEARCH PLAYBOOK
# ==============================================================================
playbook_content = """# The Oliver Cordingley Job Search Playbook
### Complete System & Frameworks Synthesized from 40 Channel Deep-Dives

> **Source**: [Oliver Cordingley YouTube Channel](https://www.youtube.com/@olivercordingley) | Ex-Recruitment Software Founder & Career Coach  
> **Target Environment**: Modern Tech, Finance, Data & Graduate/Mid-Level Job Markets (UK, US, Global Remote)  
> **Data Foundation**: Analysis of 39,184 CVs, 1.7M+ ATS submissions, recruiter search behavior, and hundreds of candidate placements at Citadel, JP Morgan, Goldman Sachs, BlackRock, Deloitte, EY, PwC, Bloomberg, and Palantir.

---

## Table of Contents
1. [The 2026/2027 Job Market Reality (The Numbers)](#1-the-20262027-job-market-reality)
2. [The 7 Job Search Channels Ranked (Worst to Best)](#2-the-7-job-search-channels-ranked)
3. [The Truth About ATS & Knockout Questions](#3-the-truth-about-ats--knockout-questions)
4. [The 39,184 CV Study: Proven Blueprint & Rules](#4-the-39184-cv-study-proven-blueprint--rules)
5. [Reverse-Engineering LinkedIn Recruiter SEO](#5-reverse-engineering-linkedin-recruiter-seo)
6. [The 6-Step "Impact Loop" Cold Outreach & Referral Playbook](#6-the-6-step-impact-loop-cold-outreach--referral-playbook)
7. [Interview Mastery: The First 90 Seconds, "Tell Me About Yourself", & CCARR](#7-interview-mastery-the-first-90-seconds-tell-me-about-yourself--ccarr)
8. [Assessment Centres & Numerical Reasoning Defense](#8-assessment-centres--numerical-reasoning-defense)
9. [UK Visa Sponsorship & Special Cases Playbook](#9-uk-visa-sponsorship--special-cases-playbook)
10. [The 7-Day Rapid Execution Sprint](#10-the-7-day-rapid-execution-sprint)

---

## 1. The 2026/2027 Job Market Reality

The traditional "apply online and wait" playbook is completely broken. Candidates still operating under the 2018–2021 job search playbook find themselves trapped in a soul-crushing rejection cycle.

```
       [ Cold Job Boards / 1-Click Apply ]
                 │
                 ├── 312+ applicants per role (up from 140 in 2021)
                 ├── 32% Ghost Jobs (ads with zero live hiring intent)
                 ├── 75% Ghost Rate (zero response / no rejection email)
                 └── 1% to 2% Interview Conversion Rate
                                │
                                ▼
       [ The Hidden Job Market & Warm Referral Track ]
                 │
                 ├── 72% - 75% of hires never touch public job boards
                 ├── Pre-application networking & peer alignment
                 └── 15% to 30% Interview Conversion Rate (15x-20x higher!)
```

### The Hard Statistics
* **312 Applications Per Role**: The average UK professional role now receives over 312 applicants (more than triple the 140 average from 5 years ago).
* **The Ghost Job Epidemic**: 1 in 3 postings (~32%) on platforms like LinkedIn and Indeed are "ghost listings" posted to harvest resumes, satisfy HR compliance, or project artificial growth without active headcount.
* **The 75% Silence Rate**: Approximately 75% of cold job applications receive no response whatsoever—not even an automated rejection.
* **The 6-to-10 Second Scan**: Because recruiters face 300+ PDFs per opening across 5+ concurrent searches, they do not read CVs; they perform an **F-shaped scan in 6 to 10 seconds**.
* **Communication vs. Skills**: In surveys of over 500 recruiters and hiring managers, **86% of interview rejections are based on communication, behavioral fit, and positioning**, NOT technical ability.

---

## 2. The 7 Job Search Channels Ranked

Oliver ranks every method of finding a job from worst (pure waste of time) to best (maximum ROI):

| Rank | Method | Conversion Rate | Strategic Assessment & Action |
|:---:|:---|:---:|:---|
| **7 (Worst)** | **Automated AI Bots / Mass Auto-Apply Tools** | **~0%** | **STOP IMMEDIATELY.** Firing 500 bot-applications burns your name in ATS databases, triggers IP spam flags, and wastes money on subscriptions. |
| **6** | **Cold Public Job Boards (LinkedIn Easy Apply, Indeed)** | **1% - 2%** | **LOW RETURN.** You are a complete stranger competing against hundreds of other strangers in an impossible queue. Only use as a background fallback. |
| **5** | **General Recruitment Agencies** | **2% - 5%** | **MOSTLY INEFFECTIVE.** Cold messaging random generalist recruiters is useless. **Exception**: 1 specialist recruiter who places only candidates in your exact niche/seniority yields **20% - 30% reply rates**. |
| **4** | **Direct ATS URL Queries (Google Dorking)** | **4% - 8%** | **HIGH-EFFICIENCY DIRECT APPLY.** Search direct ATS endpoints to find newly posted jobs before aggregators scrape them (see queries below). |
| **3** | **LinkedIn Recruiter Inbound SEO** | **10% - 15% (Inbound)** | **PASSIVE PIPELINE.** Optimize your profile so hiring teams find you in searches. Costs nothing once set up; generates weekly inbound recruiter DMs. |
| **2** | **Direct Outreach to the Hiring Manager** | **15% - 25%** | **POWERFUL FOR <250 PERSON FIRMS.** Contact the actual team lead/manager directly via LinkedIn DM + email + 2-min Loom video. 3x–5x the interview rate of cold applying. |
| **1 (Best)** | **Warm Peer Networking & Referrals (The Impact Loop)** | **15% - 30%** | **THE GOLD STANDARD.** Access the 75% hidden job market. A warm referral completely bypasses the resume pile and puts you directly on the shortlist. |

### The Secret Direct ATS Search Query (Tier 4 Hack)
Talent teams configure jobs in their ATS days before they appear on LinkedIn or Indeed. Use these Google search strings to find raw, unindexed jobs:
* `site:boards.greenhouse.io "software engineer" "London"`
* `site:jobs.lever.co "data analyst" "remote"`
* `site:myworkdayjobs.com "financial analyst" "United Kingdom"`
* `site:jobs.ashbyhq.com "product designer"`

---

## 3. The Truth About ATS & Knockout Questions

### The "ATS Score" Myth Busted
Career coaches and online resume checkers claim: *"The ATS reads your CV, scores it out of 100, and auto-rejects anything below 80%."*
**This is factually false.** As an ex-builder of ATS systems and enterprise recruitment tools (Workday, Greenhouse, Ashby, Lever), Oliver confirms:
1. No major enterprise ATS assigns an AI match score that automatically deletes your application.
2. What actually filters you out before human eyes see your application is **Knockout Questions**.

```
[ Application Submission ]
            │
            ▼
    [ Knockout Questions ] ──── FAILS (Work Auth, Experience, Licences) ──► AUTO-REJECTED / ARCHIVED
            │
            ├──── PASSES ALL
            ▼
   [ Recruiter Inbox Queue ] ──► Human Recruiter 6-10 Second F-Scan ──► Yes / No / Maybe
```

### The Real Filters
1. **Knockout Questions**: Binary hard filters on the submission form:
   * Right to work / Sponsorship requirement.
   * Specific mandatory licenses or degree requirements.
   * Hard minimum years of commercial experience.
   * *If you fail even one knockout question, the ATS automatically moves your application to the archived folder.*
2. **The 6-to-10 Second Human F-Pattern Scan**: If you pass the knockout questions, a real human recruiter glances at:
   * Current / Target Job Title.
   * Top 3 company names / institutions.
   * First 2-3 bullet points of the most recent role.
   * Hard numbers / metrics that pop out visually.
3. **AI-Polished CV Detection**: Overly generic ChatGPT phrasing ("Spearheaded synergistic cross-functional alignment") immediately signals low effort and triggers an instant skip.

---

## 4. The 39,184 CV Study: Proven Blueprint & Rules

From the comprehensive empirical study of 39,184 real CVs tracked across application-to-interview conversion rates:

### 1. Tailoring is the Single Biggest Lever
* **Tailored CVs converted at 4.23%** vs. **2.07% for generic CVs** (more than double).
* Tailoring does *not* mean rewriting your entire history; it means aligning the **top third of Page 1** (headline, summary, and first 3 bullet points) with the specific keywords and metrics of the target JD.

### 2. The One-Page CV Rule is Dead
* **2-Page CVs interviewed at 7.40%** vs. **5.01% for 1-Page CVs**.
* Cramming experience into 1 page forces candidates to truncate bullet points into shallow duty statements. Recruiters need sufficient **bullet depth** to assess business impact.

### 3. Hard Numbers in Your Summary
* A professional summary containing at least one hard quantified metric (e.g., revenue generated, latency reduced, team size managed, cost saved) saw an immediate uptick in callbacks compared to generic bio paragraphs.

### 4. The RICE Bullet Formula (Depth Over Duty)
* **Duty Bullet (Failed - 80% of applicants)**:  
  *❌ "Responsible for building data pipelines and managing PostgreSQL database."*
* **RICE Impact Bullet (40% Higher Callbacks)**:  
  *✅ "Engineered 4 automated ETL data pipelines in Python and SQL, reducing daily batch reporting latency by 42% for a team of 15 stakeholders."*

```
R — Role: What specific technical responsibility you held
I — Impact: The measurable business outcome (%, £, $, time saved)
C — Context: Scale, tools used, or team size
E — Evidence: Tangible proof of delivery
```

### 5. The 5-Point Second Look Check
Before submitting any CV, run this checklist:
- [ ] **Job Title Alignment**: Does the headline/current title match the exact market name on the JD?
- [ ] **Top-Third Metrics**: Are there at least 3 hard numbers in the top third of page 1?
- [ ] **Zero "Duty" Verbs**: Have you deleted "responsible for", "assisted with", "helped in"?
- [ ] **F-Pattern Readability**: Can a recruiter scanning in an F-pattern grasp your core skills in under 7 seconds?
- [ ] **Standard Clean Typography**: Single-column or clean two-section layout; no rating stars for skills, no heavy graphic bars.

---

## 5. Reverse-Engineering LinkedIn Recruiter SEO

Recruiters don't scroll LinkedIn like a social network; they operate **LinkedIn Recruiter** as a specialized search engine.

```
       [ 700-Word Job Description ]
                   │
                   ▼  (Recruiter compresses into 3 primary fields)
        ┌──────────────────────────────────────────────┐
        │ 1. Exact Job Title  (e.g., Financial Analyst) │
        │ 2. Location         (e.g., London, UK)        │
        │ 3. 3-4 Hard Skills  (e.g., SQL, Power BI)     │
        └──────────────────────────────────────────────┘
                   │
                   ▼  (2 Hidden Recruiter Filters)
        ┌──────────────────────────────────────────────┐
        │ 4. Activity Filter  (Active in last 7 days)   │
        │ 5. Open To Work     (Recruiters Only mode)    │
        └──────────────────────────────────────────────┘
```

### The 5 Recruiter Filters & How to Win Them

#### Filter 1: The Exact Job Title (The 80% Cut)
* Recruiters type the exact standard market title into the search bar.
* **Never hedge**: Putting *"Data Analyst | Product Manager | Scrum Master"* causes you to match weakly on all three. Pick **one target title** for your headline.
* **Internal Title Translation**: If your HR contract says "Associate Specialist II", translate it to the market title you performed: "Operations Lead" or "Full-Stack Engineer".
* **Avoid Under-Leveling**: Never put "Junior", "Graduate", or "Aspiring" in your headline. It filters you out of mid-level searches and artificially depresses your salary band. Put career flexibility in your About section, never in your headline.

#### Filter 2: The Location Filter (City, Never Country)
* Recruiters search by **Metro City** (e.g., "London", "Manchester", "New York"), never "United Kingdom" or small hometowns. If your profile is set to "United Kingdom", you vanish from city-specific searches.

#### Filter 3: Verbatim Hard Skills Match
* The search index scans: Headline, About, Experience Bullets, and Skills section.
* **The 10x Weight Rule**: The top 3 skills on your LinkedIn profile receive ~10x the algorithmic weight of everything below them. Re-order your skills list so the top 3 match your target role.
* Use verbatim terminology: If JDs say `Power BI`, do not write `Data Visualization Tools`. If JDs say `Financial Modeling`, do not write `Building Forecasts`.

#### Filter 4: The 7-Day Activity Algorithm
* Recruiters frequently check the filter **"Active in the last 7 days"** to avoid wasting InMail credits on inactive accounts.
* **The Weekly Maintenance Routine**: Edit one bullet point, update one skill, or make one comment on a relevant post every 7 days to maintain active status.

#### Filter 5: Open to Work (Recruiters Only)
* Set Open to Work to **"Recruiters Only"**. This provides full visibility in LinkedIn Recruiter candidate pools without displaying the green banner to your current network or headhunters who view public banners with skepticism.

### The 3-Part Headline Formula
```
[Target Job Title] | [2–4 Core Hard Skills / Tech Stack] | [Quantified Value / Outcome Statement]
```
* **Example**: `Software Engineer | TypeScript, Node.js, Next.js, PostgreSQL | Building high-throughput web apps supporting 50k+ daily users`
* **Example**: `Financial Analyst | Financial Modeling, SQL, Power BI | Translating complex forecasting into actionable executive decisions`

---

## 6. The 6-Step "Impact Loop" Cold Outreach & Referral Playbook

Why cold applications fail: You are a stranger in a pile of 300 strangers.  
Why warm referrals win: **A referred candidate converts at 15% to 30%** (15x higher).

### The 6-Step Impact Loop

```
Step 1: Identify Peers (15-20% reply) & Managers 1-Level Up (10-15% reply)
   │
Step 2: Send First Message (<50 words, lead with THEM, 1-2 word micro-ask)
   │
Step 3: When they reply, ask for ONE small piece of advice (The Small Favor)
   │
Step 4: The Action Sprint (Actually do what they advised over the weekend!)
   │
Step 5: The Report Back (Close the loop: "I built X based on your tip. Thank you!")
   │
Step 6: Inbound Referral Generated (They offer the referral + inside interview intel)
```

### The 3 Fatal Cold DM Mistakes
1. **The Novel**: Sending 4 paragraphs describing your life history and career ambitions.
2. **The Resume Dump**: Attaching a CV on message #1 and asking for a review or referral.
3. **The Big Ask**: Asking a complete stranger for a 30-minute phone call.

### The Proven 50-Word First Message Template
> *"Hi [Name], I noticed that you also transitioned from [Previous Field/Uni] into [Current Role/Target Field] at [Company]—the exact path I'm working toward right now.*  
> *If you had to point to one tool or concept that made the biggest difference when you started, what would it be?*  
> *No worries at all if you're flat out with work!*  
> *Best,*  
> *[Your Name]"*

### The Follow-Up Cadence
Silence is not rejection; people are simply busy.
* **Day 7**: Gentle bump. *"Hey [Name], just checking in on this—hope you're having a great week!"*
* **Day 14**: Value-add follow up.
* **Day 21**: Final gracious sign-off.

---

## 7. Interview Mastery: The First 90 Seconds, "Tell Me About Yourself", & CCARR

### The Truth About Final Rounds
By the time you reach the final round, **your technical competence is already settled** (proven by your CV, online test, and initial technical screen).  
The final interview is an emotional and cultural alignment decision:  
*“Can I work with this person 40 hours a week for the next 3 years?”*  
The offer goes to the person who shows up like a **colleague**, not a nervous candidate reciting lines.

---

### Answering "Tell Me About Yourself"
* **The Mistake**: Chronologically reading your CV aloud ("First I studied X, then I worked at Y, then I learned Z").
* **The Reality**: The interviewer has your CV in front of them. What they are testing in the first 90 seconds is **warmth, tonality, and your underlying 'Why'**.

#### The Identity-Value-Motivation Structure (90 Seconds)
1. **Current Identity & Value (30s)**: Who you are today and your primary technical strength.
2. **The Origin / Catalyst (30s)**: Why you chose this field *before* the jobs. The underlying problem-solving spark that drives you.
3. **Target Motivation (30s)**: Why this exact company, team, and problem space is the natural next step.

---

### Answering "Why Do You Want to Work Here?" (The Name-Drop Strategy)
* **The Mistake**: Quoting the "About Us" page, reciting company values, or citing general financial press.
* **The 3-Sentence Colleague Framework**:
> *"I'm applying because I spoke with [Employee Name] on your engineering team last week. They walked me through how the team tackles [specific technical or operational problem] day-to-day, and that hands-on, high-ownership environment is exactly where I do my best work."*

---

### Answering Behavioral Questions: The CCARR Framework
Most candidates use STAR and get trapped rambling in the Situation/Task phase. Use **CCARR**:

```
C — Context     (10-15s): Set the scene quickly. Who, where, and when.
C — Challenge   (15-20s): What was the unexpected obstacle or conflict?
A — Action      (40-50s): What *I* did specifically (avoid the "we" trap; own your decisions).
R — Result      (15-20s): Quantified outcome or business delivery.
R — Reflection  (10-15s): What you learned and how it shaped your engineering/work philosophy.
```

> **The Reflection Sentence (The Seniority Signal)**: 95% of candidates stop at Result. Adding: *"Looking back, that experience taught me that early stakeholder validation prevents weeks of architectural rework"* instantly signals senior maturity.

---

## 8. Assessment Centres & Numerical Reasoning Defense

### Assessment Centres: Behavior Over Brains
* **The Fatal Trap**: Trying to be the smartest person in the room who cracks the business case alone.
* **What Assessors Actually Score**:
  * Did you draw quieter candidates into the discussion?
  * Did you handle conflict/disagreements with grace and logic?
  * Did you keep an eye on the clock and drive the group toward an actionable decision?
* **Winning Strategy**: Act as the **Collaborative Driver**. Be the person who summarizes consensus, asks structured questions, and facilitates execution.

### Numerical Reasoning Tests
Online psychometric and numerical tests (SHL, Cappfinity, Korn Ferry, Cubiks) are the single highest early elimination hurdle.
1. **Identify the Provider**: Read your invite email carefully or search `"[Company Name] assessment provider"` to identify the exact testing platform before practicing.
2. **Watch the Axis Units**: 80% of missed numerical questions are simple unit traps (e.g., thousands vs. millions, annualized vs. quarterly).
3. **Verbal Reasoning Isolation**: Never answer from external general knowledge. If the text does not explicitly state it, it is *Cannot Say*, even if true in the real world.

---

## 9. UK Visa Sponsorship & Special Cases Playbook

### Navigating the "Do You Require Sponsorship?" Trap
* **The Problem**: Application forms ask: *"Do you require sponsorship to work in the UK now or in the future?"* Ticking "Yes" triggers an instant automated knockout in most ATS software.
* **The Legal Reality on Graduate / Youth Mobility Visas**:
  * On a Graduate Visa (2 years, 3 for PhD), you have **full, unrestricted right to work**.
  * The employer does **not** need a sponsorship license, does **not** pay the Immigration Skills Charge, and incurs **zero Home Office admin fees**.
  * To the hiring team for those 2 years, you are legally identical to a domestic applicant.
* **How to Answer**:
  * If the question asks *"Do you currently have the right to work in the UK?"* -> **YES**.
  * If it asks *"Do you currently require sponsorship to work in the UK?"* -> **NO**.
  * Bring up sponsorship at the **final offer stage**, after the team has evaluated your value and fallen in love with your work.

### The 808 Licensed Sponsors Nobody Targets
Most international applicants crowd into the top 10 investment banks and Big 4 consultancies. The UK Home Office maintains a register of licensed sponsors. Hundreds of mid-market technology, engineering, and logistics firms (under 500 employees) hold licenses but receive virtually zero international applicant outreach.

---

## 10. The 7-Day Rapid Execution Sprint

If you need interviews generated within 7 days, execute Daniel's step-by-step sprint:

```
┌───────┬────────────────────────────────────────────────────────────────────────┐
│ Day   │ Primary Milestone & Execution Tasks                                    │
├───────┼────────────────────────────────────────────────────────────────────────┤
│ Day 1 │ Audit & Personal Brand Alignment: Define single target role title,     │
│       │ identify 3 core skill pillars, and craft 90-second 'Why' story.        │
├───────┼────────────────────────────────────────────────────────────────────────┤
│ Day 2 │ Build Target List: Research 30 high-conviction companies (10 large,   │
│       │ 20 mid-market <250 employees). Run Google ATS queries for live roles.  │
├───────┼────────────────────────────────────────────────────────────────────────┤
│ Day 3 │ LinkedIn Recruiter Optimization: Update headline, copy CV bullets to   │
│       │ experience, reorder top 3 skills, and toggle Recruiters Only OpenToWork│
├───────┼────────────────────────────────────────────────────────────────────────┤
│ Day 4 │ Outreach Wave 1: Identify 2 peers and 1 manager at 15 target firms.   │
│       │ Send 25 personalized, 50-word low-friction messages.                  │
├───────┼────────────────────────────────────────────────────────────────────────┤
│ Day 5 │ The Impact Loop: Respond to all replies. Ask for 1 small piece of       │
│       │ tactical advice. Run a weekend sprint to build/read what they suggest. │
├───────┼────────────────────────────────────────────────────────────────────────┤
│ Day 6 │ Hyper-Targeted Applications: Submit 3 tailored applications where you   │
│       │ now have an internal contact. Embed their name in your cover letter.   │
├───────┼────────────────────────────────────────────────────────────────────────┤
│ Day 7 │ Interview Drill: Run 30 repetitions of CCARR behavioral stories and     │
│       │ test audio/video tonality for the first 90 seconds.                    │
└───────┴────────────────────────────────────────────────────────────────────────┘
```

---
*Generated directly from Oliver Cordingley's channel video archive for your job search.*
"""

# ==============================================================================
# 2. BUILD THE COMPREHENSIVE ALL-VIDEOS REFERENCE
# ==============================================================================
all_videos_md = """# Oliver Cordingley YouTube Channel Archive
### Detailed Video-by-Video Index, Timestamps, & Key Insights (40 Deep Dives)

> **Channel**: [Oliver Cordingley (@olivercordingley)](https://www.youtube.com/@olivercordingley)  
> **Total Long-Form Videos**: 40  
> **Total Transcripts Analyzed**: 32,936+ words of raw transcript & detailed chapter breakdowns.

---

## Video Directory by Category

### Category 1: CV, Resume & Application Science
1. [Why Recruiters Skip Your CV in Seconds (39,184 CVs Analysed)](#1-why-recruiters-skip-your-cv-in-seconds-39184-cvs-analysed)
2. [8 CV Rules That Double Your Interviews (From 39,184 CVs)](#2-8-cv-rules-that-double-your-interviews-from-39184-cvs)
3. [Is Your CV Getting Rejected? 5 Mistakes You Must Fix](#3-is-your-cv-getting-rejected-5-mistakes-you-must-fix)
4. [Why Recruiters Keep Skipping Your CV](#4-why-recruiters-keep-skipping-your-cv)
5. [I Reviewed 100 Job Applications: Here Is What I Found](#5-i-reviewed-100-job-applications-here-is-what-i-found)
6. [4 Cover Letter RED FLAGS (Avoid These Mistakes!)](#6-4-cover-letter-red-flags-avoid-these-mistakes)

### Category 2: LinkedIn & Recruiter Search Inbound
7. [If You Don't Understand Recruiter Search, You Don't Understand LinkedIn](#7-if-you-dont-understand-recruiter-search-you-dont-understand-linkedin)
8. [What Recruiters See on Your LinkedIn](#8-what-recruiters-see-on-your-linkedin)
9. [How to Write a LinkedIn Headline That Recruiters Actually Search For](#9-how-to-write-a-linkedin-headline-that-recruiters-actually-search-for)
10. [4 LinkedIn Changes That Got Me 19 Recruiter Messages (No Applications)](#10-4-linkedin-changes-that-got-me-19-recruiter-messages-no-applications)
11. [Why Recruiters Skip Your LinkedIn Profile in 10 Seconds](#11-why-recruiters-skip-your-linkedin-profile-in-10-seconds)
12. [How to Get a Job on LinkedIn (Step-by-step)](#12-how-to-get-a-job-on-linkedin-step-by-step)

### Category 3: Networking, Cold Messaging & The Hidden Job Market
13. [The Secret to Getting Referrals From People You Don't Know](#13-the-secret-to-getting-referrals-from-people-you-dont-know)
14. [Why Nobody Replies to Your LinkedIn DMs | The Cold Message Formula That Gets Replies](#14-why-nobody-replies-to-your-linkedin-dms--the-cold-message-formula-that-gets-replies)
15. [Stop Applying Online | How to Land a Job in the Hidden Job Market](#15-stop-applying-online--how-to-land-a-job-in-the-hidden-job-market)
16. [Stop Applying To More Jobs | Why You Can't Get A Job Right Now](#16-stop-applying-to-more-jobs--why-you-cant-get-a-job-right-now)
17. [How He Got A Software Engineering Job With No Experience](#17-how-he-got-a-software-engineering-job-with-no-experience)
18. [How to Get Hired With Zero Experience](#18-how-to-get-hired-with-zero-experience)

### Category 4: Interview Mastery & Assessment Centres
19. [Why You Get The Interview But Not The Job (And How To Fix It)](#19-why-you-get-the-interview-but-not-the-job-and-how-to-fix-it)
20. [Tell Me About Yourself: Why You're Not Getting The Job](#20-tell-me-about-yourself-why-youre-not-getting-the-job)
21. [The 1 Question That Ruins Most Interviews, The Tell Me About Yourself Question](#21-the-1-question-that-ruins-most-interviews-the-tell-me-about-yourself-question)
22. [The Interview Question That Costs You The Job | Why Do You Want To Work Here](#22-the-interview-question-that-costs-you-the-job--why-do-you-want-to-work-here)
23. [How to Nail 'Tell Me About a Time' Every Time](#23-how-to-nail-tell-me-about-a-time-every-time)
24. [Why You're Failing Assessment Centres (And How To Fix It)](#24-why-youre-failing-assessment-centres-and-how-to-fix-it)
25. [Why Most Candidates Fail Numerical Reasoning (And How You Won't)](#25-why-most-candidates-fail-numerical-reasoning-and-how-you-wont)

### Category 5: ATS Truth, AI Tools & Job Market Realities
26. [ATS vs. Recruiters: The Real Reason You're Not Getting Interviews](#26-ats-vs-recruiters-the-real-reason-youre-not-getting-interviews)
27. [Knockout Questions: The Real Reason You're Not Getting Hired](#27-knockout-questions-the-real-reason-youre-not-getting-hired)
28. [AI is already rejecting your job application](#28-ai-is-already-rejecting-your-job-application)
29. [How HireVue AI Actually Scores You](#29-how-hirevue-ai-actually-scores-you)
30. [ChatGPT Won't Get You Hired in 2026 (This Will)](#30-chatgpt-wont-get-you-hired-in-2026-this-will)
31. [Ghost Jobs: The Real Reason You're Not Getting Interviews](#31-ghost-jobs-the-real-reason-youre-not-getting-interviews)
32. [Every Way to Find a Job in the UK, Ranked Worst to Best](#32-every-way-to-find-a-job-in-the-uk-ranked-worst-to-best)
33. [The UK Job Market Is Broken | 3 Things You MUST Do in 2026](#33-the-uk-job-market-is-broken--3-things-you-must-do-in-2026)
34. [How To ACTUALLY Get a Job in 2026](#34-how-to-actually-get-a-job-in-2026)
35. [The REAL Reason You Can't Get A Job (& How to Fix it)](#35-the-real-reason-you-cant-get-a-job--how-to-fix-it)
36. [If you can't get a job, please watch this](#36-if-you-cant-get-a-job-please-watch-this)
37. [How To Get a Job in 7 Days (steal this)](#37-how-to-get-a-job-in-7-days-steal-this)
38. [The 'Signal Flip' Strategy That Doubled This Candidate's Salary](#38-the-signal-flip-strategy-that-doubled-this-candidates-salary)
39. [You Need Sponsorship? Probably Not | Work In The UK Without Sponsorship](#39-you-need-sponsorship-probably-not--work-in-the-uk-without-sponsorship)
40. [She Had 60 Days Or Leave The UK](#40-she-had-60-days-or-leave-the-uk)

---

## Detailed Video Breakdowns

"""

for idx, v in enumerate(videos, 1):
    title = v["title"]
    duration = v["duration"]
    url = v["url"]
    desc = v.get("description", "")
    transcript = v.get("transcript", "")
    
    # Extract chapters from desc if present
    chapters = []
    for line in desc.split("\n"):
        line_s = line.strip()
        if any(line_s.startswith(f"{m}:") or line_s.startswith(f"0{m}:") for m in range(0, 60)) or "0:00" in line_s:
            chapters.append(line_s)
    
    # Extract core take-aways
    summary_snippet = ""
    if transcript:
        # Use first ~400 chars of transcript
        summary_snippet = transcript[:450].strip() + "..."
    else:
        # Use first lines of description
        non_empty = [l.strip() for l in desc.split("\n") if l.strip() and not l.startswith("http") and not l.startswith("#")]
        summary_snippet = " ".join(non_empty[:3])
        if len(summary_snippet) > 400:
            summary_snippet = summary_snippet[:400] + "..."

    all_videos_md += f"### {idx}. {title}\n\n"
    all_videos_md += f"* **Watch Link**: [{url}]({url})\n"
    all_videos_md += f"* **Duration**: `{duration}`\n\n"
    all_videos_md += f"#### Core Overview\n{summary_snippet}\n\n"
    
    if chapters:
        all_videos_md += "#### Key Chapters & Timestamps\n"
        for ch in chapters[:8]:
            all_videos_md += f"* `{ch}`\n"
        all_videos_md += "\n"
        
    all_videos_md += "---\n\n"

# Write files
with open(PLAYBOOK_PATH, "w", encoding="utf-8") as f:
    f.write(playbook_content)
print(f"Written master playbook to {PLAYBOOK_PATH}")

with open(ALL_VIDEOS_PATH, "w", encoding="utf-8") as f:
    f.write(all_videos_md)
print(f"Written all videos breakdown to {ALL_VIDEOS_PATH}")

print("All documents generated successfully!")
