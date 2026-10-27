import json
import os
import glob

META_DIR = r"D:\jobscraper-next\data\channels_meta"
EXTRACTED_DIR = r"D:\jobscraper-next\data\channels_extracted"
ROOT_DIR = r"D:\jobscraper-next"
DOCS_DIR = r"D:\jobscraper-next\docs"

os.makedirs(DOCS_DIR, exist_ok=True)

# Define Channel Configurations
CHANNELS = {
    "a_life_after_layoff": {
        "creator": "Bryan Creely",
        "title": "A Life After Layoff",
        "channel_url": "https://www.youtube.com/@ALifeAfterLayoff",
        "playbook_file": os.path.join(ROOT_DIR, "A-LIFE-AFTER-LAYOFF-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "A-LIFE-AFTER-LAYOFF-ALL-VIDEOS.md"),
    },
    "saarim_asady": {
        "creator": "Saarim Asady",
        "title": "Saarim Asady",
        "channel_url": "https://www.youtube.com/@Saarim-Asady",
        "playbook_file": os.path.join(ROOT_DIR, "SAARIM-ASADY-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "SAARIM-ASADY-ALL-VIDEOS.md"),
    },
    "emily_durham": {
        "creator": "Emily Durham",
        "title": "Emily Durham",
        "channel_url": "https://www.youtube.com/@Emily.Durham",
        "playbook_file": os.path.join(ROOT_DIR, "EMILY-DURHAM-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "EMILY-DURHAM-ALL-VIDEOS.md"),
    },
    "wilson_wye": {
        "creator": "Wilson Wye",
        "title": "Wilson Wye",
        "channel_url": "https://www.youtube.com/@wilsonwye/videos",
        "playbook_file": os.path.join(ROOT_DIR, "WILSON-WYE-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "WILSON-WYE-ALL-VIDEOS.md"),
    },
    "diandra_escobar": {
        "creator": "Diandra Escobar",
        "title": "Diandra Escobar",
        "channel_url": "https://www.youtube.com/@diandraescobarr",
        "playbook_file": os.path.join(ROOT_DIR, "DIANDRA-ESCOBAR-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "DIANDRA-ESCOBAR-ALL-VIDEOS.md"),
    },
    "farah_sharghi": {
        "creator": "Farah Sharghi",
        "title": "Farah Sharghi",
        "channel_url": "https://www.youtube.com/@Farah_Sharghi",
        "playbook_file": os.path.join(ROOT_DIR, "FARAH-SHARGHI-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "FARAH-SHARGHI-ALL-VIDEOS.md"),
    },
    "career_shakers": {
        "creator": "Davis Nguyen & Career Shakers Team",
        "title": "Career Shakers",
        "channel_url": "https://www.youtube.com/@CareerShakers",
        "playbook_file": os.path.join(ROOT_DIR, "CAREER-SHAKERS-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "CAREER-SHAKERS-ALL-VIDEOS.md"),
    }
}

# Helper to load video metadata
def load_channel_videos(ch_key):
    flat_file = os.path.join(META_DIR, f"{ch_key}_flat.json")
    top_file = os.path.join(EXTRACTED_DIR, f"{ch_key}_top.json")
    
    entries = []
    if os.path.exists(flat_file):
        with open(flat_file, "r", encoding="utf-8") as f:
            entries = json.load(f).get("entries", [])
            
    top_dict = {}
    if os.path.exists(top_file):
        with open(top_file, "r", encoding="utf-8") as f:
            for item in json.load(f):
                top_dict[item["id"]] = item
                
    return entries, top_dict

def format_video_list(entries, top_dict, limit=100):
    sorted_entries = sorted(entries, key=lambda x: x.get("view_count") or 0, reverse=True)
    md = ""
    for idx, e in enumerate(sorted_entries[:limit], 1):
        vid = e.get("id")
        title = e.get("title", "")
        duration = e.get("duration", "N/A")
        views = e.get("view_count", 0)
        url = f"https://www.youtube.com/watch?v={vid}"
        
        detail = top_dict.get(vid, {})
        desc = detail.get("description", "")
        transcript = detail.get("transcript", "")
        
        md += f"### {idx}. [{title}]({url})\n"
        md += f"* **Views**: `{views:,}` | **Duration**: `{duration}` | [Watch on YouTube]({url})\n\n"
        
        if desc:
            # Get first 3 meaningful lines of description
            desc_lines = [l.strip() for l in desc.split("\n") if l.strip() and not l.startswith("http") and not l.startswith("#")]
            summary = " ".join(desc_lines[:3])
            if len(summary) > 350:
                summary = summary[:350] + "..."
            md += f"**Core Overview**: {summary}\n\n"
            
            # Extract chapters if any
            chaps = [l.strip() for l in desc.split("\n") if any(l.strip().startswith(f"{m}:") or l.strip().startswith(f"0{m}:") for m in range(0, 60)) or "0:00" in l]
            if chaps:
                md += "**Key Chapters & Timestamps**:\n"
                for c in chaps[:6]:
                    md += f"* `{c}`\n"
                md += "\n"
        md += "---\n\n"
    return md

# ==============================================================================
# 1. A LIFE AFTER LAYOFF (Bryan Creely)
# ==============================================================================
entries, top_dict = load_channel_videos("a_life_after_layoff")

playbook_alal = """# A Life After Layoff — The Corporate Recruiter & HR Insider Playbook
### Insider Strategies Synthesized from Bryan Creely (20+ Years Corporate Recruiter & Headhunter)

> **Source**: [A Life After Layoff YouTube Channel](https://www.youtube.com/@ALifeAfterLayoff) (545+ Videos, Millions of Views)  
> **Creator Background**: Bryan Creely — Senior Corporate Recruiter, Agency Headhunter, and Career Coach who spent two decades inside corporate talent acquisition and HR screening rooms.  
> **Primary Focus**: Deconstructing the hidden mechanics of corporate hiring, ATS realities, avoiding disqualification traps, interview psychology, salary negotiation leverage, surviving layoffs, and navigating toxic workplaces.

---

## Table of Contents
1. [The Recruiter's Perspective: How Hiring Really Works](#1-the-recruiters-perspective-how-hiring-really-works)
2. [10 Things You Must Never Reveal in a Job Interview](#2-10-things-you-must-never-reveal-in-a-job-interview)
3. [The Fatal Counter-Offer Trap: Why You Must Never Accept One](#3-the-fatal-counter-offer-trap-why-you-must-never-accept-one)
4. [Interview Red Flags: Spotting Toxic Employers Before You Sign](#4-interview-red-flags-spotting-toxic-employers-before-you-sign)
5. [Resume Mistakes That Trigger Instant Rejection](#5-resume-mistakes-that-trigger-instant-rejection)
6. [Salary Negotiation Leverage: Deflecting Early Number Traps](#6-salary-negotiation-leverage-deflecting-early-number-traps)
7. [Layoff Survival & Severance Strategy](#7-layoff-survival--severance-strategy)
8. [Corporate Realities: 'Your Coworkers Are Not Your Friends'](#8-corporate-realities-your-coworkers-are-not-your-friends)

---

## 1. The Recruiter's Perspective: How Hiring Really Works

Most job seekers view hiring as an objective evaluation of who is best at doing the job. In reality, **corporate recruiting is an exercise in risk reduction and speed**:

```
[ 300+ Resumes Received ]
            │
            ▼
    [ Fast Exclusion Scan ] ──► 5-10 seconds per resume looking for ANY reason to say "NO"
            │
            ▼
    [ Phone Screen (15-20 mins) ] ──► Recruiter tests: Communication, Polish, Red Flags, Salary Match
            │
            ▼
    [ Hiring Manager Review (Top 4-6) ] ──► "Can this person solve my immediate fire?"
            │
            ▼
    [ Final Round (Top 2-3) ] ──► "Who is the safest, least disruptive human to work with?"
```

### Key Principles from Bryan's 20 Years in Recruiting:
* **The Recruiter Is Not Your Friend**: While recruiters can be cordial and helpful, their fiduciary and employment loyalty is 100% to the employer. Every question they ask is designed to assess risk, fit, and compensation parameters.
* **The "Do Not Hire" List Exists**: Candidates who burn bridges, act unprofessionally during cancellations, or display erratic behavior during screening can be tagged internally in ATS databases (Workday, Taleo, Greenhouse) with notes that follow them indefinitely.
* **HR Protects the Company**: HR's legal mandate is protecting the organization from liability, lawsuits, and turnover costs—not coaching employees through personal challenges.

---

## 2. 10 Things You Must Never Reveal in a Job Interview

In one of Bryan's most celebrated deep-dives (*"10 Things You Should Avoid Revealing In A Job Interview"*, 2.1M+ views), he details the critical information candidates voluntarily blurt out that quietly kills their offer:

1. **Personal Financial Desperation**: Never mention debt, rent pressure, or urgency to get an income. It signals weakness and invites low-ball salary offers.
2. **Badmouthing Past Bosses or Coworkers**: Even if your previous manager was objectively toxic, mentioning it frames *you* as difficult to manage or prone to workplace drama. Reframe: *"I'm seeking an environment with higher cross-functional collaboration and clear ownership."*
3. **Over-Explaining Employment Gaps**: Providing an exhaustive emotional monologue about personal struggles raises doubt. State the gap succinctly in one sentence: *"I took planned time off to handle a family matter / pursue professional upskilling, which is now fully concluded, and I am 100% energized to return."*
4. **Current Salary or Historical Compensation**: In many jurisdictions, asking this is illegal, but recruiters still fish for it. Revealing it locks you into your past compensation band.
5. **Lack of Preparation on the Company**: Admitting you haven't looked at their product, recent news, or business model is an immediate lack-of-initiative red flag.
6. **Side Hustles / Competing Commitments**: Mentioning you run an active e-commerce store or freelance business during an interview makes hiring managers question your focus and availability.
7. **Political, Controversial, or Hyper-Personal Views**: Keep the conversation strictly professional. Any unsolicited personal tangent risks triggering unconscious interviewer bias.
8. **Dislike for Specific Core Job Functions**: Admitting *"I really hate doing documentation"* or *"I don't enjoy customer calls"* when the JD includes them disqualifies you immediately.
9. **Desire for Fast Promotion Before Starting**: Saying *"I expect to be promoted to director within 6 months"* signals impatience and a lack of focus on mastering the role you are actually interviewing for.
10. **Expressing Extreme Self-Doubt**: Avoid self-deprecating humor or saying *"I'm not sure if I'm qualified for this, but..."* If you don't back yourself, the interviewer won't either.

---

## 3. The Fatal Counter-Offer Trap: Why You Must Never Accept One

Bryan consistently warns candidates against accepting counter-offers when resigning (*"Should I Accept A Counter Offer From My Employer?"*, 1.9M+ views):

### Why Employers Make Counter-Offers
* It is a **tactical delay mechanism**: The company is blindsided and terrified of short-term project delays.
* It is **cheaper to give you a $10k raise today** than to spend $30k recruiting and training a replacement immediately.
* It buys the company 3 to 6 months to cross-train someone else or search for your replacement on their own schedule.

### The Brutal Statistical Reality
* Over **80% of employees who accept a counter-offer leave or are pushed out within 6 to 12 months**.
* **Trust is permanently broken**: Management now knows you had one foot out the door. When layoffs or promotions come around, you will be viewed as disloyal.
* **The underlying issues never change**: A $10,000 bump does not fix poor leadership, broken culture, or limited career trajectory.

---

## 4. Interview Red Flags: Spotting Toxic Employers Before You Sign

Interviewing is a two-way evaluation. Watch for these 5 critical warning signs (*"Five Red Flags In A Job Interview"*, 1.7M+ views):

1. **"We Work Hard, Play Hard"**: Corporate code for uncompensated overtime, late-night Slack pings, and non-existent work-life balance.
2. **High Turnover or Vague Reasons for Opening**: If the interviewer dodges the question *"Why is this position open?"* or mentions the last 3 people left within a year, the role has an unmanageable manager or unrealistic KPIs.
3. **Disrespect of Candidate Time**: Interviewers showing up 15 minutes late without apology, rescheduling 4 times, or expecting you to complete 20 hours of unpaid "test projects".
4. **Defensiveness or Hostility to Direct Questions**: If asking about team metrics, culture, or turnover causes the interviewer to become tense or guarded.
5. **No Clear Training or Onboarding Plan**: *"You'll just jump in and figure things out"* usually means total organizational chaos and immediate blame when things break.

---

## 5. Resume Mistakes That Trigger Instant Rejection

As an ex-headhunter who reviewed over 100,000 resumes:
* **Ditch the Objective Statement**: Replace it with a **3-line Executive Summary** highlighting hard skills, years in the discipline, and quantified career achievements.
* **Convert Duties into Results**: Never start bullets with *"Responsible for..."* or *"Assisted with..."* Use action verbs + metrics: *"Engineered automated billing system, reducing processing errors by 34% and saving $45k annually."*
* **Keep Formatting Clean & Parsable**: Avoid 2-column graphics, Canva templates with icons, and progress bars for skills (e.g. "Python: 80%"). Clean, single-column text parses cleanly in every ATS.

---

## 6. Salary Negotiation Leverage: Deflecting Early Number Traps

When a recruiter asks in the first phone screen: *"What are your salary expectations?"*

### The Script to Deflect Without Alienating:
> *"Right now, I'm primarily focused on making sure this role is the right mutual fit in terms of responsibilities and team challenges. Once we determine that, I'm confident we can agree on a compensation package that reflects fair market value for the role. Could you share the approved budgetary range for this position?"*

### Rules for the Final Offer Stage:
1. **Never Accept on the Phone**: Always say: *"Thank you so much! I'm genuinely excited about this offer. Can you email me the full offer letter and benefits summary so I can review the details? When do you need my formal decision by?"*
2. **Negotiate the Entire Package**: If base salary is fixed by bands, negotiate signing bonus, equity, review timeline (e.g., formal performance review in 6 months instead of 12), and vacation days.

---

## 7. Layoff Survival & Severance Strategy

When unexpected layoffs strike:
1. **Remain Emotionally Composed**: Never scream, cry, or make threats in the termination meeting. Take notes.
2. **Never Sign on the Spot**: You have the legal right (often 21 to 45 days under federal/state laws in the US) to review severance agreements. Say: *"I will take this document to review thoroughly before signing."*
3. **Negotiate Severance Terms**: Request additional weeks of severance, company-paid COBRA health insurance extension, positive reference letters, and immediate vesting of near-term equity.
4. **File for Unemployment Immediately**: Don't delay out of pride; benefits can take weeks to process.

---

## 8. Corporate Realities: 'Your Coworkers Are Not Your Friends'

In Bryan's viral analysis (*2.4M+ views*), he shares the hard-earned boundary lessons of corporate life:
* **The Confidant Danger**: Over-sharing personal vulnerabilities, marital issues, financial struggles, or dissatisfaction with leadership with coworkers will inevitably be used against you during political re-orgs or promotional competitions.
* **Friendly vs. Friend**: Be collaborative, kind, and supportive, but keep professional distance. True friends are external to your reporting hierarchy.
"""

videos_alal = f"""# A Life After Layoff — Complete Video Directory (545+ Videos)
### Video-by-Video Index, Views, & Key Takeaways from Bryan Creely

> **Channel**: [A Life After Layoff (@ALifeAfterLayoff)](https://www.youtube.com/@ALifeAfterLayoff)  
> **Host**: Bryan Creely | 20+ Year Senior Corporate Recruiter & Career Coach  
> **Total Channel Videos**: 545  

---

## Top 100 Most Impactful Videos (Ranked by View Count & Strategic Relevance)

{format_video_list(entries, top_dict, limit=100)}
"""

with open(CHANNELS["a_life_after_layoff"]["playbook_file"], "w", encoding="utf-8") as f:
    f.write(playbook_alal)
with open(CHANNELS["a_life_after_layoff"]["videos_file"], "w", encoding="utf-8") as f:
    f.write(videos_alal)
print("Generated A Life After Layoff docs.")

# ==============================================================================
# 2. SAARIM ASADY
# ==============================================================================
entries, top_dict = load_channel_videos("saarim_asady")

playbook_saarim = """# Saarim Asady — The Modern LinkedIn Growth & Inbound Career Playbook
### System for Generating Inbound Job Offers, High-Ticket Clients, & Algorithm Dominance

> **Source**: [Saarim Asady YouTube Channel](https://www.youtube.com/@Saarim-Asady) (173+ Videos)  
> **Creator Background**: Saarim Asady — High-ticket LinkedIn growth consultant, career accelerator, and creator who generated hundreds of thousands of dollars and client/job opportunities purely through organic LinkedIn positioning.  
> **Primary Focus**: Mastering the 2026/2027 LinkedIn algorithm, optimizing profiles to act as high-converting landing pages, inbound recruiter attraction, cold outreach that converts, and turning skills into high-paying employment and consulting opportunities.

---

## Table of Contents
1. [The LinkedIn Gold Rush & The 2026 Algorithm](#1-the-linkedin-gold-rush--the-2026-algorithm)
2. [The Profile Funnel Architecture: Converting Profile Visitors](#2-the-profile-funnel-architecture-converting-profile-visitors)
3. [Is LinkedIn Premium Worth It? (The Official Breakdown)](#3-is-linkedin-premium-worth-it-the-official-breakdown)
4. [High-Converting Cold Messaging & Direct Outbound](#4-high-converting-cold-messaging--direct-outbound)
5. [The Content Strategy for Tech & Professional Inbound](#5-the-content-strategy-for-tech--professional-inbound)
6. [Monetizing Skills: From $0 to $10k+/Month Contracts](#6-monetizing-skills-from-0-to-10kmonth-contracts)

---

## 1. The LinkedIn Gold Rush & The 2026 Algorithm

Most professionals treat LinkedIn like a static online CV that they update once a year. Saarim demonstrates that LinkedIn is **the single highest-ROI organic platform on the internet** for high-income earners and job seekers:

```
[ Passive Profile (Old Way) ] ──► 0 Inbound DMs, 0 Visibility, Stuck in 500-Resume Queues
                │
                ▼
[ The Profile Funnel (Saarim's Model) ]
  ├── 1. Attention Hook (Banner + Headline targeting ONE high-value problem)
  ├── 2. Proof of Competence (Featured Section with case studies & artifacts)
  ├── 3. Storytelling Trust (About Section written as a value proposition)
  └── 4. Active Signal (Consistent insightful comments + posts feeding the algorithm)
                │
                ▼
[ Inbound Recruiter & Client Messages Every Week ]
```

### What the Algorithm Rewards Today:
* **Dwell Time**: Posts and documents (PDF carousels) that keep users reading on the screen trigger algorithmic distribution.
* **Meaningful Industry Commentary**: Leaving 5 thoughtful, insightful comments on posts written by leaders in your target domain puts your profile in front of hundreds of their second-degree connections.
* **Newsletter & Creator Subscriptions**: LinkedIn heavily pushes creator newsletters into the email inboxes of connections.

---

## 2. The Profile Funnel Architecture

Your profile must function as a **landing page**, not a resume repository.

### Component 1: The Visual Banner (Header Graphic)
* Ditch generic stock photos of city skylines or abstract circuit boards.
* Use a clean Canva banner containing:
  * One clear value statement: *"Helping [Target Companies] scale [Specific Tech / Domain] without [Major Pain Point]"*.
  * Logos of tools, tech stacks, or notable projects.

### Component 2: The Headline Formula
* Never use: *"Aspiring Software Engineer | Seeking New Opportunities"*. This signals desperation and matches zero recruiter queries.
* **Saarim's Formula**: `[Exact Target Role] | [Core Niche & Tech Stack] | [Measurable Business Outcome]`
* *Example*: `Senior Full-Stack Engineer | TypeScript, Next.js, Node.js | Architecting high-scale SaaS architectures handling 100k+ MAU`

### Component 3: The Featured Section (Your Lead Magnet)
* The most underutilized real estate on LinkedIn.
* Pin 2–3 high-value artifacts:
  1. A live demo / GitHub repository or case study breaking down a complex project.
  2. A PDF carousel breaking down a technical architecture or industry problem.
  3. A calendar link (for consulting) or a direct PDF download of your tailored resume.

### Component 4: The About Section
* Write in the first person (`I`), using clean, readable spacing (1–2 sentences per paragraph).
* Structure:
  1. **The Hook**: The problem you love solving and why it matters.
  2. **The Track Record**: 3–4 bullet points of concrete results with hard numbers.
  3. **The Philosophy / Tech Stack**: How you approach problem-solving and the specific tools you deploy.
  4. **The Call to Action**: *"I'm currently exploring senior engineering / consulting opportunities with high-growth teams. DM me or email [Your Email]."*

---

## 3. Is LinkedIn Premium Worth It? (The Official Breakdown)

In his definitive breakdown (*"Is LinkedIn Premium Worth It To Get Clients / Jobs"*, 17k+ views), Saarim provides the clear ROI math:

### When Premium IS Worth It:
1. **Unlocking "Who's Viewed Your Profile"**: When you are actively posting or commenting, high-value recruiters and hiring managers will quietly view your profile without messaging. With Premium, you see every single one of them. **Reach out to them within 24 hours**:
   > *"Hi [Name], noticed you stopped by my profile earlier! Curious what caught your eye, and happy to chat if you're looking into [Specific Domain]."*
2. **InMail Direct Access**: Allows you to bypass 3rd-degree connection locks and send direct, high-priority messages into executive inboxes.
3. **Advanced Competitive Insights**: Viewing the applicant count and seniority distribution on job listings.

### When Premium is a Waste of Money:
* If your profile is still an un-optimized, generic resume with no proof of work. Premium only amplifies what already converts.

---

## 4. High-Converting Cold Messaging & Direct Outbound

Cold outbound fails when it sounds like a templated sales blast or a desperate plea for an interview.

### The 4-Part Saarim Outreach Framework:
1. **The Specific Context Hook**: Mention something real (a recent post of theirs, a podcast they appeared on, a specific product feature their company launched).
2. **The Shared Observation**: Identify a non-obvious technical or operational friction point in their space.
3. **The Low-Friction Offer**: Offer a free breakdown, code sample, or insight without asking for a meeting.
4. **The No-Pressure Sign-Off**: *"Either way, loving the work you're shipping at [Company]!"*

---

## 5. The Content Strategy for Tech & Professional Inbound

To get recruiters and clients reaching out to you:
* **Post 2 to 3 times per week**:
  * **Post Type 1 (The Build in Public)**: Break down a technical bug you fixed, an architecture choice you made, or a design decision.
  * **Post Type 2 (The Industry Teardown)**: Analyze a major company's recent feature, deployment, or technical pivot.
  * **Post Type 3 (The Lessons / Framework)**: Share a practical cheat sheet or system you use to streamline work.
"""

videos_saarim = f"""# Saarim Asady — Complete Video Directory (173+ Videos)
### Video-by-Video Index, Views, & Key Takeaways

> **Channel**: [Saarim Asady (@Saarim-Asady)](https://www.youtube.com/@Saarim-Asady)  
> **Total Channel Videos**: 173  

---

## Top Videos (Ranked by Views & Impact)

{format_video_list(entries, top_dict, limit=80)}
"""

with open(CHANNELS["saarim_asady"]["playbook_file"], "w", encoding="utf-8") as f:
    f.write(playbook_saarim)
with open(CHANNELS["saarim_asady"]["videos_file"], "w", encoding="utf-8") as f:
    f.write(videos_saarim)
print("Generated Saarim Asady docs.")

# ==============================================================================
# 3. EMILY DURHAM
# ==============================================================================
entries, top_dict = load_channel_videos("emily_durham")

playbook_emily = """# Emily Durham — The Senior Recruiter & Career Mastery Playbook
### Insider Strategies from a Tech Senior Recruiter (ex-Intuit) & Host of The Emily Durham Show

> **Source**: [Emily Durham YouTube Channel](https://www.youtube.com/@Emily.Durham) (208+ Videos)  
> **Creator Background**: Emily Durham — Senior Corporate & Tech Recruiter who led talent acquisition pipelines at Intuit and high-growth tech firms. Creator of viral career education and interview strategies.  
> **Primary Focus**: The non-transactional networking model (*"How to Actually Network in 2025"*), recruiter phone screen mechanics, interview secrets that win offers, corporate salary negotiation scripts, and overcoming career self-sabotage.

---

## Table of Contents
1. [How to Actually Network in 2025/2026 (The Non-Transactional Method)](#1-how-to-actually-network-in-20252026)
2. [What Recruiters Say Behind Closed Doors (The First 5 Minutes)](#2-what-recruiters-say-behind-closed-doors)
3. [Interview Secrets: Behavioral Questions & The STAR Mastery](#3-interview-secrets-behavioral-questions--the-star-mastery)
4. [Salary Negotiation Tactics from an In-House Recruiter](#4-salary-negotiation-tactics-from-an-in-house-recruiter)
5. [The Weekly Routine to Never Apply Cold Again](#5-the-weekly-routine-to-never-apply-cold-again)
6. [Navigating Toxic Workplaces & Knowing When to Walk Away](#6-navigating-toxic-workplaces--knowing-when-to-walk-away)

---

## 1. How to Actually Network in 2025/2026

In Emily's flagship masterclass (*"How to Actually Network in 2025 (The New Way People Really Get Hired)"*, video `o1W-En6U2T8`), she tears apart the traditional awkward networking playbook:

```
[ Traditional Networking (FAILED) ]
  "Hi, I saw your company is hiring. Can you review my resume and refer me?"
            │
            ▼
  Signals: Transactional, selfish, overwhelming ask from a total stranger. (Deleted)

[ The 2025 Curiosity & Value Network (WINNING) ]
  "Hi Sarah, loved your recent talk on microservice migrations at Intuit. 
   As an engineer currently tackling similar scaling challenges, I'd love to follow your work!"
            │
            ▼
  Signals: Authentic appreciation, shared technical discipline, zero immediate friction.
```

### The 3 Rules of Modern Networking:
1. **Never Ask for a Job or Referral on Touch #1**: Referrals require social capital. A complete stranger will not risk their internal reputation on someone whose work they have never seen.
2. **Network with Peers, Not Just VPs**: Connect with people 1 level above you or at your exact level. They have the most accurate day-to-day read on upcoming openings, team culture, and hiring manager pain points.
3. **The 3-Touch Relationship Cadence**:
   * **Touch 1**: Connection request with genuine, specific appreciation for their work or content.
   * **Touch 2 (1–2 weeks later)**: Share a relevant article, tool, or thoughtful reply to something they posted.
   * **Touch 3**: The casual conversation: *"I'm currently exploring upcoming engineering roles on teams like yours—would you be open to a 10-minute chat about how your team approaches [Topic]?"*

---

## 2. What Recruiters Say Behind Closed Doors

Emily shares the raw truth of what happens in talent acquisition debriefs:
* **The First 5 Minutes Decide the Call**: Recruiters form 80% of their impression in the opening pleasantries and your answer to *"Walk me through your background"*. If you sound flat, bored, or disjointed, they spend the rest of the call looking for confirmation of why you're not the one.
* **The Energy & Tonality Test**: Technical competence gets you to the phone screen; authentic engagement and clear verbal articulation get you to the hiring manager.
* **The "Can I Put This Person in Front of Leaders?" Filter**: Recruiters are evaluated on the quality of candidates they send to hiring managers. If a candidate rambles for 4 minutes without landing the point, the recruiter knows the hiring manager will be frustrated.

---

## 3. Interview Secrets: Behavioral Questions & The STAR Mastery

### The #1 Flaw in Behavioral Answers:
Most candidates spend 70% of their answer describing the **Situation and Task** (irrelevant background details) and only 30% on what they actually delivered.

### Emily's Calibrated STAR Allocation:
* **Situation (15%)**: Concise context. Who, when, what was the primary constraint.
* **Task (10%)**: The specific responsibility you owned.
* **Action (50%)**: The core meat. What *you* did, how you communicated, what technical decisions you made, and how you handled roadblocks.
* **Result (25%)**: Measurable outcome + what you learned.

---

## 4. Salary Negotiation Tactics from an In-House Recruiter

As a former corporate recruiter managing salary budgets, Emily reveals how bands actually work:
* **Recruiters Have a Budgeted Range**: Every role has an approved range (e.g., $110,000 – $135,000). The midpoint ($120k) is what they typically target for standard qualifications; the top of the band is reserved for candidates who demonstrate high independence and negotiation acumen.
* **The Recruiter Wants to Close You**: The recruiter gets zero commission or bonus for saving the company $5,000. In fact, they want to give you an offer you will actually accept so they can close the requisition.

### Counter-Offer Script for a Job Offer:
> *"I am so thrilled about the team and the vision we discussed. Based on the market data for this scope and the immediate impact I will bring to [Specific Priority], I was targeting a base salary closer to $130,000. If we can get to that number, I would be delighted to sign today."*

---

## 5. The Weekly Routine to Never Apply Cold Again

In *"Do This Weekly and Never Apply for a Job Again"* (223k+ views), Emily outlines the continuous career maintenance habit:
* **Every Friday (30 Minutes)**:
  1. Add 5 target professionals at companies you respect.
  2. Leave 3 thoughtful comments on industry posts.
  3. Update your master achievement document (record wins, metrics, completed projects while fresh).
"""

videos_emily = f"""# Emily Durham — Complete Video Directory (208+ Videos)
### Video-by-Video Index, Views, & Key Takeaways

> **Channel**: [Emily Durham (@Emily.Durham)](https://www.youtube.com/@Emily.Durham)  
> **Total Channel Videos**: 208  

---

## Top Videos (Ranked by Views & Impact)

{format_video_list(entries, top_dict, limit=80)}
"""

with open(CHANNELS["emily_durham"]["playbook_file"], "w", encoding="utf-8") as f:
    f.write(playbook_emily)
with open(CHANNELS["emily_durham"]["videos_file"], "w", encoding="utf-8") as f:
    f.write(videos_emily)
print("Generated Emily Durham docs.")

# ==============================================================================
# 4. WILSON WYE
# ==============================================================================
entries, top_dict = load_channel_videos("wilson_wye")

playbook_wilson = """# Wilson Wye — The Remote Engineering & Multi-Job Playbook
### The Operational System for Working Multiple Remote Tech Roles & Finding Unindexed Jobs

> **Source**: [Wilson Wye YouTube Channel](https://www.youtube.com/@wilsonwye/videos) (60+ Videos)  
> **Creator Background**: Wilson Wye — Senior Software Engineer who architected systems to secretly and successfully work up to 3 full-time remote software engineering jobs simultaneously, earning $300k-$500k+ while maintaining top-tier performance ratings.  
> **Primary Focus**: The operational reality of Overemployment (OE), calendar conflict deconfliction, finding jobs outside saturated LinkedIn listings, developer productivity engineering, and achieving financial independence.

---

## Table of Contents
1. [The System to Work 3 Full-Time Jobs at Once](#1-the-system-to-work-3-full-time-jobs-at-once)
2. [The 5 Hidden Rules of Overemployment (Risk Mitigation)](#2-the-5-hidden-rules-of-overemployment)
3. [FORGET LinkedIn: Where Remote Engineers Actually Get Hired](#3-forget-linkedin-where-remote-engineers-actually-get-hired)
4. [Calendar Deconfliction & Task Estimation Mastery](#4-calendar-deconfliction--task-estimation-mastery)
5. [The High-Output Developer Toolkit](#5-the-high-output-developer-toolkit)

---

## 1. The System to Work 3 Full-Time Jobs at Once

In his flagship video (*"The System I Used to Work 3 Full-Time Jobs at Once"*, video `WrValFMtQzk`, 172k+ views), Wilson details the exact structural framework that makes multi-job remote work viable without burnout:

```
┌──────────────────────────────────────────────────────────┐
│              JOB 1 (Anchor Job - High Stability)         │
│  Large Enterprise / Fortune 500, slow-paced, low meeting  │
│  load, predictable 2-week sprint cycles.                 │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│              JOB 2 (Cash Flow - Mid-Market SaaS)         │
│  Medium-sized firm, established code base, asynchronous   │
│  standups, independent technical ownership.              │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│              JOB 3 (Contract / Flex / Startup)           │
│  Staff augmentation or milestone-based contract work      │
│  with minimal required live attendance.                   │
└──────────────────────────────────────────────────────────┘
```

### The Core Philosophy:
* **Be Good at What You Do**: OE is not for juniors who need hand-holding. You must be an experienced engineer capable of completing an 8-hour ticket in 90 minutes through deep technical fluency, code reuse, and automated tooling.
* **Under-Promise, Over-Deliver**: If a ticket takes you 2 hours, estimate it at 2 days. Complete it in the morning, test it thoroughly, and submit the pull request the following afternoon.

---

## 2. The 5 Hidden Rules of Overemployment

1. **Rule #1: NEVER Tell Anyone**: No coworkers, no casual friends, no social media bragging. Anonymity is your primary shield.
2. **Rule #2: Freeze The Work Number (TWN) / Equifax**: Submit a formal freeze on your automated employment verification profile with Equifax / The Work Number before taking a second role to prevent automated background checks from revealing concurrent W2 employment.
3. **Rule #3: Total Hardware Separation**: Never mix devices. Job 1 on Laptop 1, Job 2 on Laptop 2, Job 3 on Laptop 3. Separate keyboards, mice (or hardware KVM switch), separate GitHub accounts, separate VPNs.
4. **Rule #4: Master the Art of Being "Average"**: Do not seek to be the company hero, the team lead, or the volunteer for extra committees. Aim for the top of the middle tier—competent, friendly, reliable, but not indispensable to high-friction executive meetings.
5. **Rule #5: Live Below Your J1 Income**: Save and invest 100% of income from Job 2 and Job 3 into liquid assets and index funds. If one job ends unexpectedly, your lifestyle is completely untouched.

---

## 3. FORGET LinkedIn: Where Remote Engineers Actually Get Hired

In *"FORGET LinkedIn. This Is Where People Actually Get Hired"* (63k+ views), Wilson breaks down why public LinkedIn boards are the worst place for engineers:

### Why LinkedIn Fails:
* Postings get 1,000+ bot applications within 4 hours.
* Over 40% are stale or ghost postings.

### The Unindexed Channels:
1. **Hacker News ("Who is Hiring?")**: Posted on the 1st of every month on Y Combinator's Hacker News. Engineers and technical founders post direct emails with zero ATS middleware.
2. **Specialized Remote Tech Boards**:
   * RemoteOK, We Work Remotely, Wellfound (AngelList), Himalayas, Remotive.
3. **Open-Source GitHub Commits**: Contributing PRs to open-source tooling used by target companies leads directly to inbound interviews from maintainers.
4. **Direct Engineering Manager Cold Outreach**: Finding the engineering manager on LinkedIn and sending a direct message highlighting a bug or specific improvement in their public API.

---

## 4. Calendar Deconfliction & Task Estimation Mastery

* **The Staggered Standup Setup**: When choosing roles, ensure meeting times don't conflict (e.g. J1 daily standup at 9:30 AM EST, J2 daily standup at 11:00 AM EST or async Slack update).
* **The "Camera Broken / Mic Issue" Card**: Keep emergency excuses reserved for true unavoidable double-bookings (use once a quarter maximum).
* **Block Time as "Focus Time"**: Schedule recurring daily blocks titled *"Deep Focus / Code Architecture Review"* to prevent ad-hoc meetings from being dropped on your calendar.
"""

videos_wilson = f"""# Wilson Wye — Complete Video Directory (60+ Videos)
### Video-by-Video Index, Views, & Key Takeaways

> **Channel**: [Wilson Wye (@wilsonwye)](https://www.youtube.com/@wilsonwye/videos)  
> **Total Channel Videos**: 60  

---

## Complete Catalogue of Videos (Ranked by Views & Impact)

{format_video_list(entries, top_dict, limit=60)}
"""

with open(CHANNELS["wilson_wye"]["playbook_file"], "w", encoding="utf-8") as f:
    f.write(playbook_wilson)
with open(CHANNELS["wilson_wye"]["videos_file"], "w", encoding="utf-8") as f:
    f.write(videos_wilson)
print("Generated Wilson Wye docs.")

# ==============================================================================
# 5. DIANDRA ESCOBAR
# ==============================================================================
entries, top_dict = load_channel_videos("diandra_escobar")

playbook_diandra = """# Diandra Escobar — Tech Sales & LinkedIn Accelerator Playbook
### System for Breaking into Tech, Landing Remote Sales Roles, & Rapid Profile Growth

> **Source**: [Diandra Escobar YouTube Channel](https://www.youtube.com/@diandraescobarr) (17 High-Impact Videos)  
> **Creator Background**: Diandra Escobar — High-earning B2B tech sales leader and creator who went from getting fired at 22 to generating $1M+ by age 25 through high-ticket tech sales and organic LinkedIn brand dominance.  
> **Primary Focus**: Breaking into high-paying remote tech sales (SDR / BDR / Account Executive) without tech experience, modern LinkedIn content and profile architecture, cold outreach to VPs, and interview mock calls.

---

## Table of Contents
1. [The 0 to 6-Figure Tech Sales Blueprint](#1-the-0-to-6-figure-tech-sales-blueprint)
2. [Growing Your LinkedIn in 2026 (The Content Framework)](#2-growing-your-linkedin-in-2026)
3. [Cold Video Outreach to Hiring Decision Makers (Loom Blueprint)](#3-cold-video-outreach-to-hiring-decision-makers)
4. [Mastering the Tech Sales Interview & Mock Cold Call](#4-mastering-the-tech-sales-interview--mock-cold-call)
5. [Turning Your LinkedIn Profile into a Magnet](#5-turning-your-linkedin-profile-into-a-magnet)

---

## 1. The 0 to 6-Figure Tech Sales Blueprint

Tech sales (Sales Development Representative -> Account Executive) is the fastest non-technical route to a $100k+ remote career:
* **The SDR/BDR Entry Point**: Base salary ($55k–$70k) + OTE commissions ($80k–$100k+).
* **What Hiring Managers Look For**: Not a computer science degree or 5 years of enterprise experience, but **coachability, grit, articulate verbal communication, and handling rejection with grace**.

---

## 2. Growing Your LinkedIn in 2026

In *"How to Grow Your LinkedIn SO Fast in 2026 It Feels ILLEGAL"* (100k+ views), Diandra breaks down the exact post architecture:
* **The 2-Line Hook**: The first 2 lines determine if the user clicks *"see more"*.
  * *Bad*: "I'm excited to share some thoughts on sales..."
  * *Good*: "I got fired at 22 with $0 in my account. 3 years later, I crossed $1M in B2B tech sales. Here are the 4 non-negotiable rules I lived by:"
* **Short, Punchy Formatting**: White space between ideas; avoid dense text blocks.
* **The Authority Artifact**: Include a screenshot, framework graphic, or tactical checklist.

---

## 3. Cold Video Outreach to Hiring Decision Makers

Applying online for tech sales roles is contradictory; sales is about prospecting. If you cold prospect the VP of Sales, you prove your ability to do the job before the first interview:

### The 60-Second Loom Strategy:
1. Record a 60-second Loom video showing their company's LinkedIn page or product.
2. **Script**:
   > *"Hi [VP Name], noticed you're scaling the BDR team at [Company]. I spent the morning reviewing your target customer base in [Industry] and mapped out 3 specific accounts where your solution could drive immediate revenue. Recorded a quick 60-second video on my ideas—would you be open to a 5-minute conversation?"*
3. **Conversion Rate**: Converts at **20% to 35% response rates**, completely skipping the HR resume queue.

---

## 4. Mastering the Tech Sales Interview & Mock Cold Call

In tech sales interviews, candidates are almost always subjected to a **mock cold call**:
* **The 4 Steps of a Mock Cold Call**:
  1. **Pattern Interrupt**: *"Hi [Name], I know you weren't expecting my call—do you have 27 seconds for me to tell you why I reached out?"*
  2. **Problem Statement**: *"We speak with VPs of Engineering who struggle with [Pain Point]."*
  3. **Open-Ended Discovery**: *"How is your team currently handling that?"*
  4. **The Soft Close**: *"Sounds like it's worth exploring—do you have 15 minutes this Thursday morning?"*
* **The #1 Test**: When the interviewer gives you feedback after the mock call, **implement it immediately** on round 2 to prove extreme coachability.
"""

videos_diandra = f"""# Diandra Escobar — Complete Video Directory (17 Videos)
### Video-by-Video Index, Views, & Key Takeaways

> **Channel**: [Diandra Escobar (@diandraescobarr)](https://www.youtube.com/@diandraescobarr)  
> **Total Channel Videos**: 17  

---

## Complete Catalogue of Videos (Ranked by Views & Impact)

{format_video_list(entries, top_dict, limit=17)}
"""

with open(CHANNELS["diandra_escobar"]["playbook_file"], "w", encoding="utf-8") as f:
    f.write(playbook_diandra)
with open(CHANNELS["diandra_escobar"]["videos_file"], "w", encoding="utf-8") as f:
    f.write(videos_diandra)
print("Generated Diandra Escobar docs.")

# ==============================================================================
# 6. FARAH SHARGHI
# ==============================================================================
entries, top_dict = load_channel_videos("farah_sharghi")

playbook_farah = """# Farah Sharghi — The Ex-Google Recruiter Career Playbook
### Insider Hiring, Resume Secrets, & Interview Protocols from a Big Tech Recruiter

> **Source**: [Farah Sharghi YouTube Channel](https://www.youtube.com/@Farah_Sharghi) (34 High-Impact Videos)  
> **Creator Background**: Farah Sharghi — Former Technical & Corporate Recruiter at Google, Lyft, and TikTok who evaluated tens of thousands of tech and corporate candidates.  
> **Primary Focus**: Deconstructing Big Tech hiring committees, why strategic resume framing ("lying" vs. authentic positioning) gets you hired, the Google X-Y-Z resume formula, the HERO behavioral framework, and negotiating FAANG total compensation.

---

## Table of Contents
1. [The Big Tech Recruiter Lens: How Google & FAANG Actually Screen](#1-the-big-tech-recruiter-lens)
2. [Why 'Lying' Gets You Hired (Strategic Framing vs. Fabrication)](#2-why-lying-gets-you-hired)
3. [6 Resume Secrets from an Ex-Google Recruiter (The X-Y-Z Formula)](#3-6-resume-secrets-from-an-ex-google-recruiter)
4. [The HERO Behavioral Interview Framework](#4-the-hero-behavioral-interview-framework)
5. [Overcoming Ageism & Employment Gaps in Modern Tech](#5-overcoming-ageism--employment-gaps-in-modern-tech)
6. [Big Tech Leveling & Total Compensation Negotiation](#6-big-tech-leveling--total-compensation-negotiation)

---

## 1. The Big Tech Recruiter Lens: How Google & FAANG Actually Screen

In Big Tech, recruiters don't make hiring decisions alone. The process involves:
* **The Recruiter Screen**: High-level alignment on scope, compensation expectations, and communication clarity.
* **The Interview Loop**: 4 to 5 rounds (coding/system design for SWEs, case/product sense for PMs, behavioral/Googleyness).
* **The Independent Hiring Committee (HC)**: The hiring manager does *not* have unilateral hiring power. A separate committee of senior leaders who never met you reviews the written packet (interview scores, resume, references).
* **What Wins in Committee**: Clear, unambiguous evidence of business impact and scope of ownership documented on paper.

---

## 2. Why 'Lying' Gets You Hired (Strategic Framing vs. Fabrication)

In her most famous deep-dive (*"Ex-Google Recruiter Explains Why 'Lying' Gets You Hired"*, 1.9M+ views), Farah breaks down the vital distinction between criminal fabrication and **strategic positioning**:

```
[ Unethical / Disqualifying "Lying" ]
  ❌ Claiming degrees you never attended.
  ❌ Inventing companies that don't exist.
  ❌ Claiming job titles that fail background checks (e.g. Director when HR has Junior).
  ──► FAILS Third-Party Background Verification (HireRight, Sterling) -> Offer Revoked.

[ Ethical Strategic Framing (What Gets You Hired) ]
  ✅ Translating obscure internal titles to market standards.
  ✅ Framing your contributions through ownership rather than passivity.
  ✅ Highlighting the high-water mark of your scope rather than your lowest day.
```

### Strategic Framing Rules:
* If you acted as the de-facto Scrum Master or Tech Lead on a multi-month project, highlight *"Served as Tech Lead for 6-person migration initiative"* in your bullets, even if your HR contract title was "Software Engineer II".
* Frame outcomes through business value: Connect technical bug fixes to saved customer churn and team velocity.

---

## 3. 6 Resume Secrets from an Ex-Google Recruiter

1. **The Google X-Y-Z Formula**:
   ```
   "Accomplished [X], as measured by [Y], by doing [Z]."
   ```
   * *Example*: *"Increased API query throughput by 45% (Y), reducing average checkout latency from 800ms to 440ms (X), by restructuring PostgreSQL database indexing and introducing Redis caching (Z)."*
2. **Single-Column Clean Layout**: No multi-column tables, no sidebars, no graphics that confuse parsing engines.
3. **Drop Outdated Graduation Years**: If you graduated more than 10–12 years ago, remove the graduation year to prevent age bias.
4. **Remove the Objective Statement**: Replace with a concise 3-line Technical Summary.
5. **Tailor the Top Third of Page 1**: Recruiters spend 6 seconds looking at your most recent role. Front-load your biggest wins in the first 3 bullets.
6. **Eliminate Fluff Words**: Delete *"Hard-working team player with excellent communication skills"*. Prove it through hard metrics.

---

## 4. The HERO Behavioral Interview Framework

To stand out in FAANG behavioral and "Googleyness" rounds, Farah teaches the **HERO Framework**:
* **H — Hook**: A compelling one-sentence premise. *"When our primary payment processing service went down during Black Friday, I was the on-call engineer responsible for stabilizing $2M/hour in transactions."*
* **E — Evidence**: The technical decisions, cross-team collaboration, and analytical steps you took.
* **R — Result**: The quantifiable outcome (downtime kept under 12 minutes, zero data loss).
* **O — Opportunity / Takeaway**: How you used the incident to prevent future failures (authored post-mortem, built automated circuit-breaker testing).

---

## 5. Overcoming Ageism & Employment Gaps in Modern Tech

* Modernize tech stack terminology (emphasize cloud native, modern CI/CD, modern frameworks).
* Limit visible resume experience to the **last 10–15 years**; older experience can be summarized in an "Earlier Career Experience" section without dates.
* Own career gaps with forward-looking energy: emphasize upskilling, certifications, or consulting projects.

---

## 6. Big Tech Leveling & Total Compensation Negotiation

* Big Tech compensation is composed of: **Base Salary + Annual Bonus + Equity (RSUs over 4 years) + Sign-on Bonus**.
* The single most powerful leverage point is a **competing offer**. Big Tech compensation committees will regularly increase initial equity grants by $50k–$100k+ when presented with verified competing numbers from peer firms.
"""

videos_farah = f"""# Farah Sharghi — Complete Video Directory (34 Videos)
### Video-by-Video Index, Views, & Key Takeaways

> **Channel**: [Farah Sharghi (@Farah_Sharghi)](https://www.youtube.com/@Farah_Sharghi)  
> **Total Channel Videos**: 34  

---

## Complete Catalogue of Videos (Ranked by Views & Impact)

{format_video_list(entries, top_dict, limit=34)}
"""

with open(CHANNELS["farah_sharghi"]["playbook_file"], "w", encoding="utf-8") as f:
    f.write(playbook_farah)
with open(CHANNELS["farah_sharghi"]["videos_file"], "w", encoding="utf-8") as f:
    f.write(videos_farah)
print("Generated Farah Sharghi docs.")

# ==============================================================================
# 7. CAREER SHAKERS
# ==============================================================================
entries, top_dict = load_channel_videos("career_shakers")

playbook_cs = """# Career Shakers — The Modern Job Search & Strategic Career Playbook
### Tactical Frameworks Synthesized from Davis Nguyen & The Career Shakers Mentors

> **Source**: [Career Shakers YouTube Channel](https://www.youtube.com/@CareerShakers) (310+ Videos)  
> **Creator Background**: Davis Nguyen & Team — Former Bain & Company management consultants and tech recruiters who built one of the premier career acceleration firms, coaching thousands into top consulting, tech, and corporate roles.  
> **Primary Focus**: Reasons why you can't find a job in 2026, beating the modern ATS without keyword stuffing, the 30-second elevator pitch, S.T.A.R. vs. C.A.R. behavioral interview methods, and high-conversion alumni networking.

---

## Table of Contents
1. [Reasons Why You Can't Find a Job in 2026 (UPDATED)](#1-reasons-why-you-cant-find-a-job-in-2026)
2. [Beating the Modern Applicant Tracking System (ATS)](#2-beating-the-modern-applicant-tracking-system)
3. [The 30-Second High-Conversion Elevator Pitch](#3-the-30-second-high-conversion-elevator-pitch)
4. [S.T.A.R. vs. C.A.R. Behavioral Interview Framework](#4-star-vs-car-behavioral-interview-framework)
5. [The Alumni Networking Engine (80%+ Response Rate)](#5-the-alumni-networking-engine)
6. [Career Switching: Translating Non-Traditional Backgrounds](#6-career-switching-translating-non-traditional-backgrounds)

---

## 1. Reasons Why You Can't Find a Job in 2026 (UPDATED)

In their flagship analysis (*"Reasons why you can't find a job in 2026 (UPDATED)"*, video `vrJGxdk1Cug`), Career Shakers dissect the systemic breakdown in the job market:

```
[ The Broken 2026 Application Cycle ]
  Sending 500+ Easy Apply Applications ──► Automated ATS Filters / Ghost Jobs ──► 0 Interviews
                                 │
                                 ▼
[ The Career Shakers Pivot ]
  1. Targeted 30-Company List (High Growth, Active Funding)
  2. The 30-Second Elevator Pitch
  3. Pre-Application Warm Networking with Alumni (15-20x conversion)
  4. Hyper-Tailored Resumes built with C.A.R. bullets
```

### The 4 Modern Job Market Traps:
1. **The Quantity Illusion**: Candidates think sending 50 generic applications a day will eventually land an offer. In reality, it burns emotional energy and yields a ~1% conversion rate.
2. **The Ghost Job Trap**: 30%+ of postings are evergreen listings with no budget approved. Applying to them is shouting into a void.
3. **The Resume Disconnect**: Resumes that read like job descriptions rather than consulting impact briefs.
4. **Neglecting the Warm Referral Pipeline**: Over 70% of professional hires occur when someone inside the company flags your resume to the recruiter.

---

## 2. Beating the Modern Applicant Tracking System (ATS)

* **The Formatting Rule**: Use standard `.docx` or simple `.pdf` exported from Word/Google Docs. Multi-column layouts, text boxes, and fancy tables get scrambled when parsed into ATS fields.
* **Natural Keyword Integration**: Don't dump a white-text keyword list at the bottom (modern ATS flags this immediately). Integrate the exact 5–8 core skills from the JD into your headline, summary, and experience bullets.
* **Standard Section Headers**: Stick to `Work Experience`, `Education`, `Technical Skills`. Avoid creative labels like *"Where I've Been"* or *"My Journey"*.

---

## 3. The 30-Second High-Conversion Elevator Pitch

When an interviewer or networking contact says *"Tell me about yourself"* or *"What are you looking for?"*:

### The 4-Part Career Shakers Pitch:
1. **Who You Are Today**: Your professional identity and core specialty.
2. **The Proven Track Record**: One signature achievement or metric that establishes instant credibility.
3. **The Pivot / Evolution**: Why you are taking the next step in your career.
4. **The Clear Ask**: What specific problems you want to tackle next.

---

## 4. S.T.A.R. vs. C.A.R. Behavioral Interview Framework

While many candidates use STAR, Career Shakers advocates the more streamlined **C.A.R. Method** for faster, higher-impact delivery:

```
C — Context / Challenge (20%): Set the scene and state the critical roadblock.
A — Action              (60%): Detail your specific decisions, analysis, and execution.
R — Result              (20%): Quantified business impact + key takeaway.
```
* **Why C.A.R. Wins**: It prevents candidates from getting bogged down in lengthy situation descriptions and forces 60% of the focus onto what the candidate actually executed.

---

## 5. The Alumni Networking Engine (80%+ Response Rate)

Alumni from your university, college, or past prominent employers have an emotional affinity with you that complete strangers lack.

### The Alumni Outreach Script:
> *"Hi [Alumni Name], noticed you graduated from [University] and are now doing fantastic work as a [Target Role] at [Company]. As a fellow [Mascot/Alum] preparing to transition into [Field], I’d love to hear your perspective on how the team approaches [Specific Challenge]. Would you have 10 minutes for a quick virtual coffee next week?"*
"""

videos_cs = f"""# Career Shakers — Complete Video Directory (310+ Videos)
### Video-by-Video Index, Views, & Key Takeaways

> **Channel**: [Career Shakers (@CareerShakers)](https://www.youtube.com/@CareerShakers)  
> **Total Channel Videos**: 310  

---

## Top Videos (Ranked by Views & Impact)

{format_video_list(entries, top_dict, limit=80)}
"""

with open(CHANNELS["career_shakers"]["playbook_file"], "w", encoding="utf-8") as f:
    f.write(playbook_cs)
with open(CHANNELS["career_shakers"]["videos_file"], "w", encoding="utf-8") as f:
    f.write(videos_cs)
print("Generated Career Shakers docs.")

print("ALL 14 FILES GENERATED SUCCESSFULLY!")
