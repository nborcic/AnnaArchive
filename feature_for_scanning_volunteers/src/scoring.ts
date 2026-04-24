import type { BookRequest, ScoredBook, VolunteerProfile } from './types';

// ─── SCORE WEIGHTS ────────────────────────────────────────────────────────────
// Centralised so you can tune the ranking without hunting through the function.
// Changing these numbers immediately changes which books float to the top.
const WEIGHTS = {
  riskHigh: 30,
  riskMedium: 15,
  riskLow: 5,
  sameCountry: 10,
  sameCity: 30,
  sameLibrary: 40,   // strongest single signal — volunteer can walk in right now
  languageMatch: 20,
  notDigitized: 20,
  digitizedPenalty: -50, // push already-done books to the bottom, not out entirely
  perRequest: 1,         // each community request adds 1 point (demand signal)
} as const;

// ─── SCORE THRESHOLD ──────────────────────────────────────────────────────────
// "High priority" filter uses this. A book must exceed this score to be shown
// when the user enables "only high priority".
export const HIGH_PRIORITY_THRESHOLD = 80;

// ─── MAIN SCORING FUNCTION ────────────────────────────────────────────────────
// Pure function: same inputs always produce the same output. No side effects,
// no global reads. This makes it trivial to reason about and test in the console:
//   scoreBook(myBook, myProfile)
//
// Returns a ScoredBook which bundles the score AND the reasons array.
// The reasons are written in plain language for display under each card — the
// user should never have to guess why a book ranked where it did.
export function scoreBook(book: BookRequest, profile: VolunteerProfile): ScoredBook {
  let score = 0;
  const reasons: string[] = [];

  // ── Risk level ──────────────────────────────────────────────────────────────
  // High-risk books are in danger of being lost. They deserve the most urgency.
  if (book.riskLevel === 'high') {
    score += WEIGHTS.riskHigh;
    reasons.push('High preservation risk');
  } else if (book.riskLevel === 'medium') {
    score += WEIGHTS.riskMedium;
    reasons.push('Medium preservation risk');
  } else {
    score += WEIGHTS.riskLow;
    // Low risk is expected — not worth surfacing as a reason
  }

  // ── Location proximity ───────────────────────────────────────────────────────
  // City match is stronger than country match because it implies the volunteer
  // may already visit that city, making the scan practical with no extra travel.
  if (book.country === profile.country) {
    score += WEIGHTS.sameCountry;
    reasons.push('In your country');
  }
  if (book.city === profile.city) {
    score += WEIGHTS.sameCity;
    reasons.push('Available in your city');
  }

  // ── Library access ───────────────────────────────────────────────────────────
  // Case-insensitive comparison handles small formatting differences like
  // "University Library Split" vs "university library split".
  const bookLib = book.library.toLowerCase();
  if (profile.libraries.some(l => l.toLowerCase() === bookLib)) {
    score += WEIGHTS.sameLibrary;
    reasons.push('In a library you can access');
  }

  // ── Language match ───────────────────────────────────────────────────────────
  // A volunteer who reads the book's language can verify the scan quality and
  // spot errors in OCR output — worth rewarding.
  const bookLang = book.language.toLowerCase();
  if (profile.languages.some(l => l.toLowerCase() === bookLang)) {
    score += WEIGHTS.languageMatch;
    reasons.push('Matches your language');
  }

  // ── Community demand ─────────────────────────────────────────────────────────
  // Each request is worth 1 point so a book with 40 requests naturally surfaces
  // above one with 3 requests when all else is equal. We only show the reason
  // string when there's meaningful demand (>10), otherwise it's noise.
  score += book.requestCount * WEIGHTS.perRequest;
  if (book.requestCount > 10) {
    reasons.push(`Requested by ${book.requestCount} users`);
  }

  // ── Digitization status ──────────────────────────────────────────────────────
  // Already digitized books get a heavy penalty so they sink to the bottom.
  // They stay in the list (rather than being forcibly removed here) so the
  // "hide digitized" filter toggle in the UI has something to hide.
  if (!book.isDigitized) {
    score += WEIGHTS.notDigitized;
    reasons.push('Not yet digitized');
  } else {
    score += WEIGHTS.digitizedPenalty;
    reasons.push('Already digitized');
  }

  return { book, score, reasons };
}
