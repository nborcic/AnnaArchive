import type { BookRequest, ScoredBook, VolunteerProfile } from './types';

// ─── BOOK CARD ────────────────────────────────────────────────────────────────
// Builds one card DOM element for a scored book result.
//
// Returns an HTMLElement (not a string) so the caller can attach it with
// appendChild — that avoids re-parsing innerHTML on the parent container and
// keeps event delegation clean (data-id is on the button, main.ts picks it up).
//
// isWatched drives the button label and CSS class. The card does not manage its
// own watch state — that lives in AppState in main.ts.
export function renderBookCard(scored: ScoredBook, isWatched: boolean): HTMLElement {
  const { book, score, reasons } = scored;

  const card = document.createElement('article');
  // risk-high / risk-medium / risk-low class drives the left border colour in CSS
  card.className = `book-card risk-${book.riskLevel}`;

  card.innerHTML = `
    <div class="card-top">
      <span class="score-badge">Score: ${score}</span>
      <span class="risk-badge risk-${book.riskLevel}">${book.riskLevel} risk</span>
      ${book.isDigitized ? '<span class="digitized-badge">Digitized</span>' : ''}
    </div>

    <h3 class="card-title">${escapeHtml(book.title)}</h3>
    <p class="card-author">${escapeHtml(book.author)}</p>

    <dl class="card-meta">
      <dt>Library</dt><dd>${escapeHtml(book.library)}</dd>
      <dt>Location</dt><dd>${escapeHtml(book.city)}, ${escapeHtml(book.country)}</dd>
      <dt>Language</dt><dd>${escapeHtml(book.language)}</dd>
      <dt>Requests</dt><dd>${book.requestCount}</dd>
    </dl>

    <div class="card-reasons">
      <p class="reasons-label">Why this book:</p>
      <ul>
        ${reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>
    </div>

    <button
      class="watch-btn ${isWatched ? 'watching' : ''}"
      data-id="${book.id}"
      aria-pressed="${isWatched}"
    >${isWatched ? 'Watching ✓' : 'Watch this book'}</button>
  `;

  return card;
}

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────
// Shown when filters produce zero results. Gives the user a clear signal
// and a hint rather than a confusing blank area.
export function renderEmptyState(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.innerHTML = `
    <p>No books match your current filters.</p>
    <p>Try clearing some filters or adjusting your profile.</p>
  `;
  return el;
}

// ─── PROFILE SUMMARY ──────────────────────────────────────────────────────────
// A short read-only summary shown at the top of the results page.
// The edit button is wired in main.ts via event delegation.
export function renderProfileSummary(profile: VolunteerProfile): HTMLElement {
  const el = document.createElement('div');
  el.className = 'profile-summary';
  el.innerHTML = `
    <div class="profile-summary-inner">
      <div>
        <strong>${escapeHtml(profile.city)}, ${escapeHtml(profile.country)}</strong>
        &nbsp;·&nbsp;${escapeHtml(profile.languages.join(', '))}
        &nbsp;·&nbsp;${escapeHtml(profile.scannerType)}
      </div>
      <button id="edit-profile-btn" class="btn-secondary">Edit profile</button>
    </div>
  `;
  return el;
}

// ─── LANGUAGE DROPDOWN OPTIONS ────────────────────────────────────────────────
// Populates the language filter <select> dynamically from the full book list.
// Keeps the "All languages" option and appends the rest alphabetically.
export function populateLanguageDropdown(
  select: HTMLSelectElement,
  languages: string[],
  currentValue: string
): void {
  // Preserve the first "All languages" option, replace the rest
  select.innerHTML = '<option value="">All languages</option>';
  for (const lang of languages) {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = lang;
    if (lang === currentValue) opt.selected = true;
    select.appendChild(opt);
  }
}

// ─── WATCH COUNT ──────────────────────────────────────────────────────────────
// Updates the watched-count badge in the header. Called after every watch toggle.
export function updateWatchCount(el: HTMLElement, count: number): void {
  el.textContent = count === 0 ? '' : `${count} watched`;
  el.style.display = count === 0 ? 'none' : 'inline';
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// Prevents XSS when inserting user-supplied strings into innerHTML.
// The admin form lets users type arbitrary book titles — we must escape them.
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── ADMIN BOOK FORM RESET ────────────────────────────────────────────────────
// Clears the add-book form after a successful submission so it's ready for
// the next entry without the user having to delete each field manually.
export function resetAddBookForm(form: HTMLFormElement): void {
  form.reset();
}

// ─── RENDER WATCHED PANEL ─────────────────────────────────────────────────────
// Builds the list of watched books shown in the sidebar panel.
// If no books are watched, shows an instructional message instead.
export function renderWatchedPanel(
  container: HTMLElement,
  allBooks: BookRequest[],
  watchedIds: Set<string>
): void {
  container.innerHTML = '';

  const watched = allBooks.filter(b => watchedIds.has(b.id));

  if (watched.length === 0) {
    container.innerHTML = '<p class="empty-watched">No books watched yet. Click "Watch this book" on any result.</p>';
    return;
  }

  for (const book of watched) {
    const row = document.createElement('div');
    row.className = 'watched-row';
    row.innerHTML = `
      <span class="watched-title">${escapeHtml(book.title)}</span>
      <button class="unwatch-btn" data-id="${book.id}" aria-label="Stop watching">✕</button>
    `;
    container.appendChild(row);
  }
}
