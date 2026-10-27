import json
import time
import os
import subprocess
from youtube_transcript_api import YouTubeTranscriptApi

CHANNEL_URL = "https://www.youtube.com/@olivercordingley/videos"
OUTPUT_DIR = r"D:\jobscraper-next\data\cordingley_raw"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 1. Fetch video list using yt-dlp
print("Fetching video list...")
cmd = [
    "yt-dlp",
    "--flat-playlist",
    "--print", "%(id)s\t%(title)s\t%(duration_string)s\t%(url)s",
    CHANNEL_URL
]
res = subprocess.run(cmd, capture_output=True, text=True, check=True)
lines = [l.strip() for l in res.stdout.strip().split("\n") if l.strip()]

videos = []
for line in lines:
    parts = line.split("\t")
    if len(parts) >= 4:
        videos.append({
            "id": parts[0],
            "title": parts[1],
            "duration": parts[2],
            "url": parts[3]
        })

print(f"Found {len(videos)} videos.")

api = YouTubeTranscriptApi()

# 2. Iterate and download transcripts + descriptions
results = []
for idx, v in enumerate(videos, 1):
    vid = v["id"]
    out_file = os.path.join(OUTPUT_DIR, f"{vid}.json")
    
    if os.path.exists(out_file):
        with open(out_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            results.append(data)
            print(f"[{idx}/{len(videos)}] Loaded cached {vid}: {v['title']}")
            continue

    print(f"[{idx}/{len(videos)}] Fetching {vid}: {v['title']}")
    
    # Get description & chapters via yt-dlp
    desc_cmd = [
        "yt-dlp",
        "--skip-download",
        "--print", "%(description)s",
        v["url"]
    ]
    try:
        desc_res = subprocess.run(desc_cmd, capture_output=True, text=True, timeout=20)
        desc = desc_res.stdout.strip()
    except Exception as e:
        desc = ""
        print(f"  Warning: failed to get desc for {vid}: {e}")

    # Get transcript
    transcript_text = ""
    snippets_list = []
    try:
        t_data = api.fetch(vid)
        snippets_list = [{"text": s.text, "start": s.start, "duration": s.duration} for s in t_data.snippets]
        transcript_text = " ".join([s.text for s in t_data.snippets])
        print(f"  Transcript fetched ({len(snippets_list)} snippets, {len(transcript_text.split())} words)")
    except Exception as e:
        print(f"  Warning: failed transcript for {vid}: {e}")

    video_data = {
        "id": vid,
        "title": v["title"],
        "duration": v["duration"],
        "url": v["url"],
        "description": desc,
        "transcript": transcript_text,
        "snippets": snippets_list
    }
    
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(video_data, f, ensure_ascii=False, indent=2)
        
    results.append(video_data)
    time.sleep(1) # respectful pacing

all_data_file = r"D:\jobscraper-next\data\oliver_cordingley_all.json"
with open(all_data_file, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(f"Completed! Total videos processed: {len(results)}. Saved to {all_data_file}")
