import json
import os

META_DIR = r"D:\jobscraper-next\data\channels_meta"

for ch in ["teal_hq", "kirchner_careers"]:
    print(f"\n==================== {ch.upper()} ====================")
    for tab in ["videos", "shorts"]:
        fpath = os.path.join(META_DIR, f"{ch}_{tab}_flat.json")
        with open(fpath, "r", encoding="utf-8") as f:
            items = json.load(f)
        sorted_items = sorted(items, key=lambda x: x.get("view_count") or 0, reverse=True)
        print(f"--- Top 5 {tab.upper()} ({len(items)} total) ---")
        for v in sorted_items[:5]:
            vc = v.get("view_count") or 0
            safe_title = v.get('title', '').encode('ascii', 'ignore').decode('ascii')
            print(f"  [{vc:,}] {safe_title} ({v.get('id')})")
