"""
Tests for calculate_score, match_books, and _norm_lang in scanning_helpers.py.
All functions under test are pure — no Flask context, no DB, no HTTP.

Run with:  python -m pytest tests/
"""
import pytest
from allthethings.page.scanning_helpers import (
    calculate_score,
    match_books,
    _norm_lang,
    WEIGHTS,
    HIGH_PRIORITY_THRESHOLD,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_book(**overrides):
    base = {
        "id": "1",
        "title": "Test Book",
        "author": "Author",
        "language": "hr",
        "country": "Croatia",
        "city": "Split",
        "library": "University Library Split",
        "request_count": 0,
        "risk_level": "low",
        "is_digitized": False,
    }
    return {**base, **overrides}


def make_profile(**overrides):
    base = {
        "country": "",
        "city": "",
        "languages": [],
        "libraries": [],
        "scanner_type": "",
        "travel_distance_km": None,
        "notes": "",
    }
    return {**base, **overrides}


# ── _norm_lang ─────────────────────────────────────────────────────────────────

class TestNormLang:
    def test_full_name(self):
        assert _norm_lang("Croatian") == "hr"

    def test_alpha2_code(self):
        assert _norm_lang("hr") == "hr"

    def test_alpha3_code(self):
        assert _norm_lang("hrv") == "hr"

    def test_native_name(self):
        assert _norm_lang("hrvatski") == "hr"

    def test_case_insensitive(self):
        assert _norm_lang("CROATIAN") == "hr"
        assert _norm_lang("german") == "de"

    def test_other_languages(self):
        assert _norm_lang("Polish") == "pl"
        assert _norm_lang("pol") == "pl"
        assert _norm_lang("de") == "de"
        assert _norm_lang("deu") == "de"

    def test_unknown_falls_back_to_lowercase(self):
        assert _norm_lang("gibberish") == "gibberish"


# ── Risk level scoring ─────────────────────────────────────────────────────────

class TestRiskScoring:
    def test_high_risk_adds_correct_weight(self):
        book = make_book(risk_level="high")
        score, reasons = calculate_score(book, make_profile())
        assert score >= WEIGHTS["risk_high"]
        assert "High preservation risk" in reasons

    def test_medium_risk_adds_correct_weight(self):
        book = make_book(risk_level="medium")
        score, reasons = calculate_score(book, make_profile())
        assert score >= WEIGHTS["risk_medium"]
        assert "Medium preservation risk" in reasons

    def test_low_risk_does_not_surface_reason(self):
        book = make_book(risk_level="low")
        _, reasons = calculate_score(book, make_profile())
        assert not any("risk" in r.lower() for r in reasons)

    def test_high_risk_scores_higher_than_low(self):
        profile = make_profile()
        high_score, _ = calculate_score(make_book(risk_level="high"), profile)
        low_score, _  = calculate_score(make_book(risk_level="low"),  profile)
        assert high_score > low_score


# ── Location proximity scoring ────────────────────────────────────────────────

class TestLocationScoring:
    def test_same_city_scores_higher_than_same_country_only(self):
        country_only = make_profile(country="Croatia")
        city_match   = make_profile(country="Croatia", city="Split")
        book = make_book(country="Croatia", city="Split")

        country_score, _ = calculate_score(book, country_only)
        city_score, _    = calculate_score(book, city_match)
        assert city_score > country_score

    def test_same_city_adds_reason(self):
        profile = make_profile(city="Split", country="Croatia")
        _, reasons = calculate_score(make_book(city="Split", country="Croatia"), profile)
        assert "Available in your city" in reasons

    def test_same_country_adds_reason(self):
        profile = make_profile(country="Croatia")
        _, reasons = calculate_score(make_book(country="Croatia"), profile)
        assert "In your country" in reasons

    def test_city_match_is_case_insensitive(self):
        profile = make_profile(city="split", country="Croatia")
        _, reasons = calculate_score(make_book(city="Split", country="Croatia"), profile)
        assert "Available in your city" in reasons

    def test_city_match_blocks_travel_range_reward(self):
        """When city matches, travel range must not fire — no double-reward."""
        profile = make_profile(city="Split", country="Croatia", travel_distance_km=500)
        _, reasons = calculate_score(make_book(city="Split", country="Croatia"), profile)
        assert "Available in your city" in reasons
        assert not any("travel range" in r.lower() for r in reasons)

    def test_travel_range_fires_when_city_does_not_match(self):
        """Vienna is ~1200 km from Split; 200 km range should NOT fire."""
        profile = make_profile(city="Split", country="Croatia", travel_distance_km=200)
        book = make_book(city="Vienna", country="Austria")
        _, reasons = calculate_score(book, profile)
        assert not any("travel range" in r.lower() for r in reasons)

    def test_travel_range_fires_for_nearby_city(self):
        """Trogir is ~30 km from Split; 50 km range should fire."""
        profile = make_profile(city="Split", country="Croatia", travel_distance_km=50)
        book = make_book(city="Trogir", country="Croatia")
        _, reasons = calculate_score(book, profile)
        assert any("travel range" in r.lower() for r in reasons)


# ── Library access scoring ────────────────────────────────────────────────────

class TestLibraryScoring:
    def test_same_library_adds_reason(self):
        profile = make_profile(libraries=["University Library Split"])
        _, reasons = calculate_score(make_book(library="University Library Split"), profile)
        assert "In a library you can access" in reasons

    def test_library_match_is_case_insensitive(self):
        profile = make_profile(libraries=["university library split"])
        _, reasons = calculate_score(make_book(library="University Library Split"), profile)
        assert "In a library you can access" in reasons

    def test_different_library_does_not_match(self):
        profile = make_profile(libraries=["Some Other Library"])
        _, reasons = calculate_score(make_book(library="University Library Split"), profile)
        assert "In a library you can access" not in reasons


# ── Language scoring ──────────────────────────────────────────────────────────

class TestLanguageScoring:
    def test_full_name_matches_bcp47_code(self):
        profile = make_profile(languages=["Croatian"])
        _, reasons = calculate_score(make_book(language="hr"), profile)
        assert "Matches your language" in reasons

    def test_alpha2_code_matches(self):
        profile = make_profile(languages=["hr"])
        _, reasons = calculate_score(make_book(language="hr"), profile)
        assert "Matches your language" in reasons

    def test_alpha3_code_matches(self):
        profile = make_profile(languages=["hrv"])
        _, reasons = calculate_score(make_book(language="hr"), profile)
        assert "Matches your language" in reasons

    def test_wrong_language_does_not_match(self):
        profile = make_profile(languages=["German"])
        _, reasons = calculate_score(make_book(language="hr"), profile)
        assert "Matches your language" not in reasons

    def test_multiple_languages_any_match(self):
        profile = make_profile(languages=["German", "Croatian"])
        _, reasons = calculate_score(make_book(language="hr"), profile)
        assert "Matches your language" in reasons


# ── Digitization scoring ──────────────────────────────────────────────────────

class TestDigitizationScoring:
    def test_not_digitized_adds_reason_and_positive_score(self):
        book = make_book(is_digitized=False)
        score, reasons = calculate_score(book, make_profile())
        assert "Not yet digitized" in reasons
        assert score > 0

    def test_digitized_adds_penalty(self):
        not_done = make_book(is_digitized=False)
        done     = make_book(is_digitized=True)
        profile = make_profile()
        score_not_done, _ = calculate_score(not_done, profile)
        score_done, _     = calculate_score(done, profile)
        assert score_done < score_not_done

    def test_digitized_penalty_sinks_book(self):
        """A digitized book with no other signals should have a negative score."""
        book = make_book(is_digitized=True, risk_level="low", request_count=0)
        score, reasons = calculate_score(book, make_profile())
        assert score < 0
        assert "Already digitized" in reasons


# ── Community demand scoring ──────────────────────────────────────────────────

class TestRequestScoring:
    def test_requests_add_to_score(self):
        few  = make_book(request_count=5)
        many = make_book(request_count=50)
        profile = make_profile()
        score_few,  _ = calculate_score(few,  profile)
        score_many, _ = calculate_score(many, profile)
        assert score_many > score_few

    def test_request_reason_only_shown_above_threshold(self):
        low  = make_book(request_count=5)
        high = make_book(request_count=50)
        profile = make_profile()
        _, reasons_low  = calculate_score(low,  profile)
        _, reasons_high = calculate_score(high, profile)
        assert not any("Requested" in r for r in reasons_low)
        assert any("Requested" in r for r in reasons_high)


# ── match_books ───────────────────────────────────────────────────────────────

class TestMatchBooks:
    def test_returns_empty_list_on_empty_profile(self):
        books = [make_book()]
        assert match_books(books, make_profile()) == []

    def test_travel_distance_alone_does_not_trigger_results(self):
        """travel_distance_km without a city is meaningless — still empty."""
        profile = make_profile(travel_distance_km=100)
        assert match_books([make_book()], profile) == []

    def test_returns_results_when_country_set(self):
        profile = make_profile(country="Croatia")
        results = match_books([make_book()], profile)
        assert len(results) == 1

    def test_results_sorted_best_first(self):
        books = [
            make_book(id="1", risk_level="low",  city="Vienna",  country="Austria"),
            make_book(id="2", risk_level="high", city="Split",   country="Croatia"),
            make_book(id="3", risk_level="low",  city="Split",   country="Croatia"),
        ]
        profile = make_profile(country="Croatia", city="Split")
        results = match_books(books, profile)
        scores = [r["score"] for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_score_and_reasons_attached_to_each_result(self):
        profile = make_profile(country="Croatia")
        results = match_books([make_book()], profile)
        assert "score" in results[0]
        assert "match_reasons" in results[0]

    def test_high_priority_threshold(self):
        """A book matching city + library + language should exceed 80 points."""
        book = make_book(
            risk_level="high", city="Split", country="Croatia",
            library="University Library Split", language="hr",
            is_digitized=False, request_count=0,
        )
        profile = make_profile(
            country="Croatia", city="Split",
            libraries=["University Library Split"],
            languages=["Croatian"],
        )
        score, _ = calculate_score(book, profile)
        assert score >= HIGH_PRIORITY_THRESHOLD
