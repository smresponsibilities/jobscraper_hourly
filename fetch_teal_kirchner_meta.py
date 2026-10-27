import json
import os
import subprocess

META_DIR = r"D:\jobscraper-next\data\channels_meta"
os.makedirs(META_DIR, exist_ok=True)

channels = {
    "teal_hq": "https://www.youtube.com/@teal_hq",
    "kirchner_careers": "https://www.youtube.com/@kirchnercareers"
}

for ch, base_url in channels.items():
    print(f"Fetching flat playlist for {ch}...")
    for tab in ["videos", "shorts"]:
        out_file = os.path.join(META_DIR, f"{ch}_{tab}_flat.json")
        cmd = ["yt-dlp", "--flat-playlist", "-J", f"{base_url}/{tab}"]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            data = json.loads(res.stdout).get("entries", [])
            for item in data:
                item["type"] = "video" if tab == "videos" else "short"
            with open(out_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"  Saved {ch} {tab}: {len(data)} items.")
        else:
            print(f"  Error fetching {ch} {tab}: {res.stderr[:200]}")

print("Flat playlists fetched!")
