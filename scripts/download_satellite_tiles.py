"""Download Esri World Imagery tiles for Chechnya into vendor/tiles/satellite."""
from __future__ import annotations

import math
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(r"C:\Users\liquid\museum")
OUT = ROOT / "vendor" / "tiles" / "satellite"

# Chechnya bbox (pad a bit for map edges)
LAT_MIN, LAT_MAX = 42.40, 44.05
LON_MIN, LON_MAX = 44.80, 46.75
Z_MIN, Z_MAX = 8, 13

# Esri World Imagery — {z}/{y}/{x}
URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

UA = "museum-stand/1.0 (offline demo tiles; local museum exhibit)"


def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0**zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile


def tile_range(z):
    x0, y1 = deg2num(LAT_MIN, LON_MIN, z)  # SW
    x1, y0 = deg2num(LAT_MAX, LON_MAX, z)  # NE
    return range(min(x0, x1), max(x0, x1) + 1), range(min(y0, y1), max(y0, y1) + 1)


def download_one(z, x, y):
    dest = OUT / str(z) / str(x) / f"{y}.jpg"
    if dest.exists() and dest.stat().st_size > 500:
        return "skip", dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = URL.format(z=z, y=y, x=x)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        if len(data) < 200:
            return "empty", dest
        dest.write_bytes(data)
        return "ok", dest
    except Exception as e:
        return f"err:{e}", dest


def main():
    jobs = []
    for z in range(Z_MIN, Z_MAX + 1):
        xs, ys = tile_range(z)
        for x in xs:
            for y in ys:
                jobs.append((z, x, y))
    print(f"Tiles to fetch: {len(jobs)} (z{Z_MIN}-{Z_MAX})")
    OUT.mkdir(parents=True, exist_ok=True)

    done = skip = err = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(download_one, z, x, y): (z, x, y) for z, x, y in jobs}
        for i, fut in enumerate(as_completed(futs), 1):
            status, _ = fut.result()
            if status == "ok":
                done += 1
            elif status == "skip":
                skip += 1
            else:
                err += 1
            if i % 50 == 0 or i == len(jobs):
                elapsed = time.time() - t0
                print(f"  {i}/{len(jobs)} ok={done} skip={skip} err={err} ({elapsed:.0f}s)")

    # marker file for app
    (OUT / "READY.txt").write_text(
        f"Esri World Imagery z{Z_MIN}-{Z_MAX}\nbbox={LAT_MIN},{LON_MIN},{LAT_MAX},{LON_MAX}\n",
        encoding="utf-8",
    )
    size_mb = sum(p.stat().st_size for p in OUT.rglob("*.jpg")) / (1024 * 1024)
    print(f"Done. Local tiles ~{size_mb:.1f} MB in {OUT}")


if __name__ == "__main__":
    main()
