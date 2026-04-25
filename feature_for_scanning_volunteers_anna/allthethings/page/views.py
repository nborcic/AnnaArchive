from flask import Blueprint, render_template, request

from .scanning_data import MOCK_BOOKS
from .scanning_helpers import build_profile, match_books, unique_languages

# Blueprint mirrors the Anna's Archive pattern: one Blueprint per section,
# registered on the Flask app in app.py (or create_app in the real repo).
page = Blueprint("page", __name__, template_folder="templates")


@page.get("/scanning-volunteers")
def scanning_volunteers_page():
    """
    Volunteer scanner matching page.

    GET with no params  → show empty form, no results
    GET with params     → read profile from query string, score and rank books

    Uses GET (not POST) so results are bookmarkable and shareable via URL.
    Example:
        /scanning-volunteers?country=Croatia&city=Split&languages=Croatian%2CEnglish
    """
    # Parse volunteer profile from URL query params.
    # build_profile handles stripping, comma-splitting, and empty-string cleanup.
    profile = build_profile(request.args)

    # Score all mock books against the profile and sort by score descending.
    # Returns [] when the profile is empty (user hasn't submitted the form yet).
    matches = match_books(MOCK_BOOKS, profile)

    # Pass all books to the template so the language filter dropdown can be
    # populated with every possible language, not just the matched subset.
    all_languages = unique_languages(MOCK_BOOKS)

    # Active filter values read back from the query string so the form
    # re-renders with the user's previous selections after submit.
    active_filters = {
        "risk_level":         request.args.get("risk_level", ""),
        "language":           request.args.get("filter_language", ""),
        "hide_digitized":     request.args.get("hide_digitized") == "1",
        "only_same_country":  request.args.get("only_same_country") == "1",
        "only_same_city":     request.args.get("only_same_city") == "1",
        "only_high_priority": request.args.get("only_high_priority") == "1",
    }

    # Apply optional server-side filters on top of the scored results.
    # Filtering happens after scoring so scores are always correct regardless
    # of which books are shown.
    matches = _apply_filters(matches, active_filters, profile)

    return render_template(
        "page/scanning_volunteers.html",
        profile=profile,
        matches=matches,
        all_languages=all_languages,
        active_filters=active_filters,
        total_before_filter=len(match_books(MOCK_BOOKS, profile)),
    )


def _apply_filters(matches: list, filters: dict, profile: dict) -> list:
    """
    Apply the optional filter checkboxes and dropdowns on top of the scored list.
    Separated from the route to keep the view function readable.
    """
    from .scanning_helpers import HIGH_PRIORITY_THRESHOLD

    if filters["hide_digitized"]:
        matches = [m for m in matches if not m["is_digitized"]]

    if filters["only_same_country"] and profile.get("country"):
        matches = [m for m in matches if m["country"].lower() == profile["country"].lower()]

    if filters["only_same_city"] and profile.get("city"):
        matches = [m for m in matches if m["city"].lower() == profile["city"].lower()]

    if filters["only_high_priority"]:
        matches = [m for m in matches if m["score"] >= HIGH_PRIORITY_THRESHOLD]

    if filters["risk_level"]:
        matches = [m for m in matches if m["risk_level"] == filters["risk_level"]]

    if filters["language"]:
        matches = [m for m in matches if m["language"] == filters["language"]]

    return matches
