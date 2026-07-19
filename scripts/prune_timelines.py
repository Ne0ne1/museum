"""Keep only user-uploaded photos + events after 2020 for selected places."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(r"C:\Users\liquid\museum")
EVENTS = ROOT / "data" / "events.json"

TARGET = {
    "chsu-campus",
    "argun",
    "gudermes",
    "vedeno",
    "national-museum",
    "lake-kezenoy",
    "heart-of-chechnya",
    "shali",
    "grozny-city",
}

KEEP = {
    ("chsu-campus", "1990-е"),
    ("chsu-campus", "2005"),
    ("chsu-campus", "2020-е"),
    ("argun", "1990-е"),
    ("argun", "2004"),
    ("argun", "2020"),
    ("gudermes", "1990-е"),
    ("gudermes", "2006"),
    ("gudermes", "2020"),
    ("vedeno", "2000"),
    ("vedeno", "2020"),
    ("national-museum", "1990-е"),
    ("national-museum", "2020"),
    ("lake-kezenoy", "2000-е"),
    ("lake-kezenoy", "2020-е"),
    ("heart-of-chechnya", "1990-е"),
    ("heart-of-chechnya", "2020"),
    ("shali", "1990-е"),
    ("shali", "2020"),
    ("grozny-city", "1990-е"),
    ("grozny-city", "2006"),
    ("grozny-city", "2020"),
}


def year_num(year: str) -> int:
    m = re.search(r"\d+", year or "")
    return int(m.group(0)) if m else 0


def main() -> None:
    events = json.loads(EVENTS.read_text(encoding="utf-8"))
    kept = []
    removed = []
    for e in events:
        pid = e.get("placeId")
        if pid not in TARGET:
            kept.append(e)
            continue
        key = (pid, e.get("year"))
        if key in KEEP or year_num(e.get("year", "")) > 2020:
            kept.append(e)
        else:
            removed.append(e)

    EVENTS.write_text(json.dumps(kept, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"removed {len(removed)}")
    for e in removed:
        print(f" - {e['placeId']} {e['year']} {e['image']}")
    print("--- remaining ---")
    for pid in sorted(TARGET):
        ys = [e["year"] for e in kept if e["placeId"] == pid]
        print(f"  {pid}: {', '.join(ys)}")


if __name__ == "__main__":
    main()
