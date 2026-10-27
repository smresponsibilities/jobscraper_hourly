import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from youtube_transcript_api import YouTubeTranscriptApi

META_DIR = r"D:\jobscraper-next\data\channels_meta"
OUTPUT_DIR = r"D:\jobscraper-next\data\channels_extracted"
os.makedirs(OUTPUT_DIR, exist_ok=True)

api = YouTubeTranscriptApi()

def load_entries(ch_name):
    entries = []
    seen = set()
    for tab in ["videos", "shorts"]:
        fpath = os.path.join(META_DIR, f"{ch_name}_{tab}_flat.json")
        if os.path.exists(fpath):
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            for item in data:
                if item["id"] not in seen:
                    item["type"] = "video" if tab == "videos" else "short"
                    entries.append(item)
                    seen.add(item["id"])
    return entries

def get_video_info(video_entry):
    vid = video_entry.get("id")
    v_type = video_entry.get("type", "video")
    url = f"https://www.youtube.com/watch?v={vid}"
    cache_file = os.path.join(OUTPUT_DIR, f"{vid}.json")

    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                data["type"] = v_type
                return data
        except Exception:
            pass

    desc = ""
    try:
        desc_cmd = ["yt-dlp", "--skip-download", "--print", "%(description)s", url]
        res = subprocess.run(desc_cmd, capture_output=True, text=True, timeout=15)
        desc = res.stdout.strip()
    except Exception:
        desc = ""

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
        "type": v_type,
        "description": desc,
        "transcript": transcript_text
    }

    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

    return data

# Process Kirchner Careers (73 items)
kc_entries = load_entries("kirchner_careers")
print(f"Processing Kirchner Careers ({len(kc_entries)} items)...")
kc_results = []
with ThreadPoolExecutor(max_workers=8) as executor:
    futures = {executor.submit(get_video_info, e): e for e in kc_entries}
    for idx, f in enumerate(as_completed(futures), 1):
        res = f.result()
        kc_results.append(res)
        if idx % 15 == 0 or idx == len(kc_entries):
            safe_t = res['title'].encode('ascii', 'ignore').decode('ascii')
            print(f"  [Kirchner {idx}/{len(kc_entries)}] {safe_t[:35]}...")

with open(os.path.join(OUTPUT_DIR, "kirchner_careers_all.json"), "w", encoding="utf-8") as f:
    json.dump(kc_results, f, ensure_ascii=False, indent=2)
print("Saved kirchner_careers_all.json!")

# Process Teal (955 items: 237 videos + 718 shorts)
teal_entries = load_entries("teal_hq")
print(f"\nProcessing Teal ({len(teal_entries)} items)...")
teal_results = []
with ThreadPoolExecutor(max_workers=16) as executor:
    futures = {executor.submit(get_video_info, e): e for e in teal_entries}
    for idx, f in enumerate(as_completed(futures), 1):
        res = f.result()
        teal_results.append(res)
        if idx % 50 == 0 or idx == len(teal_entries):
            safe_t = res['title'].encode('ascii', 'ignore').decode('ascii')
            print(f"  [Teal {idx}/{len(teal_entries)}] {safe_t[:35]}...")

with open(os.path.join(OUTPUT_DIR, "teal_hq_all.json"), "w", encoding="utf-8") as f:
    json.dump(teal_results, f, ensure_ascii=False, indent=2)
print("Saved teal_hq_all.json!")

print("\nAll extractions completed successfully!")
