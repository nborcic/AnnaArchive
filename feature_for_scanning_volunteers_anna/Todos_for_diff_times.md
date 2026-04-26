# TODO / Roadmap

Ordered roughly by impact.

---

## ~~1. Lower the `min_city_population` threshold~~ ✅ DONE

**Was:** `geonamescache` defaulted to population ≥ 15,000 (32k cities). Small archive towns like Pazin, Croatia were missing.

**Fixed:** `_gc()` in `scanning_helpers.py` now passes `min_city_population=1000` → 161k cities. Valid values are 500, 1000, 5000, 15000 only — 10000 does not exist and crashes with a missing file error.

---

## 2. ASCII fallback for city lookup (quick win)

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

## 3. BCP47 language normalisation

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

## 4. Country → language auto-inference

**What Anna's Archive has:** a `country_lang_mapping` dict (~100+ entries) that maps country name to primary language. If a volunteer fills in country but no language, infer it.

**Why useful here:** many volunteers will know their country but not think to fill in language. Auto-inferring means they still get language-match credit.

**Implementation:** add an inference step in `build_profile` — if `languages` is empty and `country` is set, look up the country's primary language and pre-populate.

---

## 5. Admin hierarchy matching (region / province)

**Problem:** a volunteer in a small town near Zagreb gets no credit for Zagreb books because city strings don't match, and may not have set a travel distance.

**What geonamescache has:** `admin1code` field on every city — maps to region/province (e.g. "Splitsko-dalmatinska" for Split). Two cities in the same region are almost certainly within reasonable travel range of each other.

**What to build:**
- Auto-populate `admin1code` from the city lookup when building the profile
- Add a `same_region` scoring signal (e.g. +8 points, between `same_country` and `same_city`)
- No form field needed — derive it silently from the city lookup

---

## 6. Real database to replace `MOCK_BOOKS`

`MOCK_BOOKS` in `scanning_data.py` is a stand-in. The dict structure intentionally mirrors what a real DB row would look like, so the swap is mechanical:

- Replace `MOCK_BOOKS` source with a SQLAlchemy / raw SQL query
- No changes needed to `calculate_score` or `match_books`
