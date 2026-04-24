// ─── RISK LEVEL ───────────────────────────────────────────────────────────────
// Literal union instead of a generic string so TypeScript enforces valid values
// everywhere — the compiler catches a typo like "hig" at write time, not runtime.
export type RiskLevel = 'low' | 'medium' | 'high';

// ─── BOOK REQUEST ─────────────────────────────────────────────────────────────
// Represents one entry in the mock book database.
// "requestCount" is how many users asked for this book to be scanned.
// "isDigitized" marks books already done — they stay in the list but score lower.
export interface BookRequest {
  id: string;
  title: string;
  author: string;
  language: string;
  country: string;
  city: string;
  library: string;
  requestCount: number;
  isDigitized: boolean;
  riskLevel: RiskLevel;
}

// ─── VOLUNTEER PROFILE ────────────────────────────────────────────────────────
// What the volunteer fills in. Arrays (languages, libraries) because a volunteer
// can speak multiple languages and have access to more than one library.
export interface VolunteerProfile {
  country: string;
  city: string;
  languages: string[];      // e.g. ["Croatian", "English"]
  libraries: string[];      // e.g. ["University Library Split"]
  scannerType: string;      // e.g. "phone", "flatbed", "overhead"
  notes: string;
  travelDistanceKm: number;
}

// ─── SCORED BOOK ──────────────────────────────────────────────────────────────
// The output of the scoring step. Carries the original book data plus:
//   score   — a single number used to sort the results list
//   reasons — human-readable strings shown under each card so users understand
//             why a book ranked where it did (transparency, not magic)
export interface ScoredBook {
  book: BookRequest;
  score: number;
  reasons: string[];
}

// ─── FILTER STATE ─────────────────────────────────────────────────────────────
// Everything the user can toggle in the filter bar.
// Stored in localStorage so filters survive a page refresh.
// Empty string for riskLevel / language means "no filter applied".
export interface FilterState {
  query: string;
  language: string;
  riskLevel: RiskLevel | '';
  onlyHighPriority: boolean;   // hides books below a score threshold
  onlySameCity: boolean;
  hideDigitized: boolean;
}

// ─── APP STATE ────────────────────────────────────────────────────────────────
// The single source of truth for the running app.
// main.ts owns this object and passes slices of it to other modules.
// Nothing outside main.ts mutates this directly.
export interface AppState {
  profile: VolunteerProfile | null;  // null until the form is submitted
  books: BookRequest[];
  watchedIds: Set<string>;           // Set gives O(1) has() checks
  filters: FilterState;
}
