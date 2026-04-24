import type { AppState, BookRequest, RiskLevel } from './types';
import { SEED_BOOKS } from './data';
import {
  saveProfile, loadProfile,
  saveBooks, loadBooks,
  saveWatchedIds, loadWatchedIds,
  saveFilters, loadFilters,
  buildExportPayload,
  type ExportPayload,
} from './storage';
import { scoreBook } from './scoring';
import { applyFilters, defaultFilters, getUniqueLanguages } from './filters';
import {
  renderBookCard,
  renderEmptyState,
  renderProfileSummary,
  populateLanguageDropdown,
  updateWatchCount,
  renderWatchedPanel,
  resetAddBookForm,
} from './render';

// ─── DOM REFERENCES ───────────────────────────────────────────────────────────
// Queried once at startup. The `!` non-null assertion tells TypeScript we are
// sure these elements exist in index.html — if one is missing the app throws
// early with a clear error rather than a mysterious null dereference later.
const profileSection  = document.getElementById('profile-section')!;
const resultsSection  = document.getElementById('results-section')!;
const resultsGrid     = document.getElementById('results-grid')!;
const profileArea     = document.getElementById('profile-area')!;
const watchCountEl    = document.getElementById('watch-count')!;
const watchedPanel    = document.getElementById('watched-panel')!;
const langSelect      = document.getElementById('filter-lang') as HTMLSelectElement;
const riskSelect      = document.getElementById('filter-risk') as HTMLSelectElement;
const searchInput     = document.getElementById('filter-search') as HTMLInputElement;
const highPriCheck    = document.getElementById('filter-high-priority') as HTMLInputElement;
const sameCityCheck   = document.getElementById('filter-same-city') as HTMLInputElement;
const hideDigCheck    = document.getElementById('filter-hide-digitized') as HTMLInputElement;
const profileForm     = document.getElementById('profile-form') as HTMLFormElement;
const addBookForm     = document.getElementById('add-book-form') as HTMLFormElement;

// ─── APP STATE ────────────────────────────────────────────────────────────────
// Single mutable object for the whole app. Only this file (main.ts) writes to it.
// Every other module receives slices as arguments — they never import state directly.
// After any mutation call rerender() to sync the DOM.
const state: AppState = {
  profile:    loadProfile(),
  books:      loadBooks() ?? [...SEED_BOOKS],  // fall back to seed if nothing saved
  watchedIds: loadWatchedIds(),
  filters:    loadFilters() ?? defaultFilters(),
};

// Tracks the books currently visible after filters are applied.
// Updated on every rerender() so the export handler always has the current view.
let visibleBooks: BookRequest[] = [];

// ─── BOOTSTRAP ────────────────────────────────────────────────────────────────
// Called once on page load. Decides which "screen" to show and wires up events.
function init(): void {
  if (state.profile) {
    showResults();
  } else {
    showProfileForm();
  }

  wireProfileForm();
  wireFilterControls();
  wireAddBookForm();
  wireExportImport();
  wireWatchedPanel();
  wireClearAll();
}

// ─── SCREEN SWITCHING ─────────────────────────────────────────────────────────
// The app has two main views: the profile form and the results page.
// We toggle CSS classes rather than hiding/showing with JS style to keep
// visibility rules in one place (style.css).

function showProfileForm(): void {
  profileSection.classList.remove('hidden');
  resultsSection.classList.add('hidden');

  // Pre-fill the form if the user is editing an existing profile
  if (state.profile) {
    fillProfileForm(state.profile);
  }
}

function showResults(): void {
  profileSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  rerender();
}

// ─── MAIN RENDER LOOP ─────────────────────────────────────────────────────────
// Called after every state mutation. Computes scores, applies filters,
// then rebuilds the results grid and sidebar from scratch.
//
// Re-rendering the whole grid on every change is simple and fast enough for
// ~20 books. A real app with thousands of entries would need virtualisation.
function rerender(): void {
  if (!state.profile) return;

  // 1. Score all books against the current profile
  const scored = state.books.map(b => scoreBook(b, state.profile!));

  // 2. Populate the language dropdown from the full scored list (before filters)
  //    so options don't disappear when a language filter is already active.
  const languages = getUniqueLanguages(scored);
  populateLanguageDropdown(langSelect, languages, state.filters.language);

  // 3. Apply filters and sort. Also write into visibleBooks so the export
  //    handler can see exactly what the user is currently looking at.
  const visible = applyFilters(scored, state.filters, state.profile);
  visibleBooks = visible.map(s => s.book);

  // 4. Rebuild the profile summary bar
  profileArea.innerHTML = '';
  const summary = renderProfileSummary(state.profile);
  profileArea.appendChild(summary);

  // Wire the "Edit profile" button that renderProfileSummary placed in the DOM
  document.getElementById('edit-profile-btn')?.addEventListener('click', showProfileForm);

  // 5. Rebuild the results grid
  resultsGrid.innerHTML = '';
  if (visible.length === 0) {
    resultsGrid.appendChild(renderEmptyState());
  } else {
    for (const s of visible) {
      resultsGrid.appendChild(renderBookCard(s, state.watchedIds.has(s.book.id)));
    }
  }

  // 6. Update sidebar watched panel
  renderWatchedPanel(watchedPanel, state.books, state.watchedIds);

  // 7. Update watch count badge in header
  updateWatchCount(watchCountEl, state.watchedIds.size);

  // 8. Sync filter checkboxes to saved state (needed after import or reset)
  syncFilterUI();
}

// ─── PROFILE FORM ─────────────────────────────────────────────────────────────

function wireProfileForm(): void {
  profileForm.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(profileForm);

    // Languages and libraries arrive as comma-separated strings from the textarea.
    // We split, trim, and filter out empty strings from accidental trailing commas.
    const languages = (data.get('languages') as string)
      .split(',').map(s => s.trim()).filter(Boolean);
    const libraries = (data.get('libraries') as string)
      .split(',').map(s => s.trim()).filter(Boolean);

    state.profile = {
      country:          (data.get('country') as string).trim(),
      city:             (data.get('city') as string).trim(),
      languages,
      libraries,
      scannerType:      data.get('scannerType') as string,
      notes:            (data.get('notes') as string).trim(),
      travelDistanceKm: Number(data.get('travelDistanceKm')) || 0,
    };

    saveProfile(state.profile);
    showResults();
  });
}

function fillProfileForm(profile: typeof state.profile): void {
  if (!profile) return;
  (profileForm.querySelector('[name="country"]')     as HTMLInputElement).value = profile.country;
  (profileForm.querySelector('[name="city"]')        as HTMLInputElement).value = profile.city;
  (profileForm.querySelector('[name="languages"]')   as HTMLTextAreaElement).value = profile.languages.join(', ');
  (profileForm.querySelector('[name="libraries"]')   as HTMLTextAreaElement).value = profile.libraries.join(', ');
  (profileForm.querySelector('[name="scannerType"]') as HTMLSelectElement).value   = profile.scannerType;
  (profileForm.querySelector('[name="notes"]')       as HTMLTextAreaElement).value = profile.notes;
  (profileForm.querySelector('[name="travelDistanceKm"]') as HTMLInputElement).value = String(profile.travelDistanceKm);
}

// ─── FILTER CONTROLS ──────────────────────────────────────────────────────────

function wireFilterControls(): void {
  // Text search — debounced so we don't re-render on every keystroke
  let debounceTimer: ReturnType<typeof setTimeout>;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.filters.query = searchInput.value;
      persistFiltersAndRender();
    }, 200);
  });

  langSelect.addEventListener('change', () => {
    state.filters.language = langSelect.value;
    persistFiltersAndRender();
  });

  riskSelect.addEventListener('change', () => {
    state.filters.riskLevel = riskSelect.value as RiskLevel | '';
    persistFiltersAndRender();
  });

  highPriCheck.addEventListener('change', () => {
    state.filters.onlyHighPriority = highPriCheck.checked;
    persistFiltersAndRender();
  });

  sameCityCheck.addEventListener('change', () => {
    state.filters.onlySameCity = sameCityCheck.checked;
    persistFiltersAndRender();
  });

  hideDigCheck.addEventListener('change', () => {
    state.filters.hideDigitized = hideDigCheck.checked;
    persistFiltersAndRender();
  });

  document.getElementById('clear-filters-btn')?.addEventListener('click', () => {
    state.filters = defaultFilters();
    persistFiltersAndRender();
  });
}

function persistFiltersAndRender(): void {
  saveFilters(state.filters);
  rerender();
}

// Sync the filter UI elements to reflect the current filter state.
// Needed after an import or "clear all" resets the state object.
function syncFilterUI(): void {
  searchInput.value         = state.filters.query;
  riskSelect.value          = state.filters.riskLevel;
  highPriCheck.checked      = state.filters.onlyHighPriority;
  sameCityCheck.checked     = state.filters.onlySameCity;
  hideDigCheck.checked      = state.filters.hideDigitized;
}

// ─── WATCH TOGGLE ─────────────────────────────────────────────────────────────
// Event delegation: one listener on the results grid handles all watch buttons.
// We find the button by its data-id attribute rather than wiring each card
// individually — this survives full re-renders without memory leaks.
resultsGrid.addEventListener('click', e => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
  if (!btn || !btn.classList.contains('watch-btn')) return;

  const id = btn.dataset.id!;
  if (state.watchedIds.has(id)) {
    state.watchedIds.delete(id);
  } else {
    state.watchedIds.add(id);
  }

  saveWatchedIds(state.watchedIds);
  rerender();
});

// ─── WATCHED PANEL ────────────────────────────────────────────────────────────

function wireWatchedPanel(): void {
  // Unwatch from the sidebar panel (the ✕ buttons)
  watchedPanel.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.unwatch-btn');
    if (!btn) return;
    state.watchedIds.delete(btn.dataset.id!);
    saveWatchedIds(state.watchedIds);
    rerender();
  });

  // Toggle the panel open/closed
  document.getElementById('toggle-watched-btn')?.addEventListener('click', () => {
    watchedPanel.classList.toggle('open');
  });
}

// ─── ADMIN ADD-BOOK FORM ──────────────────────────────────────────────────────
// Lets the user inject custom books to see how they affect scoring.
// New books are added to the live state and persisted so they survive refresh.

function wireAddBookForm(): void {
  addBookForm.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(addBookForm);

    const newBook: BookRequest = {
      // Timestamp-based ID is unique enough for a local mock app
      id:           `custom-${Date.now()}`,
      title:        (data.get('title') as string).trim(),
      author:       (data.get('author') as string).trim(),
      language:     (data.get('language') as string).trim(),
      country:      (data.get('country') as string).trim(),
      city:         (data.get('city') as string).trim(),
      library:      (data.get('library') as string).trim(),
      requestCount: Number(data.get('requestCount')) || 0,
      riskLevel:    data.get('riskLevel') as RiskLevel,
      isDigitized:  data.get('isDigitized') === 'yes',
    };

    state.books.push(newBook);
    saveBooks(state.books);
    resetAddBookForm(addBookForm);

    // Flash the add-book panel heading so the user knows it worked
    const heading = addBookForm.previousElementSibling as HTMLElement | null;
    if (heading) {
      heading.classList.add('flash');
      setTimeout(() => heading.classList.remove('flash'), 600);
    }

    rerender();
  });
}

// ─── EXPORT / IMPORT JSON ─────────────────────────────────────────────────────

function wireExportImport(): void {
  document.getElementById('export-btn')?.addEventListener('click', () => {
    // Export only what is currently visible after filters.
    // If no filters are active, visibleBooks === all books so behaviour is identical.
    const payload = buildExportPayload(state.profile, visibleBooks, state.watchedIds);
    const blob    = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = 'svm-export.json';
    a.click();
    // Release the object URL immediately — the browser has already started the download
    URL.revokeObjectURL(url);
  });

  document.getElementById('import-btn')?.addEventListener('click', () => {
    // Trigger a hidden file input rather than building a visible one in the HTML,
    // so the button styling stays consistent.
    const input = document.createElement('input');
    input.type  = 'file';
    input.accept = '.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;

      file.text().then(raw => {
        const payload = JSON.parse(raw) as ExportPayload;

        // Apply imported data to state
        state.profile    = payload.profile;
        state.books      = payload.bookRequests;
        state.watchedIds = new Set(payload.watchedBookIds);
        state.filters    = defaultFilters();

        // Persist everything
        if (state.profile) saveProfile(state.profile);
        saveBooks(state.books);
        saveWatchedIds(state.watchedIds);
        saveFilters(state.filters);

        if (state.profile) showResults();
        else showProfileForm();
      }).catch(() => {
        alert('Could not parse the JSON file. Make sure it was exported by this app.');
      });
    });
    input.click();
  });
}

// ─── CLEAR ALL DATA ───────────────────────────────────────────────────────────
// Wipes localStorage and resets to seed state. Useful for testing from scratch.

function wireClearAll(): void {
  document.getElementById('clear-all-btn')?.addEventListener('click', () => {
    if (!confirm('This will clear your profile, custom books, and watched list. Continue?')) return;
    localStorage.clear();
    state.profile    = null;
    state.books      = [...SEED_BOOKS];
    state.watchedIds = new Set();
    state.filters    = defaultFilters();
    showProfileForm();
  });
}

// ─── START ────────────────────────────────────────────────────────────────────
init();
