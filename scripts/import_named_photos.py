"""Import timeline photos from English filenames: {place}_{year}-uuid.png"""
from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image

SRC = Path(r"C:\Users\liquid\.cursor\projects\c-Users-liquid-museum\assets")
ROOT = Path(r"C:\Users\liquid\museum")
PHOTOS = ROOT / "assets" / "photos"
EVENTS = ROOT / "data" / "events.json"
PLACES = ROOT / "data" / "places.json"

PLACE_ALIAS = {
    "chgu": "chsu-campus",
    "argun": "argun",
    "gudermes": "gudermes",
    "gudrmes": "gudermes",
    "vedeno": "vedeno",
    "national_museum": "national-museum",
    "kezenoy_am": "lake-kezenoy",
    "serdce_chechni": "heart-of-chechnya",
    "shali": "shali",
    "grozny_sity": "grozny-city",
    "grozny_city": "grozny-city",
}

TITLES = {
    ("chsu-campus", "1990-е"): ("ЧГУ в 1990-е", "Здание университета после боёв, начало восстановления."),
    ("chsu-campus", "2005"): ("ЧГУ, 2005", "Кампус в годы восстановления."),
    ("chsu-campus", "2020-е"): ("ЧГУ сегодня", "Современный кампус Чеченского государственного университета."),
    ("argun", "1990-е"): ("Аргун в 1990-е", "Город в годы конфликта."),
    ("argun", "2004"): ("Аргун, 2004", "Аргун в середине 2000-х."),
    ("argun", "2020"): ("Аргун сегодня", "Мечеть Аймани Кадыровой и Argun City."),
    ("gudermes", "1990-е"): ("Вокзал Гудермеса, 1990-е", "Станция во время конфликта."),
    ("gudermes", "2006"): ("Вокзал Гудермеса, 2006", "Станция в годы восстановления."),
    ("gudermes", "2020"): ("Гудермес-Сити", "Новый вокзал и современный центр города."),
    ("vedeno", "2000"): ("Ведено, 2000", "Блокпост и жизнь горного района."),
    ("vedeno", "2020"): ("Ведено сегодня", "Современный облик района."),
    ("national-museum", "1990-е"): ("Музей в 1990-е", "Республиканский музей изобразительных искусств после боёв."),
    ("national-museum", "2020"): ("Национальный музей сегодня", "Современное здание Национального музея ЧР."),
    ("lake-kezenoy", "2000-е"): ("Кезеной-Ам, 2000-е", "Озеро в начале XXI века."),
    ("lake-kezenoy", "2020-е"): ("Курорт Кезеной-Ам", "Современный туристический комплекс на берегу озера."),
    ("heart-of-chechnya", "1990-е"): ("Место будущей мечети, 1990-е", "Центр Грозного в годы войны — до строительства мечети."),
    ("heart-of-chechnya", "2020"): ("Мечеть «Сердце Чечни»", "Главная мечеть республики."),
    ("shali", "1990-е"): ("Шали в 1990-е", "Город в годы конфликта."),
    ("shali", "2020"): ("Мечеть «Гордость мусульман»", "Современный комплекс в Шали."),
    ("grozny-city", "1990-е"): ("Центр Грозного, 1990-е", "Разрушенный центр — место будущего Грозный-Сити."),
    ("grozny-city", "2006"): ("Стройка Грозный-Сити", "Реконструкция делового центра."),
    ("grozny-city", "2020"): ("Грозный-Сити", "Высотный комплекс на берегу Сунжи."),
}


def format_year(raw: str, place_id: str) -> str:
    if raw == "1990":
        return "1990-е"
    if raw == "2000" and place_id == "lake-kezenoy":
        return "2000-е"
    if raw == "2020" and place_id in ("chsu-campus", "lake-kezenoy"):
        return "2020-е"
    return raw


def year_key(year: str) -> int:
    m = re.search(r"\d+", year)
    return int(m.group(0)) if m else 0


def parse_files():
    out = []
    for p in SRC.glob("*.png"):
        m = re.search(r"images_([a-z][a-z0-9_]*)-[0-9a-f]{8}-", p.name)
        if not m:
            continue
        token = m.group(1)
        ym = re.match(r"(.+)_(\d{4})$", token)
        if not ym:
            continue
        alias, year_raw = ym.group(1), ym.group(2)
        place_id = PLACE_ALIAS.get(alias)
        if not place_id:
            print("unknown place alias", alias)
            continue
        year = format_year(year_raw, place_id)
        out.append((p, place_id, year, year_raw))
    return out


def main():
    files = parse_files()
    events = json.loads(EVENTS.read_text(encoding="utf-8"))
    places = json.loads(PLACES.read_text(encoding="utf-8"))
    places_by_id = {p["id"]: p for p in places}

    replace_keys = set()
    imported = []

    for src, place_id, year, year_raw in files:
        dest_dir = PHOTOS / place_id
        dest_dir.mkdir(parents=True, exist_ok=True)
        stem = year[:-2] + "s" if year.endswith("-е") else year
        dest = dest_dir / f"{stem}.jpg"

        im = Image.open(src).convert("RGB")
        im.thumbnail((1600, 1200))
        im.save(dest, "JPEG", quality=90, optimize=True)
        rel = f"assets/photos/{place_id}/{dest.name}"

        title, desc = TITLES.get(
            (place_id, year),
            (f"{places_by_id.get(place_id, {}).get('title', place_id)}, {year}", ""),
        )
        imported.append((place_id, year, rel, title, desc))
        replace_keys.add((place_id, year))

        if year_key(year) >= 2020 and place_id in places_by_id:
            places_by_id[place_id]["photo"] = rel
            places_by_id[place_id]["image"] = rel

    # drop old events for same place+year (including prior bad imports)
    events = [e for e in events if (e.get("placeId"), e.get("year")) not in replace_keys]

    # also drop leftover placeholder-only years for places we fully refresh? keep other years
    for place_id, year, rel, title, desc in imported:
        events.append(
            {
                "placeId": place_id,
                "year": year,
                "title": title,
                "description": desc,
                "image": rel,
            }
        )

    events.sort(key=lambda e: (e.get("placeId", ""), year_key(e.get("year", "")), e.get("year", "")))
    ordered = [places_by_id[p["id"]] for p in places]

    EVENTS.write_text(json.dumps(events, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    PLACES.write_text(json.dumps(ordered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Imported {len(imported)} / expected 22")
    for place_id, year, rel, title, _ in sorted(imported, key=lambda x: (x[0], year_key(x[1]))):
        print(f"  {place_id:18} {year:8} {(ROOT/rel).exists()}  {title}")


if __name__ == "__main__":
    main()
