#!/usr/bin/env python3
"""Download one airport's departures from the Flightradar24 API.

Lists the flights, saves that list as summary.jsonl in the output
directory (one flight per line, so build_tracks.py's *.json glob skips it;
reruns reuse it instead of listing again) and downloads each flight's track into the output directory as <fr24_id>.json, in
the shape build_tracks.py reads. Tracks already on disk are not downloaded again.

    FR24TOKEN=... fetch_fr24.py --airport HKG --since 2026-10-01T16:00Z \
        --until 2026-10-02T16:00Z --categories P --out data/hkg-2026-10-02

Endpoints, parameters and headers follow the official SDK,
https://github.com/Flightradar24/fr24api-sdk-python
"""
import argparse
import concurrent.futures
import datetime
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = "https://fr24api.flightradar24.com"
USER_AGENT = "vectorglobe-fetch-fr24/1.0"
SUMMARY_LIMIT = 20000
RETRIES = 5
# Waited after a 429 when the response has no Retry-After header.
DEFAULT_RETRY_SECONDS = 60
REQUEST_TIMEOUT_SECONDS = 60
# Requests in flight at once; responses are slow enough that one at a time
# stays well under the rate limit.
PARALLEL_REQUESTS = 4


def main():
    args = parse_args()
    token = os.environ.get("FR24TOKEN")
    if not token:
        raise SystemExit("set FR24TOKEN")
    api = Api(token, args.per_minute)

    filters = {
        "flight_datetime_from": api_time(args.since),
        "flight_datetime_to": api_time(args.until),
        "airports": f"outbound:{args.airport}",
    }
    if args.categories:
        filters["categories"] = args.categories

    summary = load_or_list_flights(api, filters, args.out)
    # The API sends flight_ended as a boolean or as the string "true"/"false".
    ended = [f for f in summary if str(f.get("flight_ended")).lower() == "true"]
    print(f"{len(summary)} flights listed, {len(ended)} ended")

    missing = [f for f in ended if not os.path.exists(track_path(args.out, f["fr24_id"]))]
    print(f"{len(ended) - len(missing)} tracks already on disk, downloading {len(missing)}")
    with concurrent.futures.ThreadPoolExecutor(PARALLEL_REQUESTS) as pool:
        downloads = pool.map(lambda flight: download_track(api, flight, args.out), missing)
        for number, flight in enumerate(downloads, 1):
            print(f"{number}/{len(missing)} {flight['fr24_id']} {flight.get('callsign') or ''}", flush=True)

    for row in api.get("/api/usage", {"period": "24h"})["data"]:
        print(f"usage 24h: {row['endpoint']} {row['request_count']} requests, {row['credits']} credits")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--airport", required=True, help="IATA or ICAO code")
    parser.add_argument("--since", required=True, help="earliest departure, ISO 8601 UTC")
    parser.add_argument("--until", required=True, help="latest departure, ISO 8601 UTC")
    parser.add_argument("--categories", help="comma-separated FR24 categories, e.g. P for passenger")
    parser.add_argument("--out", required=True, help="directory for the per-flight JSON files")
    parser.add_argument("--per-minute", type=int, default=10, help="request rate limit of the plan")
    return parser.parse_args()


def load_or_list_flights(api, filters, out):
    """The flight list from summary.jsonl, or from the API when there is none yet."""
    summary_path = os.path.join(out, "summary.jsonl")
    if os.path.exists(summary_path):
        with open(summary_path) as fh:
            return [json.loads(line) for line in fh]

    summary = list_flights(api, filters)
    os.makedirs(out, exist_ok=True)
    with open(summary_path, "w") as fh:
        fh.writelines(json.dumps(flight) + "\n" for flight in summary)
    return summary


def list_flights(api, filters):
    """All flights first seen in the window, paged by moving the window's start
    to the last first_seen of each page, since some plans cap a response's rows."""
    flights = {}
    since = filters["flight_datetime_from"]
    while True:
        page = api.get("/api/flight-summary/light", {**filters, "flight_datetime_from": since, "limit": SUMMARY_LIMIT, "sort": "asc"})["data"]
        new = [f for f in page if f["fr24_id"] not in flights]
        flights.update((f["fr24_id"], f) for f in new)
        print(f"listed {len(flights)} flights", flush=True)
        if not new:
            return list(flights.values())
        since = api_time(max(f["first_seen"] for f in page))


def download_track(api, flight, out):
    tracks = api.get("/api/flight-tracks", {"flight_id": flight["fr24_id"]})
    with open(track_path(out, flight["fr24_id"]), "w") as fh:
        json.dump(tracks, fh)
    return flight


def api_time(stamp):
    """ISO 8601 to the API's naive UTC 'YYYY-MM-DD HH:MM:SS'."""
    moment = datetime.datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if moment.tzinfo is not None:
        moment = moment.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return moment.strftime("%Y-%m-%d %H:%M:%S")


def track_path(out, fr24_id):
    return os.path.join(out, f"{fr24_id}.json")


class Api:
    """GET requests to the FR24 API, spaced to the plan's rate limit and
    retried on 429."""

    def __init__(self, token, per_minute):
        self.headers = {
            "Accept": "application/json",
            "Accept-Version": "v1",
            "Authorization": f"Bearer {token}",
            # Cloudflare in front of the API rejects urllib's default User-Agent.
            "User-Agent": USER_AGENT,
        }
        self.interval_seconds = 60 / per_minute
        self.last_request = 0.0
        self.slot_lock = threading.Lock()

    def get(self, path, params):
        url = f"{BASE_URL}{path}?{urllib.parse.urlencode(params)}"
        for _ in range(RETRIES):
            self.wait_for_slot()
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=self.headers), timeout=REQUEST_TIMEOUT_SECONDS) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                body = error.read().decode(errors="replace")
                if error.code != 429 and error.code < 500:
                    sys.exit(f"{error.code} {error.reason} for {url}\n{body}")
                retry_seconds = float(error.headers.get("Retry-After") or DEFAULT_RETRY_SECONDS)
                print(f"{error.code}, waiting {retry_seconds:.0f} s", flush=True)
                time.sleep(retry_seconds)
            except (TimeoutError, urllib.error.URLError) as error:
                print(f"{error}, retrying", flush=True)
        sys.exit(f"gave up after {RETRIES} tries: {url}")

    def wait_for_slot(self):
        with self.slot_lock:
            slot = max(time.monotonic(), self.last_request + self.interval_seconds)
            self.last_request = slot
        time.sleep(max(0.0, slot - time.monotonic()))


if __name__ == "__main__":
    main()
