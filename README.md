# Flight Mapper

An animated globe of one day of departures from Hong Kong International Airport.

The project is hosted at [https://flights-24.netlify.app](https://flights-24.netlify.app)

## What is this?

Every passenger flight that left HKG on 20 September 2026 is drawn on a globe, flying against a Hong Kong clock. The day side of the globe is lit as the clock runs. Hover a path to identify the flight, click it to compare the flown route against the great circle.

## How is it built?

Flight tracks are downloaded from the [Flightradar24 API](https://fr24api.flightradar24.com) by a Python script, then trimmed, simplified and folded into a single GeoJSON file. The globe is rendered with [MapLibre GL](https://maplibre.org/) and the app is written in TypeScript and built with Vite.

## Usage

Fetch the departures for a day (requires a Flightradar24 API token):

```bash
FR24TOKEN=... scripts/fetch_fr24.py --airport HKG --since 2026-09-19T16:00Z \
    --until 2026-09-20T16:00Z --categories P --out data/fr24-hkg-2026-09-20
```

Build `public/tracks.geojson` from the downloaded tracks:

```bash
scripts/build_tracks.py
```

Run the app:

```bash
npm install
npm run dev
```

## Why did I build this?

Just for fun.
