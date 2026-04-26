from flask import Blueprint, render_template, request
from allthethings.page.scanning_data import MOCK_BOOKS
from allthethings.page.scanning_helpers import build_profile, match_books, unique_languages, language_display_names, HIGH_PRIORITY_THRESHOLD

page = Blueprint("page", __name__)


@page.get("/scanning-volunteers")
def scanning_volunteers_page():
    """
    Volunteer scanner matching page.

    GET with no params  → show empty form, no results
    GET with params     → read profile from query string, score and rank books

    Uses GET (not POST) so results are bookmarkable and shareable via URL.
    Example:
        /scanning-volunteers?country=Croatia&city=Split&languages=Croatian%2CEnglish

    NOTE: no @cache.cached() here — query params are per-volunteer so caching
    would serve one person's ranked results to a different volunteer.
    """
    profile = build_profile(request.args)
    all_matches = match_books(MOCK_BOOKS, profile)
    all_languages = unique_languages(MOCK_BOOKS)
    lang_names = language_display_names(all_languages)

    active_filters = {
        "risk_level":         request.args.get("risk_level", ""),
        "language":           request.args.get("filter_language", ""),
        "hide_digitized":     request.args.get("hide_digitized") == "1",
        "only_same_country":  request.args.get("only_same_country") == "1",
        "only_same_city":     request.args.get("only_same_city") == "1",
        "only_high_priority": request.args.get("only_high_priority") == "1",
    }

    matches = _scanning_apply_filters(all_matches, active_filters, profile)

    return render_template(
        "page/scanning_volunteers.html",
        profile=profile,
        matches=matches,
        all_languages=all_languages,
        lang_names=lang_names,
        active_filters=active_filters,
        total_before_filter=len(all_matches),
    )


def _scanning_apply_filters(matches: list, filters: dict, profile: dict) -> list:
    """Filter and sort the scored book list based on active sidebar toggles."""
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
