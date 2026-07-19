"""Fetch real Chechnya admin boundaries from Overpass → districts-geo.json"""
from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(r"C:\Users\liquid\museum")
OUT = ROOT / "data" / "districts-geo.json"

# Our place ids → OSM name patterns (ru / en)
NAME_MAP = [
    ("grozny", [r"грозн", r"grozny"]),
    ("argun", [r"^аргун", r"^argun"]),
    ("gudermes", [r"гудермес", r"gudermes"]),
    ("vedeno", [r"веден", r"vedeno"]),
    ("shali", [r"шалин", r"shali"]),
    ("achkhoy-martan", [r"ачхой", r"achkhoy"]),
    ("urus-martan", [r"урус-?мартан", r"urus.?martan"]),
    ("kurchaloy", [r"курчало", r"kurchal"]),
    ("shelkovskoy", [r"шелков", r"shelkov"]),
    ("shatoy", [r"шатой", r"shatoy"]),
    ("itum-kali", [r"итум", r"itum.?kal"]),
]

COLORS = {
    "grozny": ("#3ddc97", "rgba(61, 220, 151, 0.28)"),
    "argun": ("#5b9cff", "rgba(91, 156, 255, 0.26)"),
    "gudermes": ("#fbbf24", "rgba(251, 191, 36, 0.26)"),
    "vedeno": ("#38bdf8", "rgba(56, 189, 248, 0.24)"),
    "shali": ("#fb7185", "rgba(251, 113, 133, 0.24)"),
    "achkhoy-martan": ("#f59e0b", "rgba(245, 158, 11, 0.24)"),
    "urus-martan": ("#a78bfa", "rgba(167, 139, 250, 0.24)"),
    "kurchaloy": ("#34d399", "rgba(52, 211, 153, 0.24)"),
    "shelkovskoy": ("#60a5fa", "rgba(96, 165, 250, 0.24)"),
    "shatoy": ("#f472b6", "rgba(244, 114, 182, 0.24)"),
    "itum-kali": ("#c084fc", "rgba(192, 132, 252, 0.24)"),
}

TITLES = {
    "grozny": "Грозный",
    "argun": "Аргун",
    "gudermes": "Гудермес",
    "vedeno": "Веденский район",
    "shali": "Шалинский район",
    "achkhoy-martan": "Ачхой-Мартан",
    "urus-martan": "Урус-Мартан",
    "kurchaloy": "Курчалой",
    "shelkovskoy": "Шелковской район",
    "shatoy": "Шатой",
    "itum-kali": "Итум-Кали",
}

OVERPASS = "https://overpass-api.de/api/interpreter"

QUERY = r"""
[out:json][timeout:180];
area["name:en"="Chechnya"]["admin_level"="4"]->.che;
(
  relation["boundary"="administrative"]["admin_level"~"6|8|9"](area.che);
);
out body;
>;
out skel qt;
"""


def fetch_overpass():
    data = urllib.parse.urlencode({"data": QUERY}).encode("utf-8")
    req = urllib.request.Request(
        OVERPASS,
        data=data,
        headers={"User-Agent": "museum-stand/1.0 (local demo)"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=200) as resp:
        return json.loads(resp.read().decode("utf-8"))


def match_id(tags: dict) -> str | None:
    names = " ".join(
        filter(
            None,
            [
                tags.get("name"),
                tags.get("name:ru"),
                tags.get("name:en"),
                tags.get("official_name"),
            ],
        )
    ).lower()
    for pid, patterns in NAME_MAP:
        for pat in patterns:
            if re.search(pat, names, re.I):
                return pid
    return None


def build_ways(elements):
    nodes = {}
    ways = {}
    rels = []
    for el in elements:
        t = el["type"]
        if t == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])
        elif t == "way":
            ways[el["id"]] = el.get("nodes", [])
        elif t == "relation":
            rels.append(el)
    return nodes, ways, rels


def way_coords(way_id, ways, nodes):
    return [nodes[nid] for nid in ways.get(way_id, []) if nid in nodes]


def relation_polygons(rel, ways, nodes):
    """Assemble outer rings from relation members (simple approach)."""
    outers = []
    inners = []
    for m in rel.get("members", []):
        if m.get("type") != "way":
            continue
        coords = way_coords(m["ref"], ways, nodes)
        if len(coords) < 2:
            continue
        role = m.get("role") or "outer"
        if role == "inner":
            inners.append(coords)
        else:
            outers.append(coords)

    rings = _merge_rings(outers)
    holes = _merge_rings(inners)

    polygons = []
    for ring in rings:
        if len(ring) < 4:
            continue
        # close ring
        if ring[0] != ring[-1]:
            ring = ring + [ring[0]]
        poly = [ring]
        # attach holes that fall inside (simplified: all holes to first outer if only one)
        polygons.append(poly)

    if len(polygons) == 1 and holes:
        for h in holes:
            if h[0] != h[-1]:
                h = h + [h[0]]
            polygons[0].append(h)

    if not polygons:
        return None
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": [[p] if isinstance(p[0][0], (int, float)) else p for p in polygons]}


def _merge_rings(segments):
    """Stitch way segments into closed/open rings by matching endpoints."""
    if not segments:
        return []
    segs = [list(s) for s in segments if len(s) >= 2]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while changed:
            changed = False
            for i, s in enumerate(segs):
                if _near(ring[-1], s[0]):
                    ring.extend(s[1:])
                    segs.pop(i)
                    changed = True
                    break
                if _near(ring[-1], s[-1]):
                    ring.extend(reversed(s[:-1]))
                    segs.pop(i)
                    changed = True
                    break
                if _near(ring[0], s[-1]):
                    ring = s[:-1] + ring
                    segs.pop(i)
                    changed = True
                    break
                if _near(ring[0], s[0]):
                    ring = list(reversed(s[1:])) + ring
                    segs.pop(i)
                    changed = True
                    break
        rings.append(ring)
    return rings


def _near(a, b, eps=1e-7):
    return abs(a[0] - b[0]) < eps and abs(a[1] - b[1]) < eps


def simplify_ring(ring, step=2):
    if len(ring) < 20:
        return ring
    out = ring[::step]
    if out[-1] != ring[-1]:
        out.append(ring[-1])
    return out


def prefer_better(existing, new_tags, new_geom):
    """Prefer admin_level 6 raion over city fragment when both match."""
    if existing is None:
        return True
    old_lvl = int(existing.get("_lvl", 99))
    new_lvl = int(new_tags.get("admin_level") or 99)
    # Prefer 6 (district), then 8 (city), avoid tiny 9
    score = {6: 0, 8: 1, 9: 2}.get(new_lvl, 5)
    old_score = {6: 0, 8: 1, 9: 2}.get(old_lvl, 5)
    return score < old_score


def main():
    print("Fetching Overpass…")
    raw = fetch_overpass()
    nodes, ways, rels = build_ways(raw.get("elements", []))
    print(f"nodes={len(nodes)} ways={len(ways)} rels={len(rels)}")

    chosen = {}
    for rel in rels:
        tags = rel.get("tags") or {}
        pid = match_id(tags)
        if not pid:
            continue
        geom = relation_polygons(rel, ways, nodes)
        if not geom:
            print("no geom", tags.get("name"), rel["id"])
            continue
        # light simplify
        if geom["type"] == "Polygon":
            geom["coordinates"] = [simplify_ring(r, 3) for r in geom["coordinates"]]
        elif geom["type"] == "MultiPolygon":
            geom["coordinates"] = [
                [simplify_ring(r, 3) for r in poly] for poly in geom["coordinates"]
            ]

        entry = {
            "_lvl": int(tags.get("admin_level") or 99),
            "_osm": rel["id"],
            "_name": tags.get("name"),
            "geom": geom,
        }
        if prefer_better(chosen.get(pid), tags, geom):
            chosen[pid] = entry
            print(f"  {pid}: {tags.get('name')} (lvl {tags.get('admin_level')})")

    features = []
    for pid, entry in chosen.items():
        color, fill = COLORS.get(pid, ("#3ddc97", "rgba(61,220,151,0.25)"))
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": pid,
                    "title": TITLES.get(pid, entry["_name"]),
                    "color": color,
                    "fill": fill,
                    "osmRelation": entry["_osm"],
                },
                "geometry": entry["geom"],
            }
        )

    missing = [pid for pid, _ in NAME_MAP if pid not in chosen]
    if missing:
        print("MISSING:", missing)

    fc = {"type": "FeatureCollection", "features": features}
    OUT.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT} ({len(features)} features, {OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
