# Project Knowledge Base

> **For agents:** Read this file at the start of every run. Update the relevant section when research is done, decisions are made, or patterns are discovered.
> **For humans:** Living README for the scanning-volunteers feature. Covers architecture, scoring logic, geocoding, and research findings.

---

## Project Overview

Feature branch for Anna's Archive — a volunteer scanning coordination tool. Volunteers fill out a profile (city, country, languages, libraries, travel distance) and get a ranked list of books they're best positioned to scan.

**Stack:** Flask · Python · Jinja2 templates · no database yet (mock data in `scanning_data.py`)

**Key files:**
| File | Purpose |
|---|---|
| `allthethings/page/scanning_helpers.py` | Scoring logic, geocoding, profile parsing, book matching |
| `allthethings/page/scanning_data.py` | Mock book data (~20 books across Europe) |
| `allthethings/page/views.py` | Flask routes |
| `allthethings/page/templates/page/scanning_volunteers.html` | Volunteer profile form + results |
| `requirements.txt` | `flask>=3.0.0`, `geonamescache>=3.0.0`, `langcodes[data]>=3.5.0` |
| `tests/test_scoring.py` | pytest suite — 37 tests for scoring and geocoding |
| `dev-docs/KNOWLEDGE.md` | This file — agent + human reference |
| `dev-docs/DEMANDS.md` | Full feature specification |
| `dev-docs/Todos_tracker.md` | Roadmap and improvement items |

---

## Scoring System (`scanning_helpers.py`)

Weights are centralised in the `WEIGHTS` dict at the top of the file. Core function: `calculate_score(book, profile) -> (int, list[str])` — pure, no side effects.

| Signal | Points | Notes |
|---|---|---|
| `risk_high` | +30 | |
| `risk_medium` | +15 | |
| `risk_low` | +5 | |
| `same_country` | +10 | case-insensitive string match |
| `same_city` | +30 | case-insensitive; sets `city_matched` flag to block travel range double-reward |
| `within_travel_range` | +15 | haversine ≤ `travel_distance_km`; only fires when city didn't already match |
| `same_library` | +40 | strongest signal — volunteer can walk in right now |
| `language_match` | +20 | plain lowercased string match |
| `not_digitized` | +20 | |
| `digitized_penalty` | −50 | book stays in list so the "hide digitized" filter has something to hide |
| `per_request` | +1 per request | reason surfaced only when >10 requests |

`HIGH_PRIORITY_THRESHOLD = 80`

`match_books` returns `[]` when no profile fields are filled in — template shows a prompt instead of a meaningless ranking. The `has_input` guard does **not** count `travel_distance_km` alone, because distance needs a city to compute from.

---

## City Name → Lat/Lon (Geocoding)

**Library:** [`geonamescache`](https://pypi.org/project/geonamescache/) v3.0.1 — fully offline, bundled JSON, no API key needed.

**Current threshold:** `min_city_population=1000` → **161,662 cities**. Changed from the default 15,000 (32k cities) to cover small archive towns. Valid values only: `500`, `1000`, `5000`, `15000` — passing anything else (e.g. 10000) crashes with a missing file error.

> **Updating the data:** `geonamescache` bundles its city data at install time. To refresh: `pip install --upgrade geonamescache`. Raw upstream updates daily at `https://download.geonames.org/export/dump/` — the package author syncs periodically. For finer control (LIBR feature codes, non-Latin scripts) see `dev-docs/Todos_tracker.md` items #5 and #7.

### How city lookup works — step by step

The lookup chain lives in `_get_city_coords(city, country)` in `scanning_helpers.py`. All three helpers are `@functools.cache` decorated so each unique input is resolved once per process.

#### Step 1 — Country name → ISO code (`_country_code`)

```
"Croatia"       → "HR"
"Bosnia"        → "BA"   (substring match: "bosnia" in "bosnia and herzegovina")
"Czech Republic"→ "CZ"   (alias table: GeoNames uses "Czechia", not "Czech Republic")
"Germany"       → "DE"
```

Priority order inside `_country_code`:
1. Check `_COUNTRY_ALIASES` dict — handles names where GeoNames spelling diverges completely (Czech Republic ↔ Czechia, plus common ones like Russia, Vietnam, etc.)
2. Exact match against `gc.get_countries()` name field
3. Substring match — catches short forms ("Bosnia") that are contained in the full official name ("Bosnia and Herzegovina")

If nothing matches, returns `None`; the city lookup then takes the **first** city result regardless of country (best-effort fallback).

#### Step 2 — City name → coordinates (`_get_city_coords`)

**Pass 1 — canonical name via `get_cities_by_name`:**
Looks up the exact city name as stored in GeoNames. Works for the majority of cities where the volunteer's spelling matches the canonical form (Split, Vienna, Prague, etc.). Returns `(lat, lon)` of the first result whose `countrycode` matches the ISO code from Step 1.

`get_cities_by_name` returns `[{'<geonameid>': {city fields}}, ...]` — a list of single-key dicts, each wrapping one city dict. The inner dict has the fields from the `City` TypedDict: `latitude`, `longitude`, `countrycode`, `name`, `alternatenames`, `population`, `timezone`, `admin1code`, `geonameid`.

**Pass 2 — alternate names via `search_cities` (diacritics fallback):**
If Pass 1 found nothing, searches the `alternatenames` list with `contains_search=False` (exact match). This catches cities stored with diacritics where the volunteer typed the ASCII spelling:
- `"Gdansk"` → finds `Gdańsk` (PL) via its alternate name
- `"Krakow"` → finds `Kraków` (PL) via its alternate name

`search_cities` returns plain city dicts (no geonameid wrapper), so iteration is direct.

If both passes fail, returns `None` — the travel range check is silently skipped for that book.

#### Step 3 — Haversine distance (`_haversine_km`)

Standard great-circle formula, Earth radius 6371 km. `dist <= travel_distance_km` triggers the `within_travel_range` score bonus and adds a reason like `"Within your travel range (125 km away)"`.

### Known good cities (tested)

All 20 mock book cities resolve correctly. Sample:

| Volunteer types | Resolved to | Coords |
|---|---|---|
| Split, Croatia | Split | 43.509, 16.439 |
| Gdansk, Poland | Gdańsk | 54.352, 18.649 |
| Krakow, Poland | Kraków | 50.061, 19.937 |
| Sarajevo, Bosnia | Sarajevo | 43.849, 18.356 |
| Prague, Czech Republic | Prague | 50.088, 14.421 |
| Berlin, Germany | Berlin | 52.524, 13.411 |

---

## Language Handling

**Implemented:** BCP47 normalisation via `langcodes[data]>=3.5.0`. Mock book data uses BCP47 codes (`"hr"`, `"de"`, `"pl"`, etc.) matching Anna's Archive's real DB format.

`_norm_lang(s)` in `scanning_helpers.py` normalises any volunteer input to a BCP47 language subtag:
- `standardize_tag` first — handles codes: `"hr"` → `"hr"`, `"hrv"` → `"hr"`, `"pol"` → `"pl"`
- `find()` fallback — handles full names: `"Croatian"` → `"hr"`, `"German"` → `"de"`
- Final fallback: `s.lower()` for unrecognised strings

**Known gap:** the filter sidebar language dropdown currently shows raw codes (`"hr"`, `"de"`). Fix: add `language_display_names(codes) -> dict[str,str]` helper to `scanning_helpers.py`, pass result to template, render as `"Croatian (hr)"`. See Todos #2.

**Anna's Archive real codebase uses:** BCP47 via `get_bcp47_lang_codes()` + `country_lang_mapping` dict that infers language from country. No geographic distance logic exists in their code at all.

---

## Anna's Archive Real Codebase — Research Findings

- Hosted at `https://software.annas-archive.se/AnnaArchivist/annas-archive` (mirror: `github.com/drok/annas-archive`)
- Uses **Elasticsearch** for search/ranking
- Language: `get_bcp47_lang_codes()` normalises any string to BCP47; `combine_bcp47_lang_codes()` merges sources; `country_lang_mapping` infers language from country
- Location: only country-level, used to infer language — **no city-level or distance-based ranking exists**
- No `function_score` / `script_score` / geographic proximity in ES queries
- Our haversine + geonamescache approach is more sophisticated than anything in their codebase

---

## Decisions & Patterns

- **No DB yet** — `MOCK_BOOKS` stands in; swapping to a real query later only changes where it comes from
- **`travel_distance_km` stored as `int | None`** — parsed via `_parse_int()` in `build_profile`; raw string comparison would break the `<=` check
- **Geocoding is cached** — `@functools.cache` on `_gc()`, `_country_code()`, `_get_city_coords()` means each unique city/country pair is resolved once per process, not once per book per request
- Comments explain WHY (non-obvious invariants), not WHAT

---

## Open Items / Ideas

- BCP47 language normalisation (see Anna's Archive pattern above)
- Country → language auto-inference (like `country_lang_mapping`)
- Real DB table to replace `MOCK_BOOKS`
- Add more mock books from underrepresented regions to stress-test scoring
