import type { BookRequest, FilterState, VolunteerProfile } from './types';

// ─── KEY CONSTANTS ────────────────────────────────────────────────────────────
// All localStorage keys in one place. Prefixed with "svm_" (scanner volunteer
// matcher) to avoid collisions if this ever runs on a shared origin.
const KEYS = {
  profile: 'svm_profile',
  books: 'svm_books',
  watched: 'svm_watched',
  filters: 'svm_filters',
} as const;

// ─── PROFILE ──────────────────────────────────────────────────────────────────

export function saveProfile(p: VolunteerProfile): void {
  localStorage.setItem(KEYS.profile, JSON.stringify(p));
}

export function loadProfile(): VolunteerProfile | null {
  const raw = localStorage.getItem(KEYS.profile);
  // JSON.parse returns `any` — we trust our own serialized data here because
  // nothing external writes to these keys.
  return raw ? (JSON.parse(raw) as VolunteerProfile) : null;
}

export function clearProfile(): void {
  localStorage.removeItem(KEYS.profile);
}

// ─── BOOK REQUESTS ────────────────────────────────────────────────────────────
// We store the custom books the user adds via the admin form.
// The seed books from data.ts are NOT stored here — they're loaded from code.
// On load, if no custom books exist we fall back to seed data (handled in main.ts).

export function saveBooks(books: BookRequest[]): void {
  localStorage.setItem(KEYS.books, JSON.stringify(books));
}

export function loadBooks(): BookRequest[] | null {
  const raw = localStorage.getItem(KEYS.books);
  return raw ? (JSON.parse(raw) as BookRequest[]) : null;
}

// ─── WATCHED IDS ──────────────────────────────────────────────────────────────
// localStorage can only store strings, not Sets.
// We convert Set → Array for storage, and Array → Set on load.

export function saveWatchedIds(ids: Set<string>): void {
  localStorage.setItem(KEYS.watched, JSON.stringify([...ids]));
}

export function loadWatchedIds(): Set<string> {
  const raw = localStorage.getItem(KEYS.watched);
  return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
}

// ─── FILTERS ──────────────────────────────────────────────────────────────────

export function saveFilters(f: FilterState): void {
  localStorage.setItem(KEYS.filters, JSON.stringify(f));
}

export function loadFilters(): FilterState | null {
  const raw = localStorage.getItem(KEYS.filters);
  return raw ? (JSON.parse(raw) as FilterState) : null;
}

// ─── FULL EXPORT / IMPORT ─────────────────────────────────────────────────────
// Used by the JSON export button. Returns a plain object safe to pass to
// JSON.stringify. We do NOT include filterState in the export because filters
// are a UI concern — someone importing data on a different machine shouldn't
// inherit the previous user's filter selections.

export interface ExportPayload {
  profile: VolunteerProfile | null;
  bookRequests: BookRequest[];
  watchedBookIds: string[];
}

export function buildExportPayload(
  profile: VolunteerProfile | null,
  books: BookRequest[],
  watchedIds: Set<string>
): ExportPayload {
  return {
    profile,
    bookRequests: books,
    watchedBookIds: [...watchedIds],
  };
}
