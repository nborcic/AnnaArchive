# TODO / Roadmap

Ordered roughly by impact.

---

## ~~1. Lower the `min_city_population` threshold~~ ✅ DONE

**Was:** `geonamescache` defaulted to population ≥ 15,000 (32k cities). Small archive towns like Pazin, Croatia were missing.

**Fixed:** `_gc()` in `scanning_helpers.py` now passes `min_city_population=1000` → 161k cities. Valid values are 500, 1000, 5000, 15000 only — 10000 does not exist and crashes with a missing file error.

---

## ~~2. BCP47 language normalisation~~ ✅ DONE

**Was:** plain lowercased string match — `"Croatian"`, `"hr"`, `"hrv"` all failed to match each other.

**Fixed:** `_norm_lang(s)` in `scanning_helpers.py` normalises any input to a BCP47 subtag using a two-pass strategy:
1. `langcodes.standardize_tag(s)` — handles codes (`"hrv"` → `"hr"`, `"pol"` → `"pl"`)
2. `langcodes.find(s)` — handles full names (`"Croatian"` → `"hr"`)
3. Fallback: `s.lower()`

Mock data updated to BCP47 codes (`"hr"`, `"de"`, `"pl"`, etc.). Requires `langcodes[data]>=3.5.0`.

**Remaining gap:** language filter dropdown shows raw codes — see Todo #3 below.

---

## 3. Language filter dropdown display names (quick win)

**Problem:** `unique_languages()` now returns BCP47 codes (`"hr"`, `"de"`, `"pl"`). The filter sidebar dropdown shows these raw codes — unusable for a volunteer.

**Fix:**
1. Add helper to `scanning_helpers.py`:
   ```python
   def language_display_names(codes: list[str]) -> dict[str, str]:
       result = {}
       for code in codes:
           try:
               name = langcodes.Language.get(code).display_name('en')
               result[code] = f"{name} ({code})"  # "Croatian (hr)"
           except Exception:
               result[code] = code
       return result
   ```
2. In `views.py`: `lang_names = language_display_names(all_languages)`, pass to template
3. In template dropdown: `{{ lang_names[lang] }}` instead of `{{ lang }}`

Filter value stays as BCP47 code — `_scanning_apply_filters` comparison is unchanged.

---

## 4. Tests for `calculate_score`

**Why:** pure function, easy to test, required before sending diff to Anna's Archive.

**Key cases to cover:**
- Same city scores higher than same country alone
- `digitized_penalty` fires and sinks the book
- `within_travel_range` fires when city didn't match and distance is within limit
- `within_travel_range` does NOT fire when city already matched (no double-reward)
- `match_books` returns `[]` on empty profile
- Language match works for `"Croatian"`, `"hr"`, `"hrv"` against a book with `"hr"`

---

## 5. ASCII fallback for city lookup (quick win)

**Problem:** a volunteer who types a city name using non-ASCII characters that don't match any GeoNames canonical or alternate name gets `None` from the lookup. The `unicodedata` stdlib can strip diacritics before the search as a final fallback pass.

**Fix:** add one more pass in `_get_city_coords` after both existing passes fail:

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

## 6. Country → language auto-inference

**What Anna's Archive has:** a `country_lang_mapping` dict (~100+ entries) that maps country name to primary language. If a volunteer fills in country but no language, infer it.

**Why useful here:** many volunteers will know their country but not think to fill in language. Auto-inferring means they still get language-match credit.

**Implementation:** add an inference step in `build_profile` — if `languages` is empty and `country` is set, look up the country's primary language and pre-populate.

---

## 7. Admin hierarchy matching (region / province)

**Problem:** a volunteer in a small town near Zagreb gets no credit for Zagreb books because city strings don't match, and may not have set a travel distance.

**What geonamescache has:** `admin1code` field on every city — maps to region/province (e.g. "Splitsko-dalmatinska" for Split). Two cities in the same region are almost certainly within reasonable travel range of each other.

**What to build:**
- Auto-populate `admin1code` from the city lookup when building the profile
- Add a `same_region` scoring signal (e.g. +8 points, between `same_country` and `same_city`)
- No form field needed — derive it silently from the city lookup

---

## 8. Real database to replace `MOCK_BOOKS`

`MOCK_BOOKS` in `scanning_data.py` is a stand-in. Two places need to change when the real DB is ready:

**`views.py`** — the two lines that reference `MOCK_BOOKS` (the book list fetch and the language list fetch) should be replaced with your real DB query. The rest of the view, scoring, and template need no changes.

**Required fields on each returned row** — the scoring and template depend on exactly these field names: `id`, `title`, `author`, `language` (BCP47 code), `country`, `city`, `library`, `request_count`, `risk_level` (`"high"` / `"medium"` / `"low"`), `is_digitized` (bool). Adding extra fields is fine; renaming or removing any of these breaks scoring silently.
