import type { FilterState, ScoredBook, VolunteerProfile } from './types';
import { HIGH_PRIORITY_THRESHOLD } from './scoring';

// ─── DEFAULT FILTER STATE ─────────────────────────────────────────────────────
// Called when no saved filters exist in localStorage.
// All filters start in the "off" position so new users see everything.
export function defaultFilters(): FilterState {
  return {
    query: '',
    language: '',
    riskLevel: '',
    onlyHighPriority: false,
    onlySameCity: false,
    hideDigitized: false,
  };
}

// ─── APPLY FILTERS ────────────────────────────────────────────────────────────
// Pure function: given a list of scored books, a filter state, and the current
// volunteer profile, returns only the books that pass every active filter,
// sorted by score descending (best match first).
//
// Why pass profile here instead of baking city into FilterState?
// The profile's city is the authoritative source. Copying it into filters would
// create two places to update when the profile changes.
export function applyFilters(
  scored: ScoredBook[],
  filters: FilterState,
  profile: VolunteerProfile
): ScoredBook[] {
  return (
    scored
      // ── Text search ─────────────────────────────────────────────────────────
      // Checks title and author in one pass. toLowerCase() makes it
      // case-insensitive without regex overhead.
      .filter(({ book }) => {
        if (filters.query.trim() === '') return true;
        const q = filters.query.toLowerCase();
        return (
          book.title.toLowerCase().includes(q) ||
          book.author.toLowerCase().includes(q)
        );
      })

      // ── Language dropdown ────────────────────────────────────────────────────
      // Empty string means "all languages". Exact match, not substring, because
      // "English" should not match "Old English".
      .filter(({ book }) => {
        if (filters.language === '') return true;
        return book.language === filters.language;
      })

      // ── Risk level dropdown ──────────────────────────────────────────────────
      .filter(({ book }) => {
        if (filters.riskLevel === '') return true;
        return book.riskLevel === filters.riskLevel;
      })

      // ── Hide digitized toggle ────────────────────────────────────────────────
      .filter(({ book }) => {
        if (!filters.hideDigitized) return true;
        return !book.isDigitized;
      })

      // ── Same city only ───────────────────────────────────────────────────────
      .filter(({ book }) => {
        if (!filters.onlySameCity) return true;
        return book.city === profile.city;
      })

      // ── High priority only ───────────────────────────────────────────────────
      // Uses the threshold constant from scoring.ts so both modules agree on
      // what "high priority" means — no magic number in two places.
      .filter(({ score }) => {
        if (!filters.onlyHighPriority) return true;
        return score >= HIGH_PRIORITY_THRESHOLD;
      })

      // ── Sort by score descending ─────────────────────────────────────────────
      // The best match is always first. The sort is stable in all modern engines
      // so books with equal scores preserve their original order.
      .sort((a, b) => b.score - a.score)
  );
}

// ─── UNIQUE LANGUAGE LIST ─────────────────────────────────────────────────────
// Extracts all distinct languages from the book list so the language dropdown
// can be populated dynamically — if admin adds a new language, it appears
// automatically without touching this file.
export function getUniqueLanguages(scored: ScoredBook[]): string[] {
  const seen = new Set<string>();
  for (const { book } of scored) seen.add(book.language);
  return [...seen].sort();
}
