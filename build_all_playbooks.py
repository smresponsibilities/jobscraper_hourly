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
        "role_desc": "20+ Year Corporate Recruiter, Headhunter, & HR Insider",
        "playbook_file": os.path.join(ROOT_DIR, "A-LIFE-AFTER-LAYOFF-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "A-LIFE-AFTER-LAYOFF-ALL-VIDEOS.md"),
        "key_pillars": [
            "Corporate Recruiter & HR Insider Secrets",
            "Resume Red Flags & What Gets Cut First",
            "Interview Pitfalls: 10 Things to Avoid Revealing",
            "The Fatal Trap of Counter-Offers",
            "Navigating Layoffs, Severance, & Toxic Workplaces",
            "Salary Negotiation Leverage from an Insider's Lens"
        ]
    },
    "saarim_asady": {
        "creator": "Saarim Asady",
        "title": "Saarim Asady",
        "channel_url": "https://www.youtube.com/@Saarim-Asady",
        "role_desc": "LinkedIn Growth & High-Ticket Inbound Career Strategist",
        "playbook_file": os.path.join(ROOT_DIR, "SAARIM-ASADY-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "SAARIM-ASADY-ALL-VIDEOS.md"),
        "key_pillars": [
            "The Modern LinkedIn Algorithm & Inbound Visibility",
            "Optimizing LinkedIn Profiles to Generate High-Paying Inbound Leads",
            "LinkedIn Premium: Real Value vs. Marketing Hype",
            "High-Converting Cold Direct Pitching & Outbound Messaging",
            "Building a Personal Brand That Makes Public Applying Obsolete",
            "Monetizing Skills & Transitioning into High-Income Contracts"
        ]
    },
    "emily_durham": {
        "creator": "Emily Durham",
        "title": "Emily Durham",
        "channel_url": "https://www.youtube.com/@Emily.Durham",
        "role_desc": "Senior Corporate & Tech Recruiter (ex-Intuit) & Career Podcast Host",
        "playbook_file": os.path.join(ROOT_DIR, "EMILY-DURHAM-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "EMILY-DURHAM-ALL-VIDEOS.md"),
        "key_pillars": [
            "How to Actually Network in 2025/2026 (The Non-Transactional Method)",
            "What Recruiters Actually Say Behind Closed Doors",
            "Interview Mastery: Nailing the First 5 Minutes & Behavioral Questions",
            "Salary Negotiation Tactics from an In-House Senior Recruiter",
            "Navigating Corporate Politics, Toxic Workplaces, & PIPs",
            "Weekly Habits That Eliminate Cold Job Applications"
        ]
    },
    "wilson_wye": {
        "creator": "Wilson Wye",
        "title": "Wilson Wye",
        "channel_url": "https://www.youtube.com/@wilsonwye/videos",
        "role_desc": "Senior Software Engineer & Multi-Remote Career Architect",
        "playbook_file": os.path.join(ROOT_DIR, "WILSON-WYE-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "WILSON-WYE-ALL-VIDEOS.md"),
        "key_pillars": [
            "The Multi-Full-Time Remote Work Architecture (Working 3 Jobs at Once)",
            "Alternative Job Boards: Where Developers & Remote Workers Actually Get Hired",
            "The Strict Rules & Risk-Mitigation of Overemployment (OE)",
            "Calendar, Context-Switching, & High-Output Engineering Systems",
            "Software Engineering Resume & Portfolio Projects That Actually Convert",
            "Escaping the Traditional Office & Building Multi-Stream Income"
        ]
    },
    "diandra_escobar": {
        "creator": "Diandra Escobar",
        "title": "Diandra Escobar",
        "channel_url": "https://www.youtube.com/@diandraescobarr",
        "role_desc": "Tech Sales Leader & LinkedIn Career Accelerator",
        "playbook_file": os.path.join(ROOT_DIR, "DIANDRA-ESCOBAR-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "DIANDRA-ESCOBAR-ALL-VIDEOS.md"),
        "key_pillars": [
            "Rapid LinkedIn Authority Building & Inbound Attraction",
            "Landing High-Paying Remote Tech Sales Roles (SDR/BDR/AE) Without Experience",
            "Cold Video & Multi-Touch Outreach Frameworks to VP Decision Makers",
            "Turning Your LinkedIn Profile into a High-Converting Landing Page",
            "Sales Case Studies & Mock Call Interview Mastery",
            "Transitioning from Fired/Entry-Level to 6-Figure Career"
        ]
    },
    "farah_sharghi": {
        "creator": "Farah Sharghi",
        "title": "Farah Sharghi",
        "channel_url": "https://www.youtube.com/@Farah_Sharghi",
        "role_desc": "Ex-Google, Lyft, & TikTok Recruiter & Career Strategist",
        "playbook_file": os.path.join(ROOT_DIR, "FARAH-SHARGHI-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "FARAH-SHARGHI-ALL-VIDEOS.md"),
        "key_pillars": [
            "Big Tech Hiring Revealed: How Google & FAANG Recruiters Actually Filter",
            "The 'Strategic Framing' Blueprint (Why Framing vs. Fabrication Gets You Hired)",
            "6 Big Tech Resume Secrets & The Google X-Y-Z Formula",
            "The HERO Behavioral Interview Framework",
            "Overcoming Age Bias & Modernizing Your Career Presentation",
            "Negotiating Top-of-Band Compensation & Equity in Tech"
        ]
    },
    "career_shakers": {
        "creator": "Davis Nguyen & Career Shakers Team",
        "title": "Career Shakers",
        "channel_url": "https://www.youtube.com/@CareerShakers",
        "role_desc": "Ex-Management Consultant (Bain/McKinsey) & Tech Career Coaching Firm",
        "playbook_file": os.path.join(ROOT_DIR, "CAREER-SHAKERS-JOB-SEARCH-PLAYBOOK.md"),
        "videos_file": os.path.join(DOCS_DIR, "CAREER-SHAKERS-ALL-VIDEOS.md"),
        "key_pillars": [
            "Why You Can't Find a Job in 2026 (Modern Labor Dynamics & Fixes)",
            "Beating Modern ATS Without Keyword Stuffing",
            "The 30-Second High-Conversion Elevator Pitch",
            "S.T.A.R. vs. C.A.R. Interview Frameworks",
            "High-Response Alumni & Internal Referral Networking Systems",
            "Career Pivots: Translating Non-Traditional Backgrounds"
        ]
    }
}

print("Loaded channel configurations.")
