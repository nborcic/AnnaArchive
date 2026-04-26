import math
import functools
import geonamescache

# ─── SCORING WEIGHTS ──────────────────────────────────────────────────────────
# Centralised so tuning the ranking never requires hunting through logic code.
WEIGHTS = {
    "risk_high":           30,
    "risk_medium":         15,
    "risk_low":             5,
    "same_country":        10,
    "same_city":           30,
    "within_travel_range": 15,  # reachable but not same city
    "same_library":        40,  # strongest signal — volunteer can walk in right now
    "language_match":      20,
    "not_digitized":       20,
    "digitized_penalty":  -50,  # sink already-done books, don't hide them
    "per_request":          1,  # each community request adds 1 point
}


# ─── GEOCODING ────────────────────────────────────────────────────────────────
# City/country data comes from the geonamescache package (bundled JSON, offline,
# no API key). To refresh the underlying GeoNames data run:
#   pip install --upgrade geonamescache
# The raw upstream dump updates daily at https://download.geonames.org/export/dump/
# — the package author syncs from it periodically. For finer control (LIBR feature
# codes, lower population threshold, etc.) see TODOS.md item #1.

@functools.cache
def _gc() -> geonamescache.GeonamesCache:
    # min_city_population=1000 covers all towns with a library (161k cities).
    # Default is 15000 (32k cities) — too coarse for small archive towns.
    # Valid values: 500, 1000, 5000, 15000. Lower values increase memory usage and startup time.
    return geonamescache.GeonamesCache(min_city_population=1000)


# Common names that don't substring-match the GeoNames canonical name.
_COUNTRY_ALIASES: dict[str, str] = {
    "czech republic": "CZ",
    "russia":         "RU",
    "south korea":    "KR",
    "north korea":    "KP",
    "iran":           "IR",
    "syria":          "SY",
    "taiwan":         "TW",
    "vietnam":        "VN",
}


@functools.cache
def _country_code(country_name: str) -> str | None:
    """
    Map a country name to ISO 3166-1 alpha-2 code (e.g. 'Croatia' → 'HR').
    Checks alias table first, then exact match, then substring for short
    names like 'Bosnia' matching 'Bosnia and Herzegovina'.
    """
    name_lower = country_name.lower().strip()
    if not name_lower:
        return None
    if name_lower in _COUNTRY_ALIASES:
        return _COUNTRY_ALIASES[name_lower]
    substring_match = None
    for iso, data in _gc().get_countries().items():
        full = data["name"].lower()
        if full == name_lower:
            return iso
        if substring_match is None and (name_lower in full or full in name_lower):
            substring_match = iso
    return substring_match


def _pick_coords(candidates, cc: str | None) -> tuple[float, float] | None:
    """Return (lat, lon) from the first candidate matching country code cc."""
    for city_data in candidates:
        if cc is None or city_data.get("countrycode") == cc:
            return city_data["latitude"], city_data["longitude"]
    return None


@functools.cache
def _get_city_coords(city: str, country: str) -> tuple[float, float] | None:
    """
    Return (lat, lon) for a city/country pair using the bundled GeoNames dataset.

    Strategy:
    1. Exact name match via get_cities_by_name (fast, handles canonical names).
    2. Alternate-name match via search_cities (catches ASCII spellings of cities
       with diacritics, e.g. 'Gdansk' → 'Gdańsk', 'Krakow' → 'Kraków').
    Falls back to the first result when the country isn't in the dataset.
    """
    cc = _country_code(country)

    # Step 1 — exact canonical name
    # get_cities_by_name returns [{'<geonameid>': {city fields}}, ...]
    candidates = [
        city_data
        for match in _gc().get_cities_by_name(city)
        for city_data in match.values()
    ]
    result = _pick_coords(candidates, cc)
    if result:
        return result

    # Step 2 — search alternate names (handles diacritics / ASCII variants)
    alt_candidates = _gc().search_cities(city, case_sensitive=False, contains_search=False)
    return _pick_coords(alt_candidates, cc)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return 2 * 6371 * math.asin(math.sqrt(a))

HIGH_PRIORITY_THRESHOLD = 80


def calculate_score(book: dict, profile: dict) -> tuple[int, list[str]]:
    """
    Return (score, reasons) for one book against one volunteer profile.

    Pure function — no side effects, no globals read at call time.
    Same inputs always produce the same output, making it easy to test
    in a Python shell:
        calculate_score(book, profile)
    """
    score = 0
    reasons = []

    # ── Risk level ────────────────────────────────────────────────────────────
    # High-risk books may be lost soon. They deserve the most urgency.
    risk = book.get("risk_level", "low")
    if risk == "high":
        score += WEIGHTS["risk_high"]
        reasons.append("High preservation risk")
    elif risk == "medium":
        score += WEIGHTS["risk_medium"]
        reasons.append("Medium preservation risk")
    else:
        score += WEIGHTS["risk_low"]
        # Low risk is not surprising — not worth surfacing as a reason

    # ── Location proximity ────────────────────────────────────────────────────
    # City match is stronger than country: it implies the volunteer is already
    # nearby and the scan requires little or no extra travel.
    if profile.get("country") and book["country"].lower() == profile["country"].lower():
        score += WEIGHTS["same_country"]
        reasons.append("In your country")

    city_matched = (
        bool(profile.get("city"))
        and book["city"].lower() == profile["city"].lower()
    )
    if city_matched:
        score += WEIGHTS["same_city"]
        reasons.append("Available in your city")
    else:
        # ── Travel range ──────────────────────────────────────────────────────
        # If the volunteer set a travel limit and we know both cities' coords,
        # reward books they can actually reach even if not in the same city.
        travel_km = profile.get("travel_distance_km")
        if travel_km:
            vol_coords  = _get_city_coords(profile.get("city", ""), profile.get("country", ""))
            book_coords = _get_city_coords(book["city"], book["country"])
            if vol_coords and book_coords:
                dist = _haversine_km(*vol_coords, *book_coords)
                if dist <= travel_km:
                    score += WEIGHTS["within_travel_range"]
                    reasons.append(f"Within your travel range ({dist:.0f} km away)")

    # ── Library access ────────────────────────────────────────────────────────
    # Case-insensitive so "University Library Split" matches
    # "university library split" entered by the user.
    book_library = book["library"].lower()
    volunteer_libraries = [lib.lower() for lib in profile.get("libraries", [])]
    if book_library in volunteer_libraries:
        score += WEIGHTS["same_library"]
        reasons.append("In a library you can access")

    # ── Language match ────────────────────────────────────────────────────────
    # A volunteer who reads the language can verify scan quality and spot
    # OCR errors — worth rewarding.
    book_lang = book["language"].lower()
    volunteer_langs = [lang.lower() for lang in profile.get("languages", [])]
    if book_lang in volunteer_langs:
        score += WEIGHTS["language_match"]
        reasons.append("Matches your language")

    # ── Community demand ──────────────────────────────────────────────────────
    # Each request is worth 1 point so a book with 40 requests floats above
    # one with 3 when all else is equal. Only surface the reason when demand
    # is meaningful (>10), otherwise it's noise.
    request_count = book.get("request_count", 0)
    score += request_count * WEIGHTS["per_request"]
    if request_count > 10:
        reasons.append(f"Requested by {request_count} users")

    # ── Digitization status ───────────────────────────────────────────────────
    # Already digitized books get a heavy penalty so they sink to the bottom.
    # They stay in the list so the "hide digitized" filter has something to hide.
    if not book.get("is_digitized", False):
        score += WEIGHTS["not_digitized"]
        reasons.append("Not yet digitized")
    else:
        score += WEIGHTS["digitized_penalty"]
        reasons.append("Already digitized")

    return score, reasons


def _parse_int(value: str) -> int | None:
    try:
        return int(float(value.strip()))
    except (ValueError, AttributeError):
        return None


def build_profile(args) -> dict:
    """
    Parse Flask request.args into a clean volunteer profile dict.

    Comma-separated fields (languages, libraries) are split into lists
    and stripped of whitespace. Empty strings are dropped so matching
    logic never has to handle [""] as a language list.
    """
    def split_csv(value: str) -> list[str]:
        return [s.strip() for s in value.split(",") if s.strip()]

    return {
        "country":   args.get("country", "").strip(),
        "city":      args.get("city", "").strip(),
        "languages": split_csv(args.get("languages", "")),
        "libraries": split_csv(args.get("libraries", "")),
        "scanner_type":        args.get("scanner_type", "").strip(),
        "travel_distance_km":  _parse_int(args.get("travel_distance_km", "")),
        "notes":               args.get("notes", "").strip(),
    }


def match_books(books: list[dict], profile: dict) -> list[dict]:
    """
    Score every book against the profile, attach score + reasons to each,
    and return the list sorted best-match first.

    Returns an empty list when no profile fields are filled in, so the
    template can show a prompt instead of a meaningless ranking.
    """
    # If the user hasn't entered anything yet, return nothing scored
    has_input = any([
        profile.get("country"),
        profile.get("city"),
        profile.get("languages"),
        profile.get("libraries"),
    ])
    if not has_input:
        return []

    results = []
    for book in books:
        score, reasons = calculate_score(book, profile)
        results.append({**book, "score": score, "match_reasons": reasons})

    # Sort descending by score — best match first
    results.sort(key=lambda b: b["score"], reverse=True)
    return results


def unique_languages(books: list[dict]) -> list[str]:
    """Return sorted list of distinct languages across all books."""
    return sorted({b["language"] for b in books})
