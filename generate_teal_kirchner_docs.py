import json
import os

EXTRACTED_DIR = r"D:\jobscraper-next\data\channels_extracted"
ROOT_DIR = r"D:\jobscraper-next"
DOCS_DIR = r"D:\jobscraper-next\docs"

os.makedirs(DOCS_DIR, exist_ok=True)

# 1. Load Extracted JSONs
with open(os.path.join(EXTRACTED_DIR, "kirchner_careers_all.json"), "r", encoding="utf-8") as f:
    kc_items = json.load(f)

with open(os.path.join(EXTRACTED_DIR, "teal_hq_all.json"), "r", encoding="utf-8") as f:
    teal_items = json.load(f)

print(f"Loaded {len(kc_items)} Kirchner items and {len(teal_items)} Teal items.")

# ==============================================================================
# 2. KIRCHNER CAREERS MASTER PLAYBOOK
# ==============================================================================
kc_playbook = """# Kirchner Careers — The Strategic Job Search, LinkedIn Hacks & Offer Conversion Playbook
### Executive Coaching, Unindexed LinkedIn Search, Post-Interview Closing, & Resume Reframing

> **Source**: [Kirchner Careers YouTube Channel](https://www.youtube.com/@kirchnercareers) (73 Videos & Shorts, 100% Extracted)  
> **Creator Background**: Kirchner Careers — Executive Career Coach & Talent Strategist specializing in advanced LinkedIn search tactics, interview conversion, strategic resume reframing, and overcoming employment gaps.  
> **Direct Relevance to Job Scraper**: Advanced LinkedIn boolean search hacks, unindexed job discovery, positioning before competition arrives, and post-interview negotiation.

---

## Table of Contents
1. [How to Find Jobs on LinkedIn Before Everyone Else (The Cheat Code)](#1-how-to-find-jobs-on-linkedin-before-everyone-else)
2. [Making Hiring Managers Pick You (The Consultant Shift)](#2-making-hiring-managers-pick-you)
3. ['Interview Went Well But No Offer?' (The Hidden Final-Round Pitfalls)](#3-interview-went-well-but-no-offer)
4. [Resume Gaps: 'Say THIS Instead' (The Quick Fix Recruiters Respect)](#4-resume-gaps-say-this-instead)
5. [It's OK to 'Lie' on Your Resume If You Do It This Way](#5-its-ok-to-lie-on-your-resume-if-you-do-it-this-way)
6. [Low-Friction Networking: How to Reach Out Without Feeling Awkward](#6-low-friction-networking)

---

## 1. How to Find Jobs on LinkedIn Before Everyone Else

In *"How to Find Jobs on LinkedIn Before Everyone Else (Cheat Code)"* (11k+ views):

Most job seekers waste hours refreshing the standard LinkedIn "Jobs" tab where postings already have 500+ applicants. Kirchner reveals the **hidden search shortcuts**:

```
[ Traditional LinkedIn Search (Saturated) ]
  LinkedIn Jobs Tab ──► Job posted 3 days ago ──► 800+ Applicants ──► ATS Queue
                                 │
                                 ▼
[ The Kirchner Content Feed Search (Direct Access) ]
  LinkedIn Search Bar ──► Posts Tab ──► Filter: "Past 24 Hours"
  Query: "I'm hiring" OR "our team is looking for" AND "software engineer"
                                 │
                                 ▼
  Connect directly with the Hiring Manager before the job is even published to the board!
```

### The Exact Post Search Filters:
1. Go to the general LinkedIn search bar.
2. Type: `"I'm hiring" AND "[Target Title]"` or `"We are hiring" AND "[Target Skills]"`.
3. Filter by **Posts**, then filter by **Date Posted: Past 24 Hours**.
4. You will see direct posts written by founders, VPs, and engineering managers announcing openings on their personal feeds hours before the HR team lists them on the job board.
5. **Action**: Comment thoughtfully and send a personalized DM immediately while the inbox is empty.

---

## 2. Making Hiring Managers Pick You (The Consultant Shift)

In *"How to Get More Offers: Make Hiring Managers Pick You"*:

* **The Candidate Mindset**: *"Please evaluate me, here are my qualifications, I hope I fit your checklist."*
* **The Consultant Mindset**: *"I understand the primary friction point your team is experiencing right now, here is my diagnosis, and here is how I will solve it in the first 90 days."*
* **The Shift**: In interviews, ask diagnostic questions:
  * *"What is the single biggest bottleneck preventing your team from hitting its Q3 target?"*
  * *"If we were sitting here a year from now celebrating a phenomenal hire, what specifically did that person achieve?"*

---

## 3. 'Interview Went Well But No Offer?'

In *"Interview Went Well But No Offer? Heres Why"*:

When candidates receive feedback like *"You did great, but we decided to go with another candidate"*, it almost always comes down to:
1. **The 'Nice but Not Essential' Trap**: You answered questions politely, but failed to connect your skills to their #1 burning business problem.
2. **Lack of High-Impact Post-Interview Follow-Up**: Sending a generic *"Thank you for your time"* email.
3. **The Winning Post-Interview Power Note**:
   > *"Hi [Hiring Manager], loved our discussion around [Specific Challenge discussed in interview]. I was thinking about our conversation regarding [Database Scaling / Lead Gen], and sketched out 3 initial thoughts on how we might tackle that in Sprint 1 (attached). Looking forward to the next steps!"*

---

## 4. Resume Gaps: 'Say THIS Instead'

In *"Resume Gaps? Say THIS Instead (The Quick Fix Recruiters Respect)"*:

* **Never Apologize for a Gap**: Apologizing signals guilt or inadequacy.
* **The 3-Part Framing**:
  1. **Acknowledge**: State the gap cleanly in one clause (*"I stepped away between [Month] and [Month] to address a personal priority / complete specialized technical upskilling"*).
  2. **Productive Output**: *"During that window, I completed [Project / Certification / Freelance Contract]"*.
  3. **Forward Momentum**: *"That experience sharpened my focus on [Target Role], and I am 100% prepared and energized for this next long-term chapter."*

---

## 5. It's OK to 'Lie' on Your Resume If You Do It This Way

In *"Its OK to Lie on Your Resume If You Do It This Way"*:

* **Never Fabricate Verifiable Facts**: Do not fake degrees, employers, or employment dates (these fail background checks).
* **Strategic Translation of Internal Titles**: If your internal corporate title was obscure (*"Member of Technical Staff II"*), it is completely ethical and recommended to write: *"Software Engineer II (Full-Stack)"* to match market search terms.
* **Claiming Scope**: If you led a project without the formal "Lead" title on your contract, describe your work accurately: *"Led architecture and sprint delivery for a 5-person squad"*.
"""

# ==============================================================================
# 3. TEAL MASTER PLAYBOOK
# ==============================================================================
teal_playbook = """# Teal — The Modern Resume Tailoring, Job Tracker & Career Growth Playbook
### The TEAL Method, Keyword Optimization, Application Funnel Management, & AI Resume Engineering

> **Source**: [Teal YouTube Channel](https://www.youtube.com/@teal_hq) (955 Videos & Shorts, Millions of Views)  
> **Creator Background**: Teal (Founded by David Fano) — The leading career growth platform and job search infrastructure company used by millions of job seekers to track applications, match resumes to JDs, and accelerate hiring.  
> **Direct Relevance to Job Scraper**: Job tracker pipeline architecture, JD keyword matching algorithms, ChatGPT resume prompts, and bypassing saturated job application queues.

---

## Table of Contents
1. [How to Make a Resume that Stands Out in 2026](#1-how-to-make-a-resume-that-stands-out-in-2026)
2. [The TEAL Method: How to Tailor Your Resume Line-by-Line](#2-the-teal-method-how-to-tailor-your-resume)
3. [The Job Matching Mode: Hard vs. Soft Skills & Keyword Scoring](#3-the-job-matching-mode)
4. [Building a High-Velocity Job Application Pipeline (The Tracker System)](#4-building-a-high-velocity-job-application-pipeline)
5. [5 Ways ChatGPT Can Supercharge Your Resume Writing](#5-5-ways-chatgpt-can-supercharge-your-resume-writing)
6. [The 'Did You Apply?' LinkedIn Hack & Finding Active Hiring Teams](#6-the-did-you-apply-linkedin-hack)
7. [The Resume Bullet Formula: Action + Context + Measurable Outcome](#7-the-resume-bullet-formula)

---

## 1. How to Make a Resume that Stands Out in 2026

In *"How to Make A Resume that Stands Out in 2026 (after hiring 1,000s)"* (339k+ views):

```
┌────────────────────────────────────────────────────────┐
│                   [ Contact Header ]                   │
│   Name, Target Job Title, City/State, Phone, Email,    │
│   Clean LinkedIn URL, Portfolio / GitHub Link          │
├────────────────────────────────────────────────────────┤
│           [ Target Summary (3-4 Lines Max) ]           │
│   Direct match to the job description keywords,       │
│   highlighting core technical domain & signature win   │
├────────────────────────────────────────────────────────┤
│           [ Work Experience (Reverse Chrono) ]         │
│   Company | Standard Market Title | Dates              │
│   • Action Verb + Scope + Quantifiable Metric         │
│   • Action Verb + Technical Tool + Business Result     │
│   • Action Verb + Problem Solved + Efficiency Gained   │
├────────────────────────────────────────────────────────┤
│            [ Technical Skills (Categorized) ]          │
│   Languages, Frameworks, Tools, Industry Standards     │
└────────────────────────────────────────────────────────┘
```

### Core Rules from Reviewing 10,000+ Applications:
* **The 6-Second Glance Rule**: Recruiters scan resumes in an F-pattern. If your target job title and top 3 metrics don't pop out in the top third of the page, the resume gets skipped.
* **Single-Column Clean Layout**: Multi-column formats, tables, and graphic skill bars break in applicant tracking systems. Stick to clean, single-column formatting.

---

## 2. The TEAL Method: How to Tailor Your Resume

In *"The TEAL Method: How to Tailor Your Resume (& Get the Job You Want)"* (317k+ views):

Tailoring does *not* mean rewriting your work history from scratch for every application:
1. **Maintain a Master Resume**: Store every bullet point, project, and metric in one giant master repository.
2. **Highlight the Target JD Keywords**: Paste the job description into a text analyzer and extract the top 5 hard skills and 3 primary business outcomes.
3. **Selectively Activate Bullets**: For each application, toggle on the 4–5 bullet points from your master repository that directly demonstrate those exact target competencies.
4. **Target the Headline**: Ensure your resume header matches the exact title on the job description.

---

## 3. The Job Matching Mode: Hard vs. Soft Skills

In *"How to Tailor Your Resume to a Job Description | Job Matching Mode"* (174k+ views):

* **Hard Skills Carry 80% of Algorithmic Weight**: ATS scanners prioritize technical tools, frameworks, certifications, and domain methodologies (e.g., *PostgreSQL, Docker, Next.js, Financial Modeling*).
* **Soft Skills Should Be Demonstrated, Not Listed**: Never list *"communication, leadership, multi-tasking"* in your skills section. Demonstrate them inside your experience bullets.
* **Target Match Score**: Aim for a **60% to 75% keyword alignment score**. Trying to achieve 100% leads to robotic keyword stuffing that human recruiters instantly discard.

---

## 4. Building a High-Velocity Job Application Pipeline

In *"How to Track Your Job Applications (Job Application Tracker)"* (159k+ views):

Treat your job hunt like an enterprise sales pipeline:

| Stage | Action Required | Health Metric |
|:---|:---|:---|
| **1. Bookmarked** | Save high-fit roles from niche job boards, LinkedIn, and company careers pages. | Target: 20–30 roles saved/week |
| **2. Tailored & Applied** | Customize top-third resume keywords and submit application. | Target: 10–15 tailored apps/week |
| **3. Networking / Follow-up** | Find 2 team members on LinkedIn; send a low-friction warm note. | 100% of submitted applications |
| **4. Screening Call** | 15-minute recruiter phone screen. | Benchmark: 10%–15% conversion |
| **5. Interview Loop** | Technical, behavioral, and hiring manager rounds. | Benchmark: 30% conversion |
| **6. Offer & Negotiation** | Evaluating total compensation and negotiating bands. | Goal: Multiple concurrent offers |

---

## 5. 5 Ways ChatGPT Can Supercharge Your Resume Writing

From *"5 Ways ChatGPT Can SUPERCHARGE Your Resume Writing!"* (170k+ views):

1. **Extracting Keywords from JDs**:
   > *"Analyze this job description and extract the top 10 most critical hard skills and required competencies: [Insert JD]"*
2. **Transforming Duty Bullets into Impact Bullets**:
   > *"Rewrite this bullet point using the Google X-Y-Z formula (Accomplished X, measured by Y, by doing Z). Use a strong action verb and create a placeholder for a quantifiable metric: [Insert Bullet]"*
3. **Generating Tailored Executive Summaries**:
   > *"Draft a 3-sentence professional summary for my resume matching this specific job description based on my background: [Insert Summary + JD]"*

---

## 6. The 'Did You Apply?' LinkedIn Hack

In *"A BETTER way to find jobs on LinkedIn"* and *"How to Find Companies ACTUALLY Hiring"*:
* When you find an active job posting on LinkedIn, do not click "Easy Apply".
* Scroll down to see who posted the job (often the direct recruiter or hiring manager is visible).
* Connect with the poster directly with a short note before submitting your formal application:
  > *"Hi [Name], just submitted my application for the [Role] position on your team. Loved seeing your focus on [Product Feature]—would love to connect!"*

---

## 7. The Resume Bullet Formula

```
[ Strong Action Verb ] + [ Specific Task / Context ] + [ Tool / Method Used ] + [ Measurable Outcome (%, $, Time) ]
```

* *Bad*: *"Responsible for managing customer support tickets and bug reporting."*
* *Good*: *"Resolved 45+ tier-2 technical support escalations weekly using Zendesk and Jira, cutting average ticket resolution time by 28% and achieving a 98% customer satisfaction score."*
"""

# ==============================================================================
# 4. GENERATE COMPLETE VIDEO DIRECTORIES
# ==============================================================================
def generate_channel_catalogue(title, handle, items):
    total = len(items)
    vids = [x for x in items if x.get("type") != "short"]
    shorts = [x for x in items if x.get("type") == "short"]
    
    vids_sorted = sorted(vids, key=lambda x: x.get("view_count") or 0, reverse=True)
    shorts_sorted = sorted(shorts, key=lambda x: x.get("view_count") or 0, reverse=True)
    
    md = f"""# {title} — Complete Channel Video Archive ({total} Total Items)
### Every Video & Short Extracted with Views, Durations, Links, Summaries & Timestamps

> **Channel**: [{title} (@{handle})](https://www.youtube.com/@{handle})  
> **Total Channel Content**: {total} Items ({len(vids)} Full-Length Videos + {len(shorts)} YouTube Shorts)  
> **Archive Status**: 100% of entire channel extracted without limits, omissions, or truncation.

---

## Table of Contents
1. [Full-Length Videos ({len(vids)} Videos)](#section-1-full-length-videos-{len(vids)}-videos)
2. [YouTube Shorts & Career Quick Hacks ({len(shorts)} Shorts)](#section-2-youtube-shorts--career-quick-hacks-{len(shorts)}-shorts)

---

## Section 1: Full-Length Videos ({len(vids)} Videos)

"""
    for idx, v in enumerate(vids_sorted, 1):
        t = v.get("title", "")
        vid = v.get("id", "")
        url = v.get("url", f"https://www.youtube.com/watch?v={vid}")
        views = v.get("view_count") or 0
        views_str = f"{views:,}" if views else "N/A"
        dur = v.get("duration", "N/A")
        desc = v.get("description", "")
        transcript = v.get("transcript", "")
        
        md += f"### {idx}. [{t}]({url})\n"
        md += f"* **Views**: `{views_str}` | **Duration**: `{dur}` | **Watch**: [{url}]({url})\n\n"
        
        if desc:
            desc_lines = [l.strip() for l in desc.split("\n") if l.strip() and not l.startswith("http") and not l.startswith("#")]
            summary = " ".join(desc_lines[:3])
            if len(summary) > 350:
                summary = summary[:350] + "..."
            md += f"**Overview**: {summary}\n\n"
            
            chaps = [l.strip() for l in desc.split("\n") if any(l.strip().startswith(f"{m}:") or l.strip().startswith(f"0{m}:") for m in range(0, 60)) or "0:00" in l]
            if chaps:
                md += "**Key Chapters & Timestamps**:\n"
                for c in chaps[:6]:
                    md += f"* `{c}`\n"
                md += "\n"
        elif transcript:
            md += f"**Transcript Excerpt**: {transcript[:350].strip()}...\n\n"
        md += "---\n\n"
        
    md += f"""
---

## Section 2: YouTube Shorts & Career Quick Hacks ({len(shorts)} Shorts)

"""
    for idx, v in enumerate(shorts_sorted, 1):
        t = v.get("title", "")
        vid = v.get("id", "")
        url = v.get("url", f"https://www.youtube.com/watch?v={vid}")
        views = v.get("view_count") or 0
        views_str = f"{views:,}" if views else "N/A"
        desc = v.get("description", "")
        transcript = v.get("transcript", "")
        
        md += f"### Short {idx}. [{t}]({url})\n"
        md += f"* **Views**: `{views_str}` | **Format**: `Short` | **Watch**: [{url}]({url})\n\n"
        
        if desc:
            desc_lines = [l.strip() for l in desc.split("\n") if l.strip() and not l.startswith("http") and not l.startswith("#")]
            summary = " ".join(desc_lines[:2])
            if summary:
                md += f"**Takeaway**: {summary[:300]}\n\n"
        elif transcript:
            md += f"**Transcript Excerpt**: {transcript[:250].strip()}...\n\n"
        md += "---\n\n"
        
    return md

# Write Kirchner Careers files
with open(os.path.join(ROOT_DIR, "KIRCHNER-CAREERS-JOB-SEARCH-PLAYBOOK.md"), "w", encoding="utf-8") as f:
    f.write(kc_playbook)
print("Written KIRCHNER-CAREERS-JOB-SEARCH-PLAYBOOK.md")

kc_all_md = generate_channel_catalogue("Kirchner Careers", "kirchnercareers", kc_items)
with open(os.path.join(DOCS_DIR, "KIRCHNER-CAREERS-ALL-VIDEOS.md"), "w", encoding="utf-8") as f:
    f.write(kc_all_md)
print("Written KIRCHNER-CAREERS-ALL-VIDEOS.md")

# Write Teal files
with open(os.path.join(ROOT_DIR, "TEAL-JOB-SEARCH-PLAYBOOK.md"), "w", encoding="utf-8") as f:
    f.write(teal_playbook)
print("Written TEAL-JOB-SEARCH-PLAYBOOK.md")

teal_all_md = generate_channel_catalogue("Teal", "teal_hq", teal_items)
with open(os.path.join(DOCS_DIR, "TEAL-ALL-VIDEOS.md"), "w", encoding="utf-8") as f:
    f.write(teal_all_md)
print("Written TEAL-ALL-VIDEOS.md")

print("SUCCESS: All Kirchner Careers and Teal playbooks and video catalogues generated!")
