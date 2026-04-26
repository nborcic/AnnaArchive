# Demands & Requirements

Full specification for the scanning volunteers feature. Covers what it must do, how it must be built, and how it must connect to the Anna's Archive codebase. Written so a developer starting cold can understand every decision.

---

## 1. What This Feature Is

Anna's Archive maintains a queue of books that community members have requested to be scanned. These books sit in physical libraries across the world. Volunteers with scanner access need a way to find out which books in the queue they are best positioned to scan.

This feature is a **ranked matching page**: a volunteer fills in a profile (location, languages, library access, travel range, scanner hardware) and receives a scored, filterable list of books ordered by how well each book matches their specific situation.

**The core problem it solves:** Without this, a volunteer in Split, Croatia who has access to the University Library Split and reads Croatian has no way to find the 3 books in the queue that are sitting in that exact library. They would have to scroll through the entire queue manually.

---

## 2. Anna's Archive Integration Requirements

### 2.1 Where this code lives

This feature is a **blueprint addition** to the existing `allthethings/page/` module in Anna's Archive's Flask application. It is not a standalone app — in the real repo:

- `views.py` already exists and defines a `page = Blueprint("page", __name__)` — this feature adds two functions to it
- The template extends `layouts/index.html` which is the site's shared base layout
- Static assets (Tailwind, Anna's brand colours) are inherited from the site

**Do not** redefine the Blueprint or base layout when merging. The merge instructions are preserved in the original `views.py` comments (now removed in standalone mode).

### 2.2 URL

```
GET /scanning-volunteers
```

All profile data travels as **query string parameters**, not POST body. This makes results bookmarkable and shareable. Example:

```
/scanning-volunteers?country=Croatia&city=Split&languages=Croatian%2CEnglish&travel_distance_km=100
```

### 2.3 No caching

Do **not** add `@cache.cached()` to the view. Query params are per-volunteer — caching would serve one person's ranked results to a different volunteer. The real Anna's Archive uses Redis-backed Flask-Caching; that decorator must be intentionally omitted here.

### 2.4 Anna's Archive coding conventions

- Flask blueprints, Jinja2 templates, no JavaScript framework
- Tailwind CSS via CDN in standalone mode; in the real repo it is compiled
- Brand colours: `#4361ee` (blue/action), `#2a9d8f` (teal/success), `#e63946` (red/high risk), `#f4a261` (orange/medium risk)
- Python 3.12+, type hints throughout
- Pure functions preferred — no side effects in scoring logic
- `@functools.cache` for expensive repeated lookups (geocoding)

---

## 3. File Structure

```
feature_for_scanning_volunteers_anna/
├── app.py                              # Standalone Flask entry point
├── requirements.txt                    # flask, geonamescache, langcodes
├── dev-docs/
│   ├── KNOWLEDGE.md                    # Living reference for agents + humans
│   ├── DEMANDS.md                      # This file
│   └── Todos_tracker.md         # Roadmap and improvement items
├── tests/
│   └── test_scoring.py                 # pytest suite for scoring logic
└── allthethings/
    └── page/
        ├── scanning_data.py            # Mock book data (DB stand-in)
        ├── scanning_helpers.py         # All scoring, geocoding, profile logic
        ├── views.py                    # Flask route + filter logic
        └── templates/
            ├── layouts/
            │   └── index.html          # Base layout (standalone only)
            └── page/
                └── scanning_volunteers.html  # The volunteer page template
```

### File responsibilities — strict separation

| File | Owns | Must NOT contain |
|---|---|---|
| `scanning_data.py` | Mock book records | Routing, scoring, templates |
| `scanning_helpers.py` | Scoring, geocoding, profile parsing | Flask imports, request handling |
| `views.py` | Route handler, filter application | Scoring logic, geocoding |
| `scanning_volunteers.html` | Rendering, JS watch feature | Business logic |

This separation means the DB swap (replacing `MOCK_BOOKS` with a real query) only touches `scanning_data.py`. The scoring swap (changing weights or signals) only touches `scanning_helpers.py`. Nothing else changes.

---

## 4. Data Model

### 4.1 Book record

Each book in the queue must have these fields. This is the schema that `scanning_helpers.py` and the template depend on:

```python
{
    "id":            str,    # unique identifier
    "title":         str,
    "author":        str,
    "language":      str,    # e.g. "Croatian", "German" — plain name, not ISO code
    "country":       str,    # e.g. "Croatia"
    "city":          str,    # e.g. "Split"
    "library":       str,    # e.g. "University Library Split"
    "request_count": int,    # number of community requests for this book
    "risk_level":    str,    # "high" | "medium" | "low"
    "is_digitized":  bool,   # True if already scanned
}
```

When the real DB table is created it must produce rows with exactly these field names. Adding extra fields is fine; removing or renaming any of the above breaks the scoring and template.

### 4.2 Volunteer profile

Parsed from query string by `build_profile(request.args)`:

```python
{
    "country":            str,        # free text, e.g. "Croatia"
    "city":               str,        # free text, e.g. "Split"
    "languages":          list[str],  # parsed from comma-separated input
    "libraries":          list[str],  # parsed from comma-separated input
    "scanner_type":       str,        # "phone"|"flatbed"|"overhead"|"dslr"|"other"|""
    "travel_distance_km": int | None, # parsed as integer, None if blank
    "notes":              str,        # free text, not used in scoring
}
```

`travel_distance_km` must be stored as `int | None`, not a raw string. The haversine comparison `dist <= travel_km` silently breaks if it is a string.

---

## 5. Scoring System

All scoring lives in `calculate_score(book, profile) -> (int, list[str])` in `scanning_helpers.py`. It is a **pure function** — same inputs always produce the same output. No Flask context, no globals mutated at call time.

### 5.1 Weights

Centralised in the `WEIGHTS` dict at the top of `scanning_helpers.py`. Tuning the ranking never requires touching logic code — only this dict.

| Key | Points | Rationale |
|---|---|---|
| `risk_high` | +30 | Book may be lost soon — highest urgency |
| `risk_medium` | +15 | Moderate urgency |
| `risk_low` | +5 | Always adds something; low risk is still worth doing |
| `same_country` | +10 | Weaker proximity signal |
| `same_city` | +30 | Volunteer is already nearby — strong signal |
| `within_travel_range` | +15 | Reachable but not same city; only fires when city didn't match |
| `same_library` | +40 | Strongest signal — volunteer can walk in right now |
| `language_match` | +20 | Can verify OCR quality and catch errors |
| `not_digitized` | +20 | Book still needs doing |
| `digitized_penalty` | −50 | Sink to bottom; stays in list for filter UX |
| `per_request` | +1 per request | Community demand float; reason shown only if >10 |

`HIGH_PRIORITY_THRESHOLD = 80` — used by the "only high priority" filter.

### 5.2 Scoring rules

- **City match** sets a `city_matched` flag. If the city matched, the `within_travel_range` block is **skipped** entirely — do not double-reward proximity.
- **Travel range** only fires if `travel_distance_km` is set AND `city_matched` is False AND both cities are resolvable to coordinates.
- **Language match** is plain lowercased string comparison. Future improvement: BCP47 normalisation (see dev-docs/Todos_tracker.md).
- **Library match** is case-insensitive. "University Library Split" and "university library split" must match.
- `match_books` returns `[]` when no profile field is filled in. The template shows a prompt instead of a meaningless all-zero ranking.

### 5.3 Reasons list

Each score comes with a human-readable `match_reasons` list that explains why that book ranked where it did. These are displayed in the template as "Why this book:" bullets. Every scoring signal that fires must append a reason string. Low risk does not append a reason — it is not surprising enough to surface.

---

## 6. Geocoding

### 6.1 Library

`geonamescache` — offline, bundled JSON, ~25 000 cities, no API key, no HTTP calls. Install: `pip install geonamescache`. Update data: `pip install --upgrade geonamescache`.

### 6.2 Lookup chain

`_get_city_coords(city, country) -> (lat, lon) | None`:

1. `_country_code(country)` — maps country name to ISO 3166-1 alpha-2. Checks `_COUNTRY_ALIASES` first (handles "Czech Republic" → CZ, "Russia" → RU, etc.), then exact match, then substring match (handles "Bosnia" → "Bosnia and Herzegovina").
2. `get_cities_by_name(city)` — exact canonical name match. Returns `[{'<geonameid>': {city fields}}, ...]` — note the geonameid wrapper dict.
3. `search_cities(city, case_sensitive=False, contains_search=False)` — fallback for diacritic cities. "Gdansk" finds "Gdańsk", "Krakow" finds "Kraków" via their alternate names list.
4. Returns `None` silently if city is not found — travel range check is skipped.

All three lookup functions are `@functools.cache` decorated — each unique city/country pair resolves once per process lifetime.

### 6.3 Distance

Haversine formula, Earth radius 6371 km. `_haversine_km(lat1, lon1, lat2, lon2) -> float`.

### 6.4 What geonamescache does NOT have

- Feature codes (LIBR, UNIV, etc.) — it only knows populated places, not building types
- Population threshold below 500 — small villages may not resolve
- Full alternate names in non-Latin scripts (Cyrillic, Arabic, etc.)

See TODOS.md for the plan to address these with the raw GeoNames dump.

---

## 7. Template Requirements

### 7.1 Form

- Method: `GET`, action: `/scanning-volunteers`
- Profile fields persist across filter changes via hidden inputs in the filter form
- All inputs must re-populate from `profile` on page load
- Languages and libraries are comma-separated text inputs; the Python side splits them

### 7.2 Results display

- Only shown when at least one of `profile.country`, `profile.city`, or `profile.languages` is set
- Each book card shows: score badge, risk level badge, title, author, library, location, language, request count, match reasons list, Watch button
- Risk level badge colour: `#e63946` high, `#f4a261` medium, `#2a9d8f` low — applied as left border and text
- Already-digitized books show an "Already digitized" badge but remain in the list unless "Hide already digitized" filter is active

### 7.3 Filter sidebar

Filters are a separate GET form that carries all profile values as hidden fields. Applying a filter must not wipe the volunteer's profile. Filters:

- Language dropdown (populated from `all_languages`)
- Risk level dropdown (high/medium/low)
- Only high priority checkbox (score ≥ 80)
- Only same country checkbox
- Only same city checkbox
- Hide already digitized checkbox

Filter state persists by reading `active_filters` from the template context. "Clear filters" link resets filters while keeping the profile.

### 7.4 Watched books (client-side)

Implemented entirely in vanilla JS, no server involvement. Uses `localStorage` key `svm_watched` to store a set of book IDs. The watched panel slides in from the right. Watch state survives page reloads and filter changes. No backend persistence required.

---

## 8. View Logic

`scanning_volunteers_page()` in `views.py`:

1. Parse profile from `request.args` via `build_profile`
2. Score all books via `match_books(MOCK_BOOKS, profile)` — returns sorted list
3. Build `active_filters` dict from `request.args`
4. Apply filters via `_scanning_apply_filters(matches, active_filters, profile)`
5. Compute `total_before_filter` from the unfiltered scored list (for the "Showing X of Y" counter)
6. Render template with: `profile`, `matches`, `all_languages`, `active_filters`, `total_before_filter`

`_scanning_apply_filters` applies each active filter in sequence. Order does not matter since all filters are independent ANDs.

---

## 9. Standalone vs. Real Repo

This branch runs as a standalone Flask app (`python app.py`). When merging into the real Anna's Archive repo:

| Standalone | Real repo |
|---|---|
| `page = Blueprint(...)` defined in `views.py` | Already defined — remove this line |
| `layouts/index.html` base template | Already exists — remove the standalone one |
| `from flask import Blueprint, render_template, request` at top of views.py | Some of these already imported — deduplicate |
| `app.py` entry point | Not needed — Anna's Archive has its own `create_app()` |
| `geonamescache>=3.0.0` in requirements.txt | Add to Anna's Archive's requirements |
| `langcodes[data]>=3.5.0` in requirements.txt | Add to Anna's Archive's requirements |
| `scanning_data.py` with `MOCK_BOOKS` | Include in diff as working example data. Once the real DB query is wired in `views.py` (replace the two `MOCK_BOOKS` references with your query), delete this file. Each record shows the exact field names and types the scoring layer expects. |

---

## 10. What Must Not Change

These are invariants. Breaking them breaks the feature silently or visibly:

- `build_profile` must return `travel_distance_km` as `int | None`, never a string
- `calculate_score` must remain a pure function — no Flask context access inside it
- `city_matched` flag must block `within_travel_range` from firing when it is True
- `match_books` must return `[]` on empty profile — not a zero-scored list
- Filter form must carry all profile values as hidden fields — or profile is lost on filter apply
- Book dict field names (`id`, `title`, `language`, `country`, `city`, `library`, `request_count`, `risk_level`, `is_digitized`) are the contract between the DB and the scoring/template layers — do not rename
