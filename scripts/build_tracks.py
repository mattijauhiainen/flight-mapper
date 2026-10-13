#!/usr/bin/env python3
"""Turn each city's raw fr24 track dumps in data/ into a GeoJSON the browser can load.

Writes public/tracks/<city>.geojson for every city in CITIES, and
src/cities.json, which the app bundles to list the cities and place them.

Seven things happen here that the raw data needs:
  - ground noise is trimmed (each track starts and ends with minutes of taxiing)
  - longitudes are unwrapped past +-180 so trans-Pacific lines don't whip
    back across the globe at the antimeridian
  - the point count is cut with Douglas-Peucker; at globe zoom the raw 16s
    sampling is far more detail than a pixel can show
  - gaps in receiver coverage, which leave segments of up to thousands of km
    over oceans and the Arctic, are filled with points along the great circle
  - a timestamp is kept for every surviving vertex, so the client can draw each
    path progressively against a clock
  - the destination is named, by matching the last fix against data/airports.csv
  - the flown distance is measured, over the raw fixes rather than the
    simplified ones, so cutting vertices can't shorten the flight
"""
import csv
import json
import glob
import math
import os
import datetime
import zoneinfo

EPS = 0.01        # simplification tolerance in degrees, ~1 km
PRECISION = 4     # ~11 m, plenty for a globe view
# Longest segment left in a path. MapLibre draws a segment as a straight line
# in Mercator, which on the globe bends away from the great circle the aircraft
# flew; the longer the segment and the nearer the pole, the further.
MAX_SEGMENT_KM = 300

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AIRPORTS = os.path.join(ROOT, "data", "airports.csv")
TRACKS_OUT = os.path.join(ROOT, "public", "tracks")
CITIES_OUT = os.path.join(ROOT, "src", "cities.json")

EARTH_KM = 6371.0

# The cities the app can show, in the order the selector lists them. The first
# is the default. `tracks` is the directory under data/ that fetch_fr24.py
# downloaded the departures into.
CITIES = [
    {"id": "hkg", "name": "Hong Kong", "airport": "HKG",
     "time_zone": "Asia/Hong_Kong", "tracks": "fr24-hkg-2026-09-20"},
    {"id": "ord", "name": "Chicago", "airport": "ORD",
     "time_zone": "America/Chicago", "tracks": "fr24-ord-2026-09-20"},
    {"id": "gru", "name": "São Paulo", "airport": "GRU",
     "time_zone": "America/Sao_Paulo", "tracks": "fr24-gru-2026-09-20"},
    {"id": "hel", "name": "Helsinki", "airport": "HEL",
     "time_zone": "Europe/Helsinki", "tracks": "fr24-hel-2026-09-20"},
]


def main():
    airports = load_airports()
    os.makedirs(TRACKS_OUT, exist_ok=True)
    cities = [build_city(city, airports) for city in CITIES]
    with open(CITIES_OUT, "w") as fh:
        json.dump(cities, fh, indent=4, ensure_ascii=False)
        fh.write("\n")


def build_city(city, airports):
    """Writes the city's tracks and returns its entry for src/cities.json."""
    out = os.path.join(TRACKS_OUT, f"{city['id']}.geojson")
    origin = next(a for a in airports if a[0] == city["airport"])

    flights = []
    raw_points = 0
    for path in sorted(glob.glob(os.path.join(ROOT, "data", city["tracks"], "*.json"))):
        flight = json.load(open(path))[0]
        tracks = airborne(flight["tracks"])
        if len(tracks) < 2:
            continue
        raw_points += len(tracks)

        points = unwrap([(p["lon"], p["lat"]) for p in tracks])
        kept = simplify(points, EPS)
        coords, stamps = densify(
            [points[i] for i in kept],
            [epoch(tracks[i]["timestamp"]) for i in kept],
            MAX_SEGMENT_KM,
        )

        # The last raw fix, not the last airborne one: a track that runs to the gate
        # sits on the destination apron, and one that fades out on approach still
        # points at it.
        end = flight["tracks"][-1]
        iata = destination(airports, end["lat"], end["lon"])

        flights.append({
            "id": flight["fr24_id"],
            "callsign": next((p["callsign"] for p in tracks if p["callsign"]), ""),
            "coords": [[round(lon, PRECISION), round(lat, PRECISION)] for lon, lat in coords],
            "stamps": stamps,
            "dest": iata,
            "km": round(sum(haversine(points[i], points[i + 1]) for i in range(len(points) - 1))),
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
            "dest": f["dest"],
            "km": f["km"],
            "times": [round(s - t0) for s in f["stamps"]],
        },
        "geometry": {"type": "LineString", "coordinates": f["coords"]},
    } for f in flights]

    zone = zoneinfo.ZoneInfo(city["time_zone"])
    start = datetime.datetime.fromtimestamp(t0, zone)
    end = datetime.datetime.fromtimestamp(t1, zone)

    with open(out, "w") as fh:
        json.dump({
            "type": "FeatureCollection",
            "epoch": round(t0),
            "span": round(t1 - t0),
            "features": features,
        }, fh, separators=(",", ":"))

    kept = sum(len(f["geometry"]["coordinates"]) for f in features)
    print(f"{city['id']}: {len(features)} flights, {raw_points} -> {kept} points ({kept / raw_points:.1%})")
    print(f"timeline {start:%Y-%m-%d %H:%M} -> {end:%Y-%m-%d %H:%M} {zone_name(start)} "
          f"({(t1 - t0) / 3600:.1f} h)")
    print(f"{os.path.getsize(out) / 1e6:.2f} MB")

    return {
        "id": city["id"],
        "name": city["name"],
        "airport": city["airport"],
        "origin": [origin[2], origin[1]],
        "timeZone": city["time_zone"],
        "timeZoneName": zone_name(start),
        "firstDepartureMs": round(t0) * 1000,
    }


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


def densify(points, stamps, max_km):
    """Split every segment longer than max_km into equal parts along the great
    circle, timing each new point in proportion to its distance along the
    segment. Longitudes stay unwrapped."""
    out_points = [points[0]]
    out_stamps = [stamps[0]]
    for i in range(1, len(points)):
        a, b = points[i - 1], points[i]
        parts = math.ceil(haversine(a, b) / max_km)
        for part in range(1, parts):
            fraction = part / parts
            lon, lat = great_circle_point(a, b, fraction)
            lon += 360 * round((out_points[-1][0] - lon) / 360)
            out_points.append((lon, lat))
            out_stamps.append(stamps[i - 1] + (stamps[i] - stamps[i - 1]) * fraction)
        out_points.append(b)
        out_stamps.append(stamps[i])
    return out_points, out_stamps


def great_circle_point(a, b, fraction):
    """The (lon, lat) `fraction` of the way from a to b along the great circle."""
    va, vb = unit_vector(a), unit_vector(b)
    angle = math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(va, vb)))))
    weight_a = math.sin((1 - fraction) * angle) / math.sin(angle)
    weight_b = math.sin(fraction * angle) / math.sin(angle)
    x, y, z = (weight_a * p + weight_b * q for p, q in zip(va, vb))
    return math.degrees(math.atan2(y, x)), math.degrees(math.atan2(z, math.hypot(x, y)))


def unit_vector(point):
    lon, lat = map(math.radians, point)
    return (math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))


def airborne(tracks):
    """Slice from first to last airborne fix, keeping the run contiguous."""
    idx = [i for i, p in enumerate(tracks) if p["alt"] > 0 and p["gspeed"] > 80]
    if not idx:
        return []
    return tracks[idx[0]:idx[-1] + 1]


def epoch(stamp):
    return datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()


def haversine(a, b):
    """Great-circle kilometres between two (lon, lat) pairs."""
    (lon1, lat1), (lon2, lat2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_KM * math.asin(min(1.0, h ** 0.5))


def load_airports():
    with open(AIRPORTS) as fh:
        return [(r["iata"], float(r["lat"]), float(r["lon"]),
                 r["scheduled"] == "1") for r in csv.DictReader(fh)]


def destination(airports, lat, lon):
    """The IATA code of the airport a track ends at.

    Nearest wins, with one exception: a field closed to scheduled traffic gives
    way to a working one barely further off. That is what separates Sheremetyevo
    from the air base 5 km nearer it, while still calling the flight that landed
    at Phnom Penh's old airport months before its replacement opened by the
    right name.
    """
    ranked = sorted(
        ((haversine((lon, lat), (a[2], a[1])), a) for a in airports),
        key=lambda pair: pair[0],
    )
    best_km, best = ranked[0]
    if not best[3]:
        for km, a in ranked[1:]:
            if km > best_km * 1.5:
                break
            if a[3]:
                return a[0]
    return best[0]


def zone_name(moment):
    """The abbreviation of the moment's time zone, e.g. "HKT" or "CDT", or its
    offset from UTC, e.g. "UTC-3", for zones without one."""
    name = moment.tzname()
    if name[0] not in "+-":
        return name
    hours, minutes = divmod(abs(moment.utcoffset()).seconds // 60, 60)
    return f"UTC{name[0]}{hours}" + (f":{minutes:02}" if minutes else "")


if __name__ == "__main__":
    main()
