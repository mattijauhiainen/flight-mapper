#!/usr/bin/env python3
"""Turn the raw fr24 track dumps in data/ into one GeoJSON the browser can load.

Four things happen here that the raw data needs:
  - ground noise is trimmed (each track starts and ends with minutes of taxiing)
  - longitudes are unwrapped past +-180 so trans-Pacific lines don't whip
    back across the globe at the antimeridian
  - the point count is cut with Douglas-Peucker; at globe zoom the raw 16s
    sampling is far more detail than a pixel can show
  - a timestamp is kept for every surviving vertex, so the client can draw each
    path progressively against a clock
"""
import json
import glob
import os
import datetime

EPS = 0.01        # simplification tolerance in degrees, ~1 km
PRECISION = 4     # ~11 m, plenty for a globe view

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "public", "tracks.geojson")


def unwrap(points):
    """Make longitudes continuous so a track can run past 180 into 181, 182..."""
    out = []
    offset = 0.0
    prev = None
    for lon, lat in points:
        if prev is not None:
            if lon - prev > 180:
                offset -= 360
            elif prev - lon > 180:
                offset += 360
        prev = lon
        out.append((lon + offset, lat))
    return out


def simplify(points, eps):
    """Douglas-Peucker returning kept indices; iterative so long tracks can't
    blow the stack."""
    if len(points) < 3:
        return list(range(len(points)))
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        ax, ay = points[lo]
        bx, by = points[hi]
        dx, dy = bx - ax, by - ay
        norm = (dx * dx + dy * dy) ** 0.5
        worst, worst_i = 0.0, -1
        for i in range(lo + 1, hi):
            px, py = points[i]
            if norm == 0:
                d = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > worst:
                worst, worst_i = d, i
        if worst > eps:
            keep[worst_i] = True
            stack.append((lo, worst_i))
            stack.append((worst_i, hi))
    return [i for i, k in enumerate(keep) if k]


def airborne(tracks):
    """Slice from first to last airborne fix, keeping the run contiguous."""
    idx = [i for i, p in enumerate(tracks) if p["alt"] > 0 and p["gspeed"] > 80]
    if not idx:
        return []
    return tracks[idx[0]:idx[-1] + 1]


def epoch(stamp):
    return datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()


flights = []
raw_points = 0
for path in sorted(glob.glob(os.path.join(SRC, "*.json"))):
    flight = json.load(open(path))[0]
    tracks = airborne(flight["tracks"])
    if len(tracks) < 2:
        continue
    raw_points += len(tracks)

    points = unwrap([(p["lon"], p["lat"]) for p in tracks])
    kept = simplify(points, EPS)
    flights.append({
        "id": flight["fr24_id"],
        "callsign": next((p["callsign"] for p in tracks if p["callsign"]), ""),
        "coords": [[round(points[i][0], PRECISION), round(points[i][1], PRECISION)] for i in kept],
        "stamps": [epoch(tracks[i]["timestamp"]) for i in kept],
        "maxalt": max(p["alt"] for p in tracks),
    })

# Times ship as whole seconds from the first departure, which keeps them short
# and lets the client treat the animation as one continuous timeline.
t0 = min(f["stamps"][0] for f in flights)
t1 = max(f["stamps"][-1] for f in flights)
flights.sort(key=lambda f: f["stamps"][0])

features = [{
    "type": "Feature",
    "properties": {
        "id": f["id"],
        "callsign": f["callsign"],
        "maxalt": f["maxalt"],
        "times": [round(s - t0) for s in f["stamps"]],
    },
    "geometry": {"type": "LineString", "coordinates": f["coords"]},
} for f in flights]

with open(OUT, "w") as fh:
    json.dump({
        "type": "FeatureCollection",
        "epoch": round(t0),
        "span": round(t1 - t0),
        "features": features,
    }, fh, separators=(",", ":"))

kept = sum(len(f["geometry"]["coordinates"]) for f in features)
hk = datetime.timezone(datetime.timedelta(hours=8))
print(f"{len(features)} flights, {raw_points} -> {kept} points ({kept / raw_points:.1%})")
print(f"timeline {datetime.datetime.fromtimestamp(t0, hk):%Y-%m-%d %H:%M} -> "
      f"{datetime.datetime.fromtimestamp(t1, hk):%Y-%m-%d %H:%M} HKT "
      f"({(t1 - t0) / 3600:.1f} h)")
print(f"{os.path.getsize(OUT) / 1e6:.2f} MB")
