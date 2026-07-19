"""Patch districts-geo.json with Argun + Grozny city polygons from OSM."""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(r"C:\Users\liquid\museum")
GEO = ROOT / "data" / "districts-geo.json"

# Known OSM relation ids
PATCH = {
    "argun": {
        "osm": 1749726,  # городской округ город Аргун
        "title": "Аргун",
        "color": "#5b9cff",
        "fill": "rgba(91, 156, 255, 0.26)",
    },
    "grozny": {
        "osm": 1957640,  # городской округ Грозный (not rural Грозненский район)
        "title": "Грозный",
        "color": "#3ddc97",
        "fill": "rgba(61, 220, 151, 0.28)",
    },
}


def fetch_poly(rel_id: int):
    url = f"https://polygons.openstreetmap.fr/get_geojson.py?id={rel_id}&params=0"
    req = urllib.request.Request(url, headers={"User-Agent": "museum-stand/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        text = resp.read().decode("utf-8")
    if not text or text.strip() == "None":
        raise RuntimeError(f"No polygon for {rel_id}")
    data = json.loads(text)
    # Response is GeometryCollection or MultiPolygon
    if data.get("type") == "GeometryCollection":
        geoms = data.get("geometries") or []
        if not geoms:
            raise RuntimeError("empty GeometryCollection")
        # Prefer MultiPolygon / Polygon
        for g in geoms:
            if g["type"] in ("Polygon", "MultiPolygon"):
                return g
        return geoms[0]
    return data


def simplify(geom, step=2):
    def simp_ring(ring):
        if len(ring) < 30:
            return ring
        out = ring[::step]
        if out[-1] != ring[-1]:
            out.append(ring[-1])
        return out

    if geom["type"] == "Polygon":
        return {"type": "Polygon", "coordinates": [simp_ring(r) for r in geom["coordinates"]]}
    if geom["type"] == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [[simp_ring(r) for r in poly] for poly in geom["coordinates"]],
        }
    return geom


def main():
    fc = json.loads(GEO.read_text(encoding="utf-8"))
    by_id = {f["properties"]["id"]: f for f in fc["features"]}

    for pid, meta in PATCH.items():
        print(f"Fetching {pid} osm={meta['osm']}…")
        geom = simplify(fetch_poly(meta["osm"]), step=2)
        feature = {
            "type": "Feature",
            "properties": {
                "id": pid,
                "title": meta["title"],
                "color": meta["color"],
                "fill": meta["fill"],
                "osmRelation": meta["osm"],
            },
            "geometry": geom,
        }
        by_id[pid] = feature
        print(f"  ok type={geom['type']}")

    fc["features"] = list(by_id.values())
    GEO.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(fc['features'])} features → {GEO} ({GEO.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
