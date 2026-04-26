# Project Knowledge Base

Reference this file at the start of every agent run. Update it when research is done, decisions are made, or patterns are discovered.

---

## Project Overview

Feature branch for Anna's Archive — a volunteer scanning coordination tool. Volunteers fill out a profile (city, country, languages, libraries, travel distance) and get a ranked list of books they're best positioned to scan.

**Stack:** Flask · Python · Jinja2 templates · no database yet (mock data in `scanning_data.py`)

**Key files:**
- `allthethings/page/scanning_helpers.py` — scoring logic, profile parsing, book matching
- `allthethings/page/scanning_data.py` — mock book data (16–20 books across Europe)
- `allthethings/page/views.py` — Flask routes
- `allthethings/page/templates/page/scanning_volunteers.html` — volunteer profile form + results

---

## Scoring System (`scanning_helpers.py`)

Weights are centralised in `WEIGHTS` dict at top of file. Pure function `calculate_score(book, profile) -> (score, reasons)`.

| Signal | Points | Notes |
|---|---|---|
| risk_high | +30 | |
| risk_medium | +15 | |
| risk_low | +5 | |
| same_country | +10 | case-insensitive string match |
| same_city | +30 | case-insensitive; sets `city_matched` flag |
| within_travel_range | +15 | haversine distance ≤ `travel_distance_km`; only when city didn't match |
| same_library | +40 | strongest signal |
| language_match | +20 | plain string match against volunteer's language list |
| not_digitized | +20 | |
| digitized_penalty | −50 | book stays in list for filter UX |
| per_request | +1 per request | reason shown only if >10 requests |

`HIGH_PRIORITY_THRESHOLD = 80`

---

## Geographic Distance

`CITY_COORDS` dict: `(city.lower(), country.lower()) -> (lat, lon)` — covers all 19 cities in mock data plus common spelling variants (gdańsk/gdansk, krakow/cracow, belgrade).

`_haversine_km(lat1, lon1, lat2, lon2)` uses Earth radius 6371 km.

Travel range scoring is skipped silently if either city is missing from `CITY_COORDS`.

`travel_distance_km` is parsed as `int | None` via `_parse_int()` in `build_profile`.

---

## Language Handling

Current: plain lowercased string match. `profile["languages"]` is a list parsed from comma-separated form input.

**Anna's Archive real codebase uses:** BCP47 language codes via the `langcodes` Python library + a `country_lang_mapping` dict that infers language from country (e.g. Croatia → Croatian). No geographic distance logic exists in their code at all.

**Potential improvement:** adopt BCP47 normalization so "Croatian" / "HR" / "hrv" all resolve to the same code, and add country→language inference.

---

## Anna's Archive Real Codebase — Research Findings

- Hosted at `https://software.annas-archive.se/AnnaArchivist/annas-archive` (mirror: `github.com/drok/annas-archive`)
- Uses **Elasticsearch** for search/ranking
- Language handling: `get_bcp47_lang_codes()` normalises any language string to BCP47; `combine_bcp47_lang_codes()` merges multiple sources
- Location: `country_lang_mapping` dict (~100+ countries → primary language) used for metadata enrichment only — no city-level or distance-based ranking
- No `function_score` / `script_score` / geographic proximity in their search queries
- ES timeout constants: `ES_TIMEOUT_PRIMARY = "400ms"`, `ES_TIMEOUT = "100ms"`

---

## Decisions & Patterns

- **No DB yet** — `MOCK_BOOKS` in `scanning_data.py` stands in; swapping to a real query later only changes where `MOCK_BOOKS` comes from
- **`match_books` returns `[]` when no profile input** — template shows a prompt instead of a meaningless ranking
- **`has_input` check does NOT include `travel_distance_km`** — travel range alone is not enough to show results (needs a city to compute from)
- Comments explain WHY (non-obvious invariants), not WHAT

---

## Open Items / Ideas

- BCP47 language normalization (see Anna's Archive pattern above)
- Country → language auto-inference (like `country_lang_mapping`)
- Add more cities to `CITY_COORDS` as mock data expands
- Real DB table to replace `MOCK_BOOKS`
