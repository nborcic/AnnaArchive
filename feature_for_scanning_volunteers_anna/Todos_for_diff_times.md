# TODO / Roadmap

Ordered roughly by impact. Items marked **[separate project]** are substantial enough to live in their own repo or package.

---

## 1. GeoNames raw data — library-level coordinates `[separate project]`

**Problem today:** distance is computed city-centroid to city-centroid. A volunteer in Split gets the same distance to every book in Split regardless of which end of the city the library is on. More importantly, a book at a library 2 km outside the city boundary gets zero travel-range credit even though it's reachable.

**What to build:**
1. Download raw GeoNames dumps from `https://download.geonames.org/export/dump/`
   - `allCountries.zip` — full world dataset (updated daily)
   - Or per-country files (`HR.zip`, `AT.zip`, `BA.zip`, etc.) for a lighter starting point
2. Filter rows to feature code `LIBR` — these are actual library building coordinates, not city centroids
3. Also keep `UNIV` (university), `SCH` (school), `MUS` (museum) — many scanning targets are held in these
4. Build a pre-processed `libraries.json` or SQLite that maps `(library name, city, country) → (lat, lon)`
5. Ship as a small bundled data file Anna's Archive can import directly

**Why this matters:** right now `_get_city_coords` returns the city centroid. With LIBR entries you'd compute volunteer-location → actual library building, which is the meaningful distance for a scanning trip.

**GeoNames feature codes relevant to this project:**
| Code | Meaning |
|---|---|
| `PPL` | populated place (city / town / village) — what we use now |
| `LIBR` | library |
| `UNIV` | university |
| `SCH` | school |
| `MUS` | museum |
| `BLDG` | building (general) |

---

## ~~2. Lower the `min_city_population` threshold~~ ✅ DONE

**Was:** `geonamescache` defaulted to population ≥ 15,000 (32k cities). Small archive towns like Pazin, Croatia were missing.

**Fixed:** `_gc()` in `scanning_helpers.py` now passes `min_city_population=1000` → 161k cities. Valid values are 500, 1000, 5000, 15000 only — 10000 does not exist and crashes with a missing file error.

---

## 3. Admin hierarchy matching (region / province)

**Problem:** a volunteer in a small town near Zagreb gets no credit for Zagreb books because city strings don't match, and may not have set a travel distance.

**What GeoNames has:** `admin1code` field on every city — maps to region/province (e.g. "Splitsko-dalmatinska" for Split). Two cities in the same region are almost certainly within reasonable travel range of each other.

**What to build:**
- Add `admin1code` to the profile (auto-populated when city is looked up)
- Add a `same_region` scoring signal (e.g. +8 points, between `same_country` and `same_city`)
- No form field needed — derive it silently from the city lookup

---

## 4. Full alternate names — non-Latin scripts

**Problem:** `search_cities` only searches the `alternatenames` list bundled in `geonamescache`, which is a subset. The full GeoNames `alternateNames.txt` includes names in Cyrillic, Arabic, Greek, etc. A volunteer who types their city in Serbian Cyrillic (Београд) currently gets `None`.

**Fix options:**
- Use the raw `alternateNames.txt` dump and build a script→canonical lookup
- Or normalise input to ASCII/Latin before lookup using `unicodedata.normalize('NFKD', ...)`

**Quick partial fix (worth doing now):**
```python
import unicodedata

def _to_ascii(s: str) -> str:
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
```
Call `_to_ascii(city)` before the lookup as an additional fallback pass.

---

## 5. BCP47 language normalisation

**Problem:** `"Croatian"`, `"HR"`, `"hrv"`, `"hrvatski"` are all the same language but currently match as four different strings, so a volunteer who types `"HR"` gets zero language credit for Croatian books.

**What Anna's Archive does:** uses the `langcodes` Python library — `langcodes.find("Croatian")` and `langcodes.find("HR")` both return the same `Language` object.

**Fix:**
1. `pip install langcodes`
2. Normalise every language string to BCP47 on both sides of the match:
   ```python
   import langcodes
   def _norm_lang(s: str) -> str:
       try:
           return langcodes.find(s).language  # e.g. "hr"
       except LookupError:
           return s.lower()
   ```
3. Apply in `calculate_score` when comparing `book_lang` vs `volunteer_langs`

---

## 6. Country → language auto-inference

**What Anna's Archive has:** a `country_lang_mapping` dict (~100+ entries) that maps country name to primary language. If a volunteer fills in country but no language, infer it.

**Why useful here:** many volunteers will know their country but not think to fill in language. Auto-inferring means they still get language-match credit.

**Implementation:** add an inference step in `build_profile` — if `languages` is empty and `country` is set, look up the country's primary language and pre-populate.

---

## 7. Real database to replace `MOCK_BOOKS`

`MOCK_BOOKS` in `scanning_data.py` is a stand-in. The dict structure intentionally mirrors what a real DB row would look like, so the swap is mechanical:

- Replace `MOCK_BOOKS` source with a SQLAlchemy / raw SQL query
- Add `library_lat`, `library_lon` columns when TODO #1 is done (library coordinates)
- No changes needed to `calculate_score` or `match_books`

---

## 8. ASCII fallback for city lookup (quick win)

Partially addresses TODO #4 without the full alternateNames dump. Add one more pass in `_get_city_coords`:

```python
import unicodedata

def _to_ascii(s: str) -> str:
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()

# In _get_city_coords, after both existing passes fail:
ascii_city = _to_ascii(city)
if ascii_city != city:
    alt = _gc().search_cities(ascii_city, case_sensitive=False, contains_search=False)
    return _pick_coords(alt, cc)
```

---

## Notes on GeoNames raw dump

- URL: `https://download.geonames.org/export/dump/`
- `allCountries.zip` — ~350 MB compressed, ~1.5 GB unzipped, updated daily
- Per-country files: `HR.zip`, `AT.zip`, `BA.zip`, `PL.zip`, `CZ.zip`, etc. — much smaller
- `alternateNames.zip` — separate file, needed for TODO #4
- `dem` / `srtm` elevation columns exist but are not useful for this project
- Licence: Creative Commons Attribution 4.0
