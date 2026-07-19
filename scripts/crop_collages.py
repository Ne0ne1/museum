"""Crop decade collages into individual photo panels."""
from __future__ import annotations

import hashlib
from pathlib import Path

from PIL import Image

SRC = Path(r"C:\Users\liquid\.cursor\projects\c-Users-liquid-museum\assets")
OUT = Path(r"C:\Users\liquid\museum\assets\photos")

# filename suffix -> (place_id, panel names in row-major order)
MAPPING = {
    "317256a1-b8f9-4d07-bb69-84cd597121ae.png": (
        "achkhoy-martan",
        ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s"],
    ),
    "05c5b3d1-04f3-43d9-b345-cbb1e7e5c83a.png": (
        "achkhoy-martan",
        ["1950s", "1960s", "1970s", "1980s", "1990s", "2000s"],
    ),
    "c436ab0c-4dca-4c61-a0ec-6e4d15ed0e40.png": (
        "novye-atagi",
        ["1950s", "1960s", "1970s", "1980s", "1990s", "2020s"],
    ),
    "2a3145fa-ae79-41c6-b9b7-5c12c5866f29.png": (
        "shelkovskaya",
        ["1950s", "1960s", "1970s", "1980s", "1990s", "2020s"],
    ),
    "a1897fbf-563d-43d7-b7d9-f6204fd9d705.png": (
        "shelkovskaya",
        ["1950s", "1960s", "1970s", "1980s", "1990s", "2020s"],
    ),
    "5948d17b-0a37-4711-aa69-39453a606bb6.png": (
        "kurchaloy",
        ["1950s", "1960s", "1970s", "1980s", "1990s", "2020s"],
    ),
    "b6886ed1-e08c-4bbc-a911-b8e91993b58f.png": (
        "urus-martan",
        [
            "1950s-street",
            "1950s-monument",
            "1960s-dk",
            "1960s-center",
            "1970s-houses",
            "1980s-bridge",
        ],
    ),
    "9fb899e8-6c60-4cf4-933a-999c4c4732a2.png": (
        "shatoy",
        ["1950s", "1960s", "1970s", "1980s", "1990s", "2020s"],
    ),
    "8d4d78ae-1882-43ba-9361-cc281adc7ef9.png": (
        "chsu-campus",
        ["1950s", "1960s", "1970s", "1980s", "1990s", "2020s"],
    ),
    "0f224f8e-6ddc-4f26-803d-9ae5c8ca89aa.png": (
        "lake-kezenoy",
        ["1950s", "1960s", "1970s", "1980s", "1990s", "2020s"],
    ),
    "9e4a2dfa-3968-455c-8bcd-8ee8f1e571a0.png": (
        "itum-kali",
        ["1950s", "1960s", "1970s", "1980s", "1990s", "2020s"],
    ),
}


def is_white(rgb, thr=245):
    return rgb[0] >= thr and rgb[1] >= thr and rgb[2] >= thr


def row_white_ratio(im, y, thr=245):
    pix = im.load()
    w = im.width
    white = sum(1 for x in range(w) if is_white(pix[x, y], thr))
    return white / w


def col_white_ratio(im, x, y0, y1, thr=245):
    pix = im.load()
    h = max(1, y1 - y0)
    white = sum(1 for y in range(y0, y1) if is_white(pix[x, y], thr))
    return white / h


def find_title_end(im):
    """Title sits on white; photos start when row is no longer mostly white."""
    ratios = [row_white_ratio(im, y, 242) for y in range(min(im.height, int(im.height * 0.28)))]
    # Find the last index in the top band that is still "header-like"
    # Header = white margin + title text; photos usually drop below ~0.45 white
    best = 48
    for y, r in enumerate(ratios):
        if r > 0.62:
            best = y + 1
        elif y > 30 and r < 0.45:
            # entered photo content
            break
    return max(42, min(best, int(im.height * 0.18)))


def refine_near(ratios, target, window, min_len=1, max_len=10, thr=0.82):
    lo = max(0, target - window)
    hi = min(len(ratios), target + window)
    best = None
    x = lo
    while x < hi:
        if ratios[x] >= thr:
            start = x
            while x < hi and ratios[x] >= thr * 0.85:
                x += 1
            length = x - start
            if min_len <= length <= max_len:
                center = start + length // 2
                score = abs(center - target)
                if best is None or score < best[0]:
                    best = (score, center)
        else:
            x += 1
    return best[1] if best else target


def crop_grid(im):
    y0 = find_title_end(im)
    content_h = im.height - y0
    mid_y = y0 + content_h // 2
    g1 = im.width // 3
    g2 = 2 * im.width // 3

    xs = [0, g1, g2, im.width]
    ys = [y0, mid_y, im.height]
    panels = []
    for row in range(2):
        for col in range(3):
            left = xs[col] + (1 if col > 0 else 0)
            right = xs[col + 1] - (1 if col < 2 else 0)
            top = ys[row] + (1 if row > 0 else 0)
            bottom = ys[row + 1] - (1 if row < 1 else 0)
            panels.append(im.crop((left, top, right, bottom)))
    return panels, y0, mid_y, g1, g2


def main():
    seen_places = set()
    for path in sorted(SRC.glob("*.png")):
        meta = None
        for suffix, value in MAPPING.items():
            if path.name.endswith(suffix):
                meta = value
                break
        if meta is None:
            print("UNMAPPED", path.name)
            continue
        place, names = meta
        if place in seen_places:
            print("skip dup", place)
            continue
        seen_places.add(place)

        im = Image.open(path).convert("RGB")
        panels, y0, mid_y, g1, g2 = crop_grid(im)
        dest = OUT / place
        dest.mkdir(parents=True, exist_ok=True)
        print(f"{place}: title_end={y0} mid={mid_y} gutters={g1},{g2} size={im.size}")
        for panel, name in zip(panels, names):
            outp = dest / f"{name}.jpg"
            panel.save(outp, "JPEG", quality=92, optimize=True)
            print(f"  -> {outp.name} {panel.size}")
        panels[-1].save(OUT / f"{place}.jpg", "JPEG", quality=90, optimize=True)

    print("DONE:", sorted(seen_places))


if __name__ == "__main__":
    main()
