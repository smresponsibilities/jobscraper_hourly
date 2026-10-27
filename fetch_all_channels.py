import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import subprocess
from youtube_transcript_api import YouTubeTranscriptApi

META_DIR = r"D:\jobscraper-next\data\channels_meta"
OUTPUT_DIR = r"D:\jobscraper-next\data\channels_extracted"
os.makedirs(OUTPUT_DIR, exist_ok=True)

api = YouTubeTranscriptApi()

# Highlighted specific video IDs
HIGHLIGHTED_VIDEOS = {
    "o1W-En6U2T8": "Emily Durham - How to Actually Network in 2025",
    "WrValFMtQzk": "Wilson Wye - The System I Used to Work 3 Full-Time Jobs at Once",
    "vrJGxdk1Cug": "Career Shakers - Reasons why you can't find a job in 2026 (UPDATED)",
    "fGaBPVMtkRI": "Wilson Wye - FORGET LinkedIn This Is Where People Actually Get Hired",
    "T__1QViXUxk": "Farah Sharghi - Ex-Google Recruiter Explains Why Lying Gets You Hired",
    "eGmZZFJ-8PY": "Farah Sharghi - 6 Resume Secrets",
    "6PZGOzYUMh4": "A Life After Layoff - Tech Worker Termination",
    "eza-l-kBK40": "A Life After Layoff - 10 Things to Avoid Revealing",
    "2lycnV0COk0": "Career Shakers - BEST resume examples",
    "qW2YwaMbhxg": "Career Shakers - Beat applicant tracking system",
    "_ZFncQNrOhw": "Diandra Escobar - Grow LinkedIn Fast",
    "5kYG8ErAYfE": "Saarim Asady - LinkedIn Big Update"
}

def get_video_info(video_entry):
    vid = video_entry.get("id")
    url = f"https://www.youtube.com/watch?v={vid}"
    
    # Check cache
    cache_file = os.path.join(OUTPUT_DIR, f"{vid}.json")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    # Fetch description with yt-dlp
    desc = ""
    try:
        desc_cmd = ["yt-dlp", "--skip-download", "--print", "%(description)s", url]
        res = subprocess.run(desc_cmd, capture_output=True, text=True, timeout=25)
        desc = res.stdout.strip()
    except Exception as e:
        desc = ""

    # Try transcript
    transcript_text = ""
    try:
        t_data = api.fetch(vid)
        transcript_text = " ".join([s.text for s in t_data.snippets])
    except Exception:
        transcript_text = ""

    data = {
        "id": vid,
        "title": video_entry.get("title"),
        "duration": video_entry.get("duration"),
        "view_count": video_entry.get("view_count"),
        "url": url,
        "description": desc,
        "transcript": transcript_text
    }

    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

    return data

channels_to_process = [
    ("a_life_after_layoff", 25),
    ("saarim_asady", 25),
    ("emily_durham", 25),
    ("wilson_wye", 25),
    ("diandra_escobar", 17),
    ("farah_sharghi", 34),
    ("career_shakers", 25)
]

for ch_key, limit in channels_to_process:
    meta_file = os.path.join(META_DIR, f"{ch_key}_flat.json")
    if not os.path.exists(meta_file):
        continue
    with open(meta_file, "r", encoding="utf-8") as f:
        meta_data = json.load(f)
    
    entries = meta_data.get("entries", [])
    
    # Sort by view_count descending, but prioritize highlighted videos
    highlighted_in_ch = [e for e in entries if e.get("id") in HIGHLIGHTED_VIDEOS]
    other_entries = [e for e in entries if e.get("id") not in HIGHLIGHTED_VIDEOS]
    sorted_others = sorted(other_entries, key=lambda x: x.get("view_count") or 0, reverse=True)
    
    selected = highlighted_in_ch + sorted_others[:limit]
    print(f"[{ch_key}] Processing {len(selected)} priority videos...")

    results = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(get_video_info, entry): entry for entry in selected}
        for future in as_completed(futures):
            res = future.result()
            results.append(res)
            print(f"  Done: {res['title'][:40]} | Desc: {len(res['description'])} chars | Transcript: {len(res['transcript'])} chars")

    ch_out_file = os.path.join(OUTPUT_DIR, f"{ch_key}_top.json")
    with open(ch_out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(results)} videos for {ch_key} to {ch_out_file}")

print("All channel extractions completed!")
