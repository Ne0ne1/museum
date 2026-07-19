"""Update places.json, districts.json, districts-geo.json, events.json for cropped photos."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(r"C:\Users\liquid\museum")
DATA = ROOT / "data"

NEW_DISTRICTS = [
    {
        "id": "achkhoy-martan",
        "title": "Ачхой-Мартан",
        "subtitle": "Район",
        "lat": 43.188,
        "lng": 45.285,
        "pad": 0.32,
        "minZoom": 11,
    },
    {
        "id": "urus-martan",
        "title": "Урус-Мартан",
        "subtitle": "Район",
        "lat": 43.13,
        "lng": 45.54,
        "pad": 0.32,
        "minZoom": 11,
    },
    {
        "id": "kurchaloy",
        "title": "Курчалой",
        "subtitle": "Район",
        "lat": 43.204,
        "lng": 46.088,
        "pad": 0.32,
        "minZoom": 11,
    },
    {
        "id": "shelkovskoy",
        "title": "Шелковской район",
        "subtitle": "Район",
        "lat": 43.509,
        "lng": 46.323,
        "pad": 0.35,
        "minZoom": 10,
    },
    {
        "id": "shatoy",
        "title": "Шатой",
        "subtitle": "Район",
        "lat": 42.871,
        "lng": 45.688,
        "pad": 0.3,
        "minZoom": 11,
    },
    {
        "id": "itum-kali",
        "title": "Итум-Кали",
        "subtitle": "Район",
        "lat": 42.735,
        "lng": 45.575,
        "pad": 0.3,
        "minZoom": 11,
    },
]

NEW_PLACES = [
    {
        "id": "achkhoy-martan",
        "districtId": "achkhoy-martan",
        "title": "Ачхой-Мартан",
        "region": "Ачхой-Мартановский район",
        "lat": 43.188,
        "lng": 45.285,
        "description": "Площадь Ленина — центр Ачхой-Мартана в разные десятилетия.",
        "image": "assets/photos/achkhoy-martan/2000s.jpg",
        "photo": "assets/photos/achkhoy-martan.jpg",
    },
    {
        "id": "novye-atagi",
        "districtId": "shali",
        "title": "Новые Атаги",
        "region": "Шалинский район",
        "lat": 43.135,
        "lng": 45.773,
        "description": "Мечеть в Новых Атагах — от скромного здания до современного комплекса.",
        "image": "assets/photos/novye-atagi/2020s.jpg",
        "photo": "assets/photos/novye-atagi.jpg",
    },
    {
        "id": "shelkovskaya",
        "districtId": "shelkovskoy",
        "title": "Шелковская",
        "region": "Шелковской район",
        "lat": 43.509,
        "lng": 46.323,
        "description": "Администрация Шелковского района в разные десятилетия.",
        "image": "assets/photos/shelkovskaya/2020s.jpg",
        "photo": "assets/photos/shelkovskaya.jpg",
    },
    {
        "id": "kurchaloy",
        "districtId": "kurchaloy",
        "title": "Курчалой",
        "region": "Курчалоевский район",
        "lat": 43.204,
        "lng": 46.088,
        "description": "Площадь перед администрацией Курчалоя — путь от грунтовой площади до современного облика.",
        "image": "assets/photos/kurchaloy/2020s.jpg",
        "photo": "assets/photos/kurchaloy.jpg",
    },
    {
        "id": "urus-martan",
        "districtId": "urus-martan",
        "title": "Урус-Мартан",
        "region": "Урус-Мартановский район",
        "lat": 43.13,
        "lng": 45.54,
        "description": "Урус-Мартан в ранние годы: улицы, памятники, дом культуры, мост.",
        "image": "assets/photos/urus-martan/1960s-dk.jpg",
        "photo": "assets/photos/urus-martan.jpg",
    },
    {
        "id": "shatoy",
        "districtId": "shatoy",
        "title": "Шатой",
        "region": "Шатойский район",
        "lat": 42.871,
        "lng": 45.688,
        "description": "Вид на село со стороны реки Шатойки — башни, мост, жизнь ущелья.",
        "image": "assets/photos/shatoy/2020s.jpg",
        "photo": "assets/photos/shatoy.jpg",
    },
    {
        "id": "itum-kali",
        "districtId": "itum-kali",
        "title": "Итум-Кали",
        "region": "Итум-Калинский район",
        "lat": 42.735,
        "lng": 45.575,
        "description": "Вид на село с противоположного берега Аргуна — башни и горы сквозь десятилетия.",
        "image": "assets/photos/itum-kali/2020s.jpg",
        "photo": "assets/photos/itum-kali.jpg",
    },
]

# Approximate soft polygons around district centers (lng, lat)
GEO_COLORS = {
    "achkhoy-martan": ("#f59e0b", "rgba(245, 158, 11, 0.24)"),
    "urus-martan": ("#a78bfa", "rgba(167, 139, 250, 0.24)"),
    "kurchaloy": ("#34d399", "rgba(52, 211, 153, 0.24)"),
    "shelkovskoy": ("#60a5fa", "rgba(96, 165, 250, 0.24)"),
    "shatoy": ("#f472b6", "rgba(244, 114, 182, 0.24)"),
    "itum-kali": ("#c084fc", "rgba(192, 132, 252, 0.24)"),
}


def box_poly(lng, lat, d=0.08):
    return [
        [lng - d, lat - d * 0.7],
        [lng, lat - d],
        [lng + d, lat - d * 0.7],
        [lng + d, lat + d * 0.7],
        [lng, lat + d],
        [lng - d, lat + d * 0.7],
        [lng - d, lat - d * 0.7],
    ]


DECADE_EVENTS = {
    "achkhoy-martan": [
        ("1950-е", "1950s", "Площадь формируется", "Грунтовая площадь и административное здание Ачхой-Мартана."),
        ("1960-е", "1960s", "Озеленение", "Появляются деревья, дорожки и упорядоченное пространство площади."),
        ("1970-е", "1970s", "Благоустройство", "Площадь Ленина становится более зелёной и обустроенной."),
        ("1980-е", "1980s", "Городская жизнь", "Цветные кадры: дорога, фонари, повседневное движение."),
        ("1990-е", "1990s", "Конец века", "Площадь на рубеже тысячелетий."),
        ("2000-е", "2000s", "Новый облик", "Круговой цветник, асфальт и обновлённый центр."),
    ],
    "novye-atagi": [
        ("1950-е", "1950s", "Скромная мечеть", "Небольшое здание с отдельным минаретом в Новых Атагах."),
        ("1960-е", "1960s", "Новый объём", "Мечеть с куполом и высоким минаретом."),
        ("1970-е", "1970s", "Улица у мечети", "Появляется дорога, фонари, ограда."),
        ("1980-е", "1980s", "Привычный силуэт", "Устоявшийся облик мечети конца советского периода."),
        ("1990-е", "1990s", "Зелёные купола", "Цветная эпоха: зелёный купол и туи у ограды."),
        ("2020-е", "2020s", "Величественный комплекс", "Современная большая мечеть с несколькими куполами и минаретами."),
    ],
    "shelkovskaya": [
        ("1950-е", "1950s", "Администрация", "Классическое здание администрации на открытой площади."),
        ("1960-е", "1960s", "Памятник на площади", "Появляется монумент, площадь оживает."),
        ("1970-е", "1970s", "Скульптура и ели", "Зрелое озеленение и крупные монументы."),
        ("1980-е", "1980s", "Сквер", "Фонари, цветники, зрелые деревья."),
        ("1990-е", "1990s", "Синяя крыша", "Здание с цветной кровлей и ухоженными клумбами."),
        ("2020-е", "2020s", "Сегодня", "Флаги, стела и современный облик администрации."),
    ],
    "kurchaloy": [
        ("1950-е", "1950s", "Грунтовая площадь", "Администрация Курчалоя на открытом пространстве."),
        ("1960-е", "1960s", "Монумент", "Памятник на площади, растущие деревья."),
        ("1970-е", "1970s", "Озеленение", "Площадь становится зеленее и обустроеннее."),
        ("1980-е", "1980s", "Пешеходный переход", "Городская инфраструктура и зрелый сквер."),
        ("1990-е", "1990s", "Открытая площадь", "Широкий асфальт и ясный вид на администрацию."),
        ("2020-е", "2020s", "Современный Курчалой", "Зелёная крыша, туи, флаги, обновлённый центр."),
    ],
    "shatoy": [
        ("1950-е", "1950s", "Село у реки", "Вид на Шатой со стороны Шатойки — башни на склоне."),
        ("1960-е", "1960s", "Жизнь ущелья", "Плотнее застройка, те же башни над рекой."),
        ("1970-е", "1970s", "Мост", "Появляется мост через реку."),
        ("1980-е", "1980s", "Растущее село", "Больше домов, мост и башни в одном кадре."),
        ("1990-е", "1990s", "Цвет гор", "Цветной вид на Шатой и Шатойку."),
        ("2020-е", "2020s", "Шатой сегодня", "Современные здания рядом с историческими башнями."),
    ],
    "itum-kali": [
        ("1950-е", "1950s", "Башни над Аргуном", "Вид на Итум-Кали с противоположного берега."),
        ("1960-е", "1960s", "Горное село", "Башни и дома на склоне."),
        ("1970-е", "1970s", "Силуэт башен", "Классический вид ущелья Аргуна."),
        ("1980-е", "1980s", "Конец XX века", "Село и башни в конце советского периода."),
        ("1990-е", "1990s", "Цвет ущелья", "Зелёные склоны и бирюза реки."),
        ("2020-е", "2020s", "Итум-Кали сегодня", "Мост, новая застройка и сохранённые башни."),
    ],
    "chsu-campus": [
        ("1950-е", "1950s", "Старый корпус", "Корпус ЧГУ в микрорайоне на открытом пространстве."),
        ("1960-е", "1960s", "Дорога и саженцы", "Появляется дорога и молодые деревья у корпуса."),
        ("1970-е", "1970s", "Озеленение", "Деревья подросли, улица обретает городской вид."),
        ("1980-е", "1980s", "Ухоженный двор", "Живые изгороди и зрелая зелень у корпуса."),
        ("1990-е", "1990s", "Цветной кадр", "Светлые стены корпуса среди зелени."),
        ("2020-е", "2020s", "Корпус сегодня", "Сохранённый облик старого корпуса ЧГУ."),
    ],
    "lake-kezenoy": [
        ("1950-е", "1950s", "Дикий берег", "Кезеной-Ам с редкими домами на берегу."),
        ("1960-е", "1960s", "Поселение у озера", "Берег становится обжитым."),
        ("1970-е", "1970s", "Дорога к озеру", "Появляется дорога и больше построек."),
        ("1980-е", "1980s", "Турбаза", "Крупное здание на берегу — инфраструктура отдыха."),
        ("1990-е", "1990s", "Горное озеро", "Цвет воды и склонов на рубеже веков."),
        ("2020-е", "2020s", "Жемчужина ЧР", "Мечеть, дороги и современный туристический облик."),
    ],
}

URUS_EVENTS = [
    ("1950-е", "1950s-street", "Улица в центре", "Центральная улица Урус-Мартана в 1950-е годы."),
    ("1950-е", "1950s-monument", "Памятник павшим", "Памятник павшим воинам в центре города."),
    ("1960-е", "1960s-dk", "Дом культуры", "Дом культуры — культурный центр Урус-Мартана."),
    ("1960-е", "1960s-center", "Центральная улица", "Озеленённая центральная улица 1960-х."),
    ("1970-е", "1970s-houses", "Жилые дома", "Многоэтажная застройка 1970-х."),
    ("1980-е", "1980s-bridge", "Мост через реку", "Мост через реку Урус-Мартан."),
]


def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def dump(name, data):
    (DATA / name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main():
    districts = load("districts.json")
    existing_d = {d["id"] for d in districts}
    for d in NEW_DISTRICTS:
        if d["id"] not in existing_d:
            districts.append(d)
    dump("districts.json", districts)

    places = load("places.json")
    by_id = {p["id"]: i for i, p in enumerate(places)}

    # Update existing covers for chsu / lake
    for pid, cover in [
        ("chsu-campus", "assets/photos/chsu-campus.jpg"),
        ("lake-kezenoy", "assets/photos/lake-kezenoy.jpg"),
    ]:
        if pid in by_id:
            places[by_id[pid]]["photo"] = cover
            places[by_id[pid]]["image"] = cover.replace(".jpg", "/2020s.jpg")

    for p in NEW_PLACES:
        if p["id"] in by_id:
            places[by_id[p["id"]]] = p
        else:
            places.append(p)
    dump("places.json", places)

    geo = load("districts-geo.json")
    existing_g = {f["properties"]["id"] for f in geo["features"]}
    for d in NEW_DISTRICTS:
        if d["id"] in existing_g:
            continue
        color, fill = GEO_COLORS[d["id"]]
        geo["features"].append(
            {
                "type": "Feature",
                "properties": {
                    "id": d["id"],
                    "title": d["title"],
                    "color": color,
                    "fill": fill,
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [box_poly(d["lng"], d["lat"])],
                },
            }
        )
    dump("districts-geo.json", geo)

    events = load("events.json")
    # Drop old placeholder events for places we fully replace
    replace_ids = set(DECADE_EVENTS) | {"urus-martan"}
    events = [e for e in events if e["placeId"] not in replace_ids]

    for place_id, rows in DECADE_EVENTS.items():
        for year, file_stem, title, desc in rows:
            events.append(
                {
                    "placeId": place_id,
                    "year": year,
                    "title": title,
                    "description": desc,
                    "image": f"assets/photos/{place_id}/{file_stem}.jpg",
                }
            )

    for year, file_stem, title, desc in URUS_EVENTS:
        events.append(
            {
                "placeId": "urus-martan",
                "year": year,
                "title": title,
                "description": desc,
                "image": f"assets/photos/urus-martan/{file_stem}.jpg",
            }
        )

    dump("events.json", events)
    print(f"places={len(places)} districts={len(districts)} events={len(events)}")


if __name__ == "__main__":
    main()
