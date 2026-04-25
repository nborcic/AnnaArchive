# ─── SCORING WEIGHTS ──────────────────────────────────────────────────────────
# Centralised so tuning the ranking never requires hunting through logic code.
WEIGHTS = {
    "risk_high":        30,
    "risk_medium":      15,
    "risk_low":          5,
    "same_country":     10,
    "same_city":        30,
    "same_library":     40,  # strongest signal — volunteer can walk in right now
    "language_match":   20,
    "not_digitized":    20,
    "digitized_penalty": -50,  # sink already-done books, don't hide them
    "per_request":       1,    # each community request adds 1 point
}

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

    if profile.get("city") and book["city"].lower() == profile["city"].lower():
        score += WEIGHTS["same_city"]
        reasons.append("Available in your city")

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
        "travel_distance_km":  args.get("travel_distance_km", "").strip(),
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
