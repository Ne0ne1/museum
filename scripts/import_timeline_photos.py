"""Import timeline photos by visual ID + year from mangled filenames."""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from PIL import Image

SRC = Path(r"C:\Users\liquid\.cursor\projects\c-Users-liquid-museum\assets")
ROOT = Path(r"C:\Users\liquid\museum")
PHOTOS = ROOT / "assets" / "photos"
EVENTS = ROOT / "data" / "events.json"
PLACES = ROOT / "data" / "places.json"

# uuid suffix (last hex before .png) → place, year label, title, description
MAPPING = {
    # ЧГУ
    "6823eee1fbcf": ("chsu-campus", "2020-е", "ЧГУ сегодня", "Современный кампус Чеченского государственного университета."),
    "56439b83087f": ("chsu-campus", "1990-е", "Университет после войны", "Здание ЧГУ с следами войны и началом восстановления."),
    # Шали
    "dff36bb85e3e": ("shali", "2020", "Мечеть «Гордость мусульман»", "Одна из крупнейших мечетей Европы в городе Шали."),
    # Аргун
    "8b5e06bbb34f": ("argun", "2020", "Мечеть и Argun City", "Современный центр Аргуна: мечеть Аймани Кадыровой и деловой центр."),
    # Гудермес
    "f26064e8ed72": ("gudermes", "2005", "Вокзал после войны", "Железнодорожный вокзал Гудермеса в годы восстановления."),
    "7eddd45fa56a": ("gudermes", "2020", "Гудермес-Сити", "Новый вокзал и комплекс Gudermes City."),
    "d60c20a8c357": ("gudermes", "1990-е", "Вокзал в войну", "Станция Гудермес во время конфликта."),
    # Кезеной-Ам
    "5baec7de901a": ("lake-kezenoy", "2020-е", "Курорт на озере", "Современный туристический комплекс на берегу Кезеной-Ам."),
    "ef08533335fd": ("lake-kezenoy", "2000-е", "Озеро в начале века", "Кезеной-Ам: берег, руины базы и присутствие наблюдателей."),
    # Национальный музей
    "b34d695b3f19": ("national-museum", "2005", "Музей после войны", "Временное здание Национального музея ЧР и эвакуация экспонатов."),
    "bc91e2f3ceb4": ("national-museum", "2020", "Национальный музей сегодня", "Современное здание Национального музея Чеченской Республики."),
    "69984663798b": ("national-museum", "1990-е", "Музей изобразительных искусств", "Разрушенный Республиканский музей изобразительных искусств."),
    # Сердце Чечни / Грозный-Сити / центр
    "e77c10225869": ("heart-of-chechnya", "2020", "Мечеть «Сердце Чечни»", "Главная мечеть республики на фоне обновлённого Грозного."),
    "c08c349aed80": ("grozny-city", "2020", "Грозный-Сити", "Высотный комплекс Грозный-Сити на берегу Сунжи."),
    "6e193779c43a": ("grozny-city", "2006", "Стройка нового центра", "Реконструкция центра Грозного: краны и новые фундаменты."),
    "df4e98e99ede": ("grozny-center", "2006", "Улица возрождается", "Руины рядом с новым домом — повседневная реконструкция города."),
    "7913f59e1468": ("grozny-center", "1996", "Рынок среди руин", "Уличная жизнь и рынок на фоне разрушенных кварталов."),
    "d9faf131e083": ("grozny-center", "1999", "БТР у завода", "Военная техника и стихийный рынок у разрушенных цехов."),
    "03f4dc9c295a": ("grozny-center", "1995", "Руины центра", "Разрушенный центр Грозного зимой 1994–1995 годов."),
    "8e9495f83c1c": ("grozny-center", "1994", "Улица после боёв", "БТР и жители на улице разрушенного Грозного."),
    # Ведено / Шатой
    "c5a31843ef95": ("vedeno", "2000", "Блокпост в горах", "Контрольно-пропускной пункт у строящейся мечети в горном селе."),
    "6badd9f6ed0e": ("shatoy", "2020", "Шатой сегодня", "Обновлённый горный посёлок и мечеть на фоне хребтов."),
}


def find_src(suffix: str) -> Path:
    matches = [p for p in SRC.glob("*.png") if p.name.endswith(f"{suffix}.png") and "WhatsApp" not in p.name]
    if not matches:
        raise FileNotFoundError(suffix)
    return matches[0]


def year_key(year: str) -> int:
    m = re.search(r"\d+", year)
    return int(m.group(0)) if m else 0


def main():
    events = json.loads(EVENTS.read_text(encoding="utf-8"))
    places = json.loads(PLACES.read_text(encoding="utf-8"))
    places_by_id = {p["id"]: p for p in places}

    imported = []
    replace_keys = set()

    for suffix, (place_id, year, title, desc) in MAPPING.items():
        src = find_src(suffix)
        dest_dir = PHOTOS / place_id
        dest_dir.mkdir(parents=True, exist_ok=True)

        if year.endswith("-е"):
            stem = year[:-2] + "s"
        elif year.isdigit():
            stem = year
        else:
            stem = re.sub(r"[^\dA-Za-z\-]+", "", year) or "photo"

        dest = dest_dir / f"{stem}.jpg"
        if dest.exists() and place_id in ("chsu-campus", "lake-kezenoy") and stem.endswith("s"):
            dest = dest_dir / f"{stem}-photo.jpg"

        im = Image.open(src).convert("RGB")
        im.thumbnail((1600, 1200))
        im.save(dest, "JPEG", quality=90, optimize=True)
        rel = f"assets/photos/{place_id}/{dest.name}"
        imported.append((place_id, year, rel, title, desc))
        replace_keys.add((place_id, year))

        if place_id in places_by_id and year_key(year) >= 2020:
            places_by_id[place_id]["photo"] = rel
            places_by_id[place_id]["image"] = rel

    events = [
        e
        for e in events
        if (e.get("placeId"), e.get("year")) not in replace_keys
    ]
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

    # preserve place order
    ordered_places = []
    for p in places:
        ordered_places.append(places_by_id[p["id"]])

    EVENTS.write_text(json.dumps(events, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    PLACES.write_text(json.dumps(ordered_places, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Imported {len(imported)} photos, events={len(events)}")
    for place_id, year, rel, title, _ in sorted(imported, key=lambda x: (x[0], year_key(x[1]))):
        ok = (ROOT / rel).exists()
        print(f"  {place_id:18} {year:8} ok={ok}  {title}")


if __name__ == "__main__":
    main()
