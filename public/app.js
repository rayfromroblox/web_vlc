/* web_vlc — server-owned media library + browser player */

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', 'ogv'
]);

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma'
]);

const PLAYBACK_RATE_MIN = 0.5;

const PLAYBACK_RATE_MAX = 2;

const DEFAULT_PREFERENCES = {
  theme: 'system',
  accent: 'orange',
  density: 'comfortable',
  glass: true,
  reduceMotion: false,
  seekStep: 10,
  playbackRate: 1
};

const THEME_CHOICES = ['system', 'light', 'dark'];

const ACCENT_CHOICES = ['orange', 'blue', 'violet', 'green', 'rose'];

const DENSITY_CHOICES = ['comfortable', 'compact'];

const SEEK_STEP_CHOICES = [5, 10, 15, 30];

const INITIAL_VISIBLE_MEDIA = 72;

const MEDIA_RENDER_BATCH = 72;

const MAX_RENDERED_QUEUE_ITEMS = 60;

const MAX_TAG_CHIPS = 24;

let searchRenderTimer = null;

let loadMoreObserver = null;

let lastMediaPositionBucket = -1;

function storedPreference(key, allowedValues, fallback) {
  try {
    const value = localStorage.getItem(key);

    return allowedValues.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function storedNumber(key, fallback) {
  try {
    const value = Number.parseFloat(localStorage.getItem(key));

    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function storedPreferences() {
  try {
    return JSON.parse(localStorage.getItem('webvlc:prefs') || 'null');
  } catch {
    return null;
  }
}

// Preferences arrive as decoded JSON: primitives keep their global
// constructors, so identity checks plus a whitelist decode each field.
function normalizePreferences(value) {
  const preferences = { ...DEFAULT_PREFERENCES };

  if (value?.constructor !== Object) return preferences;

  if (THEME_CHOICES.includes(value.theme)) preferences.theme = value.theme;

  if (ACCENT_CHOICES.includes(value.accent)) preferences.accent = value.accent;

  if (DENSITY_CHOICES.includes(value.density)) preferences.density = value.density;

  if (SEEK_STEP_CHOICES.includes(value.seekStep)) preferences.seekStep = value.seekStep;

  if (value.glass?.constructor === Boolean) preferences.glass = value.glass;

  if (value.reduceMotion?.constructor === Boolean) preferences.reduceMotion = value.reduceMotion;

  if (value.playbackRate?.constructor === Number && Number.isFinite(value.playbackRate)) {
    preferences.playbackRate = Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, Math.round(value.playbackRate * 100) / 100));
  }

  return preferences;
}

const state = {
  media: [],
  library: { folders: [], ffmpegAvailable: false, preferences: DEFAULT_PREFERENCES },
  preferences: normalizePreferences(storedPreferences()),
  dropped: [],
  search: '',
  mediaFilter: 'all',
  selectedTag: null,
  view: storedPreference('webvlc:view', ['grid', 'list'], 'grid'),
  sort: storedPreference('webvlc:sort', ['name-asc', 'name-desc', 'newest', 'favorites'], 'name-asc'),
  loading: true,
  currentId: null,
  queue: [],
  contextId: null,
  editingId: null,
  deletingId: null,
  shuffle: false,
  repeat: false,
  dragDepth: 0,
  visibleCount: INITIAL_VISIBLE_MEDIA,
  transcodeAttempts: new Set(),
  dropCounter: 0,
  folderBusy: false,
  browserPath: null
};

const dom = {
  body: document.body,
  searchInput: document.getElementById('searchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  addFolderBtn: document.getElementById('addFolderBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  brandLink: document.getElementById('brandLink'),
  mediaFilters: document.getElementById('mediaFilters'),
  sortSelect: document.getElementById('sortSelect'),
  viewGridBtn: document.getElementById('viewGridBtn'),
  viewListBtn: document.getElementById('viewListBtn'),
  resultCount: document.getElementById('resultCount'),
  tagBar: document.getElementById('tagBar'),
  loading: document.getElementById('loading'),
  libraryContent: document.getElementById('libraryContent'),
  emptyState: document.getElementById('emptyState'),
  emptyTitle: document.getElementById('emptyTitle'),
  emptyMessage: document.getElementById('emptyMessage'),
  emptyHint: document.getElementById('emptyHint'),
  emptyAddFolderBtn: document.getElementById('emptyAddFolderBtn'),
  playerWindow: document.getElementById('playerWindow'),
  playerVideo: document.getElementById('playerVideo'),
  videoCanvas: document.getElementById('videoCanvas'),
  canvasPlayBtn: document.getElementById('canvasPlayBtn'),
  playerMessage: document.getElementById('playerMessage'),
  playerMessageTitle: document.getElementById('playerMessageTitle'),
  playerMessageDetail: document.getElementById('playerMessageDetail'),
  playerNativeBtn: document.getElementById('playerNativeBtn'),
  playerTitle: document.getElementById('playerTitle'),
  playerMeta: document.getElementById('playerMeta'),
  playerArtwork: document.getElementById('playerArtwork'),
  playerPlayBtn: document.getElementById('playerPlayBtn'),
  playerPrevBtn: document.getElementById('playerPrevBtn'),
  playerNextBtn: document.getElementById('playerNextBtn'),
  playerBackBtn: document.getElementById('playerBackBtn'),
  playerForwardBtn: document.getElementById('playerForwardBtn'),
  playerSeek: document.getElementById('playerSeek'),
  playerCurrentTime: document.getElementById('playerCurrentTime'),
  playerDuration: document.getElementById('playerDuration'),
  playerMuteBtn: document.getElementById('playerMuteBtn'),
  playerVolume: document.getElementById('playerVolume'),
  rateControl: document.getElementById('rateControl'),
  ratePopover: document.getElementById('ratePopover'),
  playbackRateBtn: document.getElementById('playbackRateBtn'),
  playbackRateRange: document.getElementById('playbackRateRange'),
  rateValue: document.getElementById('rateValue'),
  ratePresets: document.getElementById('ratePresets'),
  repeatBtn: document.getElementById('repeatBtn'),
  shuffleBtn: document.getElementById('shuffleBtn'),
  playerCloseBtn: document.getElementById('playerCloseBtn'),
  playerPipBtn: document.getElementById('playerPipBtn'),
  playerFullscreenBtn: document.getElementById('playerFullscreenBtn'),
  queueList: document.getElementById('queueList'),
  queueCount: document.getElementById('queueCount'),
  queueToggleBtn: document.getElementById('queueToggleBtn'),
  queueBadge: document.getElementById('queueBadge'),
  queueCloseBtn: document.getElementById('queueCloseBtn'),
  contextMenu: document.getElementById('contextMenu'),
  editDialog: document.getElementById('editDialog'),
  editForm: document.getElementById('editForm'),
  editFilename: document.getElementById('editFilename'),
  editExtension: document.getElementById('editExtension'),
  editTags: document.getElementById('editTags'),
  saveEditBtn: document.getElementById('saveEditBtn'),
  confirmDialog: document.getElementById('confirmDialog'),
  confirmForm: document.getElementById('confirmForm'),
  confirmFilename: document.getElementById('confirmFilename'),
  confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
  settingsDialog: document.getElementById('settingsDialog'),
  themeControl: document.getElementById('themeControl'),
  accentControl: document.getElementById('accentControl'),
  densityControl: document.getElementById('densityControl'),
  seekStepControl: document.getElementById('seekStepControl'),
  glassToggle: document.getElementById('glassToggle'),
  motionToggle: document.getElementById('motionToggle'),
  settingsRate: document.getElementById('settingsRate'),
  settingsRateValue: document.getElementById('settingsRateValue'),
  folderList: document.getElementById('folderList'),
  addFolderSettingsBtn: document.getElementById('addFolderSettingsBtn'),
  rescanBtn: document.getElementById('rescanBtn'),
  folderPathForm: document.getElementById('folderPathForm'),
  folderPathInput: document.getElementById('folderPathInput'),
  ffmpegStatus: document.getElementById('ffmpegStatus'),
  folderBrowserDialog: document.getElementById('folderBrowserDialog'),
  browserPathForm: document.getElementById('browserPathForm'),
  browserPathInput: document.getElementById('browserPathInput'),
  browserQuick: document.getElementById('browserQuick'),
  browserList: document.getElementById('browserList'),
  browserUseBtn: document.getElementById('browserUseBtn'),
  browserError: document.getElementById('browserError'),
  dropOverlay: document.getElementById('dropOverlay'),
  toastRegion: document.getElementById('toastRegion')
};

function icon(name) {
  return `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function setButtonIcon(button, name) {
  const use = button.querySelector('use');

  if (use) use.setAttribute('href', `#i-${name}`);
}

/* ---------- Preferences ---------- */

function mirrorPreferences() {
  try {
    localStorage.setItem('webvlc:prefs', JSON.stringify(state.preferences));
  } catch {
    // Preference mirroring is optional.
  }
}

function formatRate(rate) {
  return `${Number(rate.toFixed(2))}×`;
}

function paintRange(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;

  input.style.setProperty('--fill', `${Math.round(Math.min(100, Math.max(0, fill)) * 100) / 100}%`);
}

function applySeekStep() {
  const step = state.preferences.seekStep;
  const label = `${step} seconds`;

  [dom.playerBackBtn, dom.playerForwardBtn].forEach((button) => {
    button.querySelector('svg text').textContent = String(step);
  });
  dom.playerBackBtn.title = `Back ${label}`;
  dom.playerBackBtn.setAttribute('aria-label', `Back ${label}`);
  dom.playerForwardBtn.title = `Forward ${label}`;
  dom.playerForwardBtn.setAttribute('aria-label', `Forward ${label}`);
}

function updateRateUi() {
  const rate = state.preferences.playbackRate;

  dom.playbackRateBtn.textContent = formatRate(rate);
  dom.playbackRateRange.value = String(rate);
  paintRange(dom.playbackRateRange);
  dom.rateValue.textContent = formatRate(rate);
  dom.ratePresets.querySelectorAll('[data-rate]').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.rate) === rate);
  });
}

function applyPreferences() {
  const preferences = state.preferences;
  const root = document.documentElement;

  const resolvedTheme = preferences.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preferences.theme;

  root.dataset.theme = resolvedTheme;
  root.dataset.accent = preferences.accent;
  root.dataset.density = preferences.density;
  root.dataset.glass = preferences.glass ? 'on' : 'off';
  root.dataset.motion = preferences.reduceMotion ? 'reduce' : 'auto';

  if (state.currentId) dom.playerVideo.playbackRate = preferences.playbackRate;

  applySeekStep();
  updateRateUi();
}

function setRatePopover(open) {
  dom.ratePopover.hidden = !open;
  dom.playbackRateBtn.setAttribute('aria-expanded', String(open));
}

function setPlaybackRate(rate, { persist = false } = {}) {
  const clamped = Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, Math.round(rate * 100) / 100));

  state.preferences.playbackRate = clamped;
  dom.playerVideo.playbackRate = clamped;
  updateRateUi();

  if (persist) updatePreference({ playbackRate: clamped });
}

function syncPreferenceControls() {
  const preferences = state.preferences;

  dom.themeControl.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.classList.toggle('active', button.dataset.themeChoice === preferences.theme);
  });
  dom.accentControl.querySelectorAll('[data-accent-choice]').forEach((button) => {
    button.classList.toggle('active', button.dataset.accentChoice === preferences.accent);
  });
  dom.densityControl.querySelectorAll('[data-density-choice]').forEach((button) => {
    button.classList.toggle('active', button.dataset.densityChoice === preferences.density);
  });
  dom.seekStepControl.querySelectorAll('[data-seek-step]').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.seekStep) === preferences.seekStep);
  });
  dom.glassToggle.setAttribute('aria-checked', String(preferences.glass));
  dom.motionToggle.setAttribute('aria-checked', String(preferences.reduceMotion));
  dom.settingsRate.value = String(preferences.playbackRate);
  paintRange(dom.settingsRate);
  dom.settingsRateValue.textContent = formatRate(preferences.playbackRate);
}

let preferenceRequest = 0;

async function updatePreference(patch) {
  const request = ++preferenceRequest;
  const previous = state.preferences;

  state.preferences = normalizePreferences({ ...previous, ...patch });
  mirrorPreferences();
  applyPreferences();
  syncPreferenceControls();

  try {
    const data = await fetchJson('/library/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.preferences)
    });

    if (request !== preferenceRequest) return;

    state.preferences = normalizePreferences(data.preferences);
    mirrorPreferences();
    applyPreferences();
    syncPreferenceControls();
  } catch (error) {
    if (request !== preferenceRequest) return;

    state.preferences = previous;
    mirrorPreferences();
    applyPreferences();
    syncPreferenceControls();
    showToast(`Could not save settings: ${error.message}`, 'error');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function extensionOf(filename) {
  const dot = filename.lastIndexOf('.');

  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

function splitExtension(filename) {
  const dot = filename.lastIndexOf('.');

  return dot > 0
    ? { base: filename.slice(0, dot), extension: filename.slice(dot) }
    : { base: filename, extension: '' };
}

function normalizeServerMedia(item) {
  const mediaType = item.mediaType === 'audio' || AUDIO_EXTENSIONS.has(extensionOf(item.filename)) ? 'audio' : 'video';
  const thumbnailVersion = encodeURIComponent(item.modifiedAt || item.lastSeen || '');

  return {
    id: `m${item.id}`,
    serverId: Number(item.id),
    filename: item.filename,
    tags: Array.isArray(item.tags) ? item.tags : [],
    favorite: Boolean(item.favorite),
    thumbnailUrl: mediaType === 'video' ? `/thumbnail/${item.id}?v=${thumbnailVersion}` : null,
    mediaType,
    extension: (item.extension || extensionOf(item.filename)).toLowerCase(),
    size: Number(item.size) || 0,
    modifiedAt: item.modifiedAt || item.lastSeen || null,
    available: item.available !== false,
    folder: item.folder || '',
    relativePath: item.relativePath || item.filename,
    drop: false,
    url: `/video/${item.id}`,
    transcodeUrl: null
  };
}

function findMedia(id) {
  const mediaId = String(id);

  return state.media.find((item) => item.id === mediaId)
    || state.dropped.find((item) => item.id === mediaId)
    || null;
}

function allLibraryMedia() {
  return state.media;
}

function resetVisibleMedia() {
  state.visibleCount = INITIAL_VISIBLE_MEDIA;
  loadMoreObserver?.disconnect();
}

function compareName(a, b) {
  return a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' });
}

function timestampOf(item) {
  const parsed = Date.parse(item.modifiedAt || '');

  return Number.isFinite(parsed) ? parsed : 0;
}

function getFilteredMedia() {
  const query = state.search.trim().toLocaleLowerCase();

  const items = allLibraryMedia().filter((item) => {
    if (query) {
      const haystack = `${item.filename} ${item.tags.join(' ')} ${item.extension} ${item.relativePath}`.toLocaleLowerCase();

      if (!haystack.includes(query)) return false;
    }

    if (state.mediaFilter === 'favorites' && !item.favorite) return false;

    if ((state.mediaFilter === 'video' || state.mediaFilter === 'audio') && item.mediaType !== state.mediaFilter) return false;

    if (state.selectedTag && !item.tags.includes(state.selectedTag)) return false;

    return true;
  });

  items.sort((a, b) => {
    if (state.sort === 'name-desc') return compareName(b, a);

    if (state.sort === 'newest') return timestampOf(b) - timestampOf(a) || compareName(a, b);

    if (state.sort === 'favorites') return Number(b.favorite) - Number(a.favorite) || compareName(a, b);

    return compareName(a, b);
  });

  return items;
}

function tagCounts() {
  const counts = new Map();
  allLibraryMedia().forEach((item) => {
    item.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
  });

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/* ---------- Rendering ---------- */

function placeholderMarkup(item) {
  const mediaIcon = item.mediaType === 'audio' ? 'music' : 'film';

  return `<div class="card-placeholder${item.mediaType === 'audio' ? ' audio-placeholder' : ''}">${icon(mediaIcon)}</div>`;
}

function thumbnailMarkup(item) {
  if (!item.thumbnailUrl) return placeholderMarkup(item);

  return `<span class="thumb-frame">${placeholderMarkup(item)}<img class="media-thumb" data-media-thumb src="${escapeHtml(item.thumbnailUrl)}" alt="" loading="lazy" decoding="async"></span>`;
}

function tagMarkup(tags, limit = 3) {
  if (!tags.length) return '<span class="card-tag untagged">untagged</span>';
  const visible = tags.slice(0, limit).map((tag) => `<span class="card-tag">${escapeHtml(tag.replaceAll('_', ' '))}</span>`).join('');
  const remaining = tags.length - limit;

  return visible + (remaining > 0 ? `<span class="card-tag">+${remaining}</span>` : '');
}

function cardSub(item) {
  const parts = [String(item.extension || item.mediaType).toUpperCase()];

  if (item.size) parts.push(formatBytes(item.size));
  const date = formatRelativeDate(item.modifiedAt);

  if (date && date !== '—') parts.push(date);

  if (item.drop) parts.unshift('Dropped');

  return parts.join(' · ');
}

function gridCardMarkup(item) {
  const isCurrent = state.currentId === item.id;
  const playing = isCurrent && !dom.playerVideo.paused;

  return `
    <article class="media-card${isCurrent ? ' is-current' : ''}" data-id="${item.id}">
      <button class="card-visual" type="button" data-action="play" aria-label="Play ${escapeHtml(item.filename)}">
        ${thumbnailMarkup(item)}
        <span class="card-badge">${escapeHtml(item.extension || item.mediaType)}</span>
        ${item.available ? '' : '<span class="card-badge offline-badge">offline</span>'}
        <span class="card-play">${icon(playing ? 'pause' : 'play')}</span>
      </button>
      <button class="card-star${item.favorite ? ' active' : ''}" type="button" data-action="favorite" aria-label="${item.favorite ? 'Remove from favorites' : 'Add to favorites'}">${icon('star')}</button>
      <button class="card-menu" type="button" data-action="menu" aria-label="More options">${icon('more')}</button>
      <div class="card-body">
        <button class="card-title" type="button" data-action="play" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</button>
        <p class="card-sub">${escapeHtml(cardSub(item))}</p>
        <div class="card-tags">${tagMarkup(item.tags)}</div>
      </div>
    </article>
  `;
}

function listRowMarkup(item) {
  const isCurrent = state.currentId === item.id;
  const playing = isCurrent && !dom.playerVideo.paused;
  const parts = [String(item.extension || item.mediaType).toUpperCase()];
  const date = formatRelativeDate(item.modifiedAt);

  if (item.relativePath && item.relativePath !== item.filename) parts.push(item.relativePath);

  if (date && date !== '—') parts.push(date);

  if (!item.available) parts.push('offline');

  return `
    <div class="media-row${isCurrent ? ' is-current' : ''}" data-id="${item.id}">
      <div class="row-media">
        <div class="row-thumb">
          ${thumbnailMarkup(item)}
          <button class="row-play" type="button" data-action="play" aria-label="Play">${icon(playing ? 'pause' : 'play')}</button>
        </div>
        <button class="row-title-wrap" type="button" data-action="play" title="${escapeHtml(item.filename)}">
          <strong>${escapeHtml(item.filename)}</strong>
          <small>${escapeHtml(parts.join(' · '))}</small>
        </button>
      </div>
      <div class="row-actions">
        <button class="row-action-button row-star${item.favorite ? ' active' : ''}" type="button" data-action="favorite" aria-label="${item.favorite ? 'Remove from favorites' : 'Add to favorites'}">${icon('star')}</button>
        <button class="row-action-button" type="button" data-action="menu" aria-label="More options">${icon('more')}</button>
      </div>
    </div>
  `;
}

function wireThumbnailFallbacks(container) {
  container.querySelectorAll('img[data-media-thumb]').forEach((image) => {
    image.addEventListener('error', () => {
      if (image.dataset.thumbRetry !== '1') {
        image.dataset.thumbRetry = '1';
        const retryUrl = new URL(image.src, window.location.href);

        retryUrl.searchParams.set('retry', '1');
        setTimeout(() => {
          image.src = retryUrl.href;
        }, 2500);

        return;
      }

      image.classList.add('is-hidden');
    });
  });
}

function loadMoreMarkup(remainingCount) {
  if (remainingCount <= 0) return '';
  const nextCount = Math.min(MEDIA_RENDER_BATCH, remainingCount);

  return `
    <div class="load-more-sentinel" data-load-more>
      <button class="button" type="button">Show ${nextCount} more</button>
      <span>${remainingCount} not shown</span>
    </div>`;
}

function showMoreMedia() {
  state.visibleCount += MEDIA_RENDER_BATCH;
  renderContent();
}

function wireProgressiveRendering() {
  loadMoreObserver?.disconnect();
  const sentinel = dom.libraryContent.querySelector('[data-load-more]');

  if (!sentinel) return;
  sentinel.querySelector('button')?.addEventListener('click', showMoreMedia, { once: true });

  if (!('IntersectionObserver' in window)) return;
  loadMoreObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) showMoreMedia();
  }, { rootMargin: '500px 0px' });
  loadMoreObserver.observe(sentinel);
}

function renderEmptyState() {
  const folders = state.library.folders || [];

  if (!folders.length) {
    dom.emptyTitle.textContent = 'Add a media folder';
    dom.emptyMessage.textContent = 'web_vlc indexes everything inside the folder you pick — subfolders included. Nothing leaves this machine.';
    dom.emptyHint.textContent = 'Videos and audio play right in your browser.';

    return;
  }

  const available = folders.filter((folder) => folder.available).length;
  dom.emptyTitle.textContent = 'No media found yet';
  dom.emptyMessage.textContent = available
    ? `Checked ${available} folder${available === 1 ? '' : 's'} and found no audio or video files. Add another folder, or rescan from Settings if you just added files.`
    : 'Your media folders are not reachable right now. Reconnect the drive, then rescan from Settings.';
  dom.emptyHint.textContent = '';
}

function renderContent() {
  loadMoreObserver?.disconnect();
  dom.loading.hidden = !state.loading;

  if (state.loading) {
    dom.libraryContent.innerHTML = '';
    dom.emptyState.hidden = true;

    return;
  }

  const items = getFilteredMedia();
  const visibleItems = items.slice(0, state.visibleCount);
  const remainingCount = items.length - visibleItems.length;
  dom.resultCount.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

  if (!state.media.length) {
    dom.libraryContent.innerHTML = '';
    dom.emptyState.hidden = false;
    renderEmptyState();

    return;
  }

  dom.emptyState.hidden = true;

  if (!items.length) {
    dom.libraryContent.innerHTML = `
      <div class="empty-filter-state">
        ${icon('search')}
        <strong>Nothing matches</strong>
        <p>Try another search, tag, or media type.</p>
      </div>`;

    return;
  }

  if (state.view === 'list') {
    dom.libraryContent.innerHTML = `
      <div class="media-list">${visibleItems.map(listRowMarkup).join('')}</div>
      ${loadMoreMarkup(remainingCount)}`;
  } else {
    dom.libraryContent.innerHTML = `
      <div class="media-grid">${visibleItems.map(gridCardMarkup).join('')}</div>
      ${loadMoreMarkup(remainingCount)}`;
  }

  wireThumbnailFallbacks(dom.libraryContent);
  wireProgressiveRendering();
}

function renderTagBar() {
  const tags = tagCounts();

  if (state.selectedTag && !tags.some(([tag]) => tag === state.selectedTag)) {
    tags.unshift([state.selectedTag, 0]);
  }

  if (!tags.length) {
    dom.tagBar.hidden = true;
    dom.tagBar.innerHTML = '';

    return;
  }

  dom.tagBar.hidden = false;
  dom.tagBar.innerHTML = tags.slice(0, MAX_TAG_CHIPS).map(([tag, count]) => `
    <button class="tag-chip${state.selectedTag === tag ? ' active' : ''}" type="button" data-tag="${escapeHtml(tag)}">
      ${escapeHtml(tag.replaceAll('_', ' '))} <small>${count}</small>
    </button>
  `).join('');
}

function renderControls() {
  document.querySelectorAll('[data-media-filter]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mediaFilter === state.mediaFilter);
  });
  dom.sortSelect.value = state.sort;
  dom.viewGridBtn.classList.toggle('active', state.view === 'grid');
  dom.viewListBtn.classList.toggle('active', state.view === 'list');
  dom.viewGridBtn.setAttribute('aria-pressed', String(state.view === 'grid'));
  dom.viewListBtn.setAttribute('aria-pressed', String(state.view === 'list'));
  dom.clearSearchBtn.hidden = !dom.searchInput.value;
}

function renderSettings() {
  const folders = state.library.folders || [];

  syncPreferenceControls();
  dom.folderList.innerHTML = folders.length
    ? folders.map((folder) => `
        <div class="folder-row">
          <span class="folder-icon">${icon('folder')}</span>
          <div class="folder-copy">
            <strong>${escapeHtml(folder.name || folder.path)}</strong>
            <small title="${escapeHtml(folder.path)}">${escapeHtml(folder.path)}</small>
          </div>
          <span class="folder-count">${folder.count} item${folder.count === 1 ? '' : 's'}</span>
          <span class="folder-state${folder.available ? '' : ' offline'}" title="${folder.available ? 'Available' : 'Not reachable'}"></span>
          <button class="icon-button" type="button" data-remove-folder="${escapeHtml(folder.path)}" aria-label="Remove folder">${icon('trash')}</button>
        </div>`).join('')
    : '<p class="folder-empty">No folders yet. Add the folder where your videos and audio live.</p>';

  dom.ffmpegStatus.textContent = state.library.ffmpegAvailable
    ? 'Video thumbnails and format conversion are enabled.'
    : 'FFmpeg was not detected — video thumbnails and playback conversion are unavailable. Install FFmpeg from ffmpeg.org and restart web_vlc to enable them.';
  dom.ffmpegStatus.classList.toggle('warn', !state.library.ffmpegAvailable);
}

function renderApp() {
  renderControls();
  renderTagBar();
  renderContent();
  renderQueue();
}

function setFolderBusy(busy) {
  state.folderBusy = busy;
  [dom.addFolderBtn, dom.emptyAddFolderBtn, dom.addFolderSettingsBtn, dom.browserUseBtn].forEach((button) => {
    button.disabled = busy;
    button.classList.toggle('is-loading', busy);
  });
}

/* ---------- Server communication ---------- */

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

  return data;
}

function applyLibrary(library) {
  if (!library) return;

  state.library = library;

  if (library.preferences) {
    state.preferences = normalizePreferences(library.preferences);
    mirrorPreferences();
    applyPreferences();
  }
}

async function loadLibrary({ quiet = false } = {}) {
  if (!quiet) {
    state.loading = true;
    renderContent();
  }

  try {
    const data = await fetchJson('/videos');
    state.media = (data.videos || []).map(normalizeServerMedia);
    applyLibrary(data.library);
    resetVisibleMedia();
  } catch (error) {
    showToast(`Could not reach the media server: ${error.message}`, 'error');
  } finally {
    state.loading = false;
    renderApp();

    if (!dom.settingsDialog.open) renderSettings();
  }
}

async function addFolderByPath(folderPath) {
  try {
    const data = await fetchJson('/library/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath })
    });

    applyLibrary(data.library);
    await loadLibrary({ quiet: true });
    const name = data.path.split(/[/\\]/).filter(Boolean).pop() || data.path;

    if (data.added === false) {
      showToast(`${name} is already in your library`);
    } else {
      const added = data.scan?.inserted || 0;
      showToast(`Added ${name} · ${added} new item${added === 1 ? '' : 's'} indexed`);
    }

    return true;
  } catch (error) {
    showToast(error.message, 'error');

    return false;
  }
}

async function addFolderFlow() {
  if (state.folderBusy) return;
  setFolderBusy(true);
  let picked = { unsupported: true };

  try {
    picked = await fetchJson('/library/pick-folder', { method: 'POST' });
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setFolderBusy(false);
  }

  if (picked.cancelled) return;

  if (picked.path) {
    await addFolderByPath(picked.path);

    return;
  }

  openFolderBrowser();
}

function folderChipLabel(folderPath, home) {
  if (folderPath === home) return 'Home';
  const trimmed = folderPath.replace(/[/\\]+$/, '');

  return trimmed.split(/[/\\]/).pop() || folderPath;
}

async function loadBrowserPath(targetPath) {
  dom.browserError.hidden = true;

  try {
    const query = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
    const data = await fetchJson(`/library/browse${query}`);
    state.browserPath = data.path;
    renderFolderBrowser(data);
  } catch (error) {
    dom.browserError.textContent = error.message;
    dom.browserError.hidden = false;
  }
}

function renderFolderBrowser(data) {
  dom.browserPathInput.value = data.path;

  const chips = [...data.quickLocations, ...data.roots]
    .filter((entry, index, list) => list.indexOf(entry) === index && entry !== data.path);

  dom.browserQuick.innerHTML = chips
    .map((entry) => `<button type="button" data-dir-path="${escapeHtml(entry)}">${escapeHtml(folderChipLabel(entry, data.home))}</button>`)
    .join('');

  const rows = [];

  if (data.parent) {
    rows.push(`<button class="browser-row parent" type="button" data-dir-path="${escapeHtml(data.parent)}">${icon('up')}<span>Parent folder</span></button>`);
  }

  if (data.directories.length) {
    rows.push(...data.directories.map((directory) => `
      <button class="browser-row" type="button" data-dir-path="${escapeHtml(directory.path)}">${icon('folder')}<span>${escapeHtml(directory.name)}</span></button>
    `));
  } else {
    rows.push('<p class="browser-empty">No subfolders here — you can still use this folder.</p>');
  }

  dom.browserList.innerHTML = rows.join('');
}

function openFolderBrowser() {
  dom.browserError.hidden = true;
  dom.browserQuick.innerHTML = '';
  dom.browserList.innerHTML = '<p class="browser-loading">Loading folders…</p>';

  if (!dom.folderBrowserDialog.open) dom.folderBrowserDialog.showModal();
  loadBrowserPath(state.browserPath || '');
}

async function removeFolder(folderPath) {
  try {
    const data = await fetchJson('/library/folders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath })
    });

    applyLibrary(data.library);
    await loadLibrary({ quiet: true });
    const offline = data.scan?.markedMissing || 0;
    showToast(offline
      ? `Folder removed · ${offline} item${offline === 1 ? '' : 's'} now offline`
      : 'Folder removed');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function rescanLibrary() {
  if (dom.rescanBtn.disabled) return;
  dom.rescanBtn.disabled = true;
  dom.rescanBtn.classList.add('is-loading');

  try {
    const data = await fetchJson('/scan', { method: 'POST' });
    applyLibrary(data.library);
    await loadLibrary({ quiet: true });
    showToast(`Scan complete · ${data.scan?.inserted || 0} new · ${data.scan?.markedMissing || 0} offline`);
  } catch (error) {
    showToast(`Scan failed: ${error.message}`, 'error');
  } finally {
    dom.rescanBtn.disabled = false;
    dom.rescanBtn.classList.remove('is-loading');
  }
}

/* ---------- Library interactions ---------- */

function updateSearch(value) {
  state.search = value.trim();
  resetVisibleMedia();

  if (searchRenderTimer) clearTimeout(searchRenderTimer);

  const renderSearch = () => {
    searchRenderTimer = null;
    renderContent();
  };

  if (!value) renderSearch();
  else searchRenderTimer = setTimeout(renderSearch, 80);
  dom.clearSearchBtn.hidden = !value;
}

function resetLibrary() {
  state.search = '';
  state.mediaFilter = 'all';
  state.selectedTag = null;
  resetVisibleMedia();
  dom.searchInput.value = '';
  renderApp();
}

function setView(view) {
  state.view = view;
  resetVisibleMedia();

  try { localStorage.setItem('webvlc:view', view); } catch { /* preference storage is optional */ }

  renderControls();
  renderContent();
}

function handleLibraryAction(action, id, trigger) {
  const item = findMedia(id);

  if (!item) return;

  if (action === 'play') {
    if (state.currentId === item.id) togglePlayback();
    else openPlayer(item.id);
  } else if (action === 'favorite') {
    toggleFavorite(item.id);
  } else if (action === 'menu') {
    openContextMenu(item.id, trigger);
  }
}

function openContextMenu(id, trigger) {
  const item = findMedia(id);

  if (!item) return;
  state.contextId = item.id;
  dom.contextMenu.hidden = false;
  dom.contextMenu.querySelector('[data-menu-action="favorite"] span').textContent = item.favorite ? 'Remove from favorites' : 'Add to favorites';
  ['favorite', 'edit', 'native', 'delete'].forEach((action) => {
    dom.contextMenu.querySelector(`[data-menu-action="${action}"]`).disabled = item.drop;
  });

  document.querySelectorAll('[data-action="menu"].active').forEach((button) => button.classList.remove('active'));
  trigger.classList.add('active');

  const rect = trigger.getBoundingClientRect();
  const menuWidth = 224;
  const menuHeight = dom.contextMenu.offsetHeight;
  const left = Math.min(Math.max(8, rect.right - menuWidth), window.innerWidth - menuWidth - 8);
  let top = rect.bottom + 7;

  if (top + menuHeight > window.innerHeight - 8) top = rect.top - menuHeight - 7;
  dom.contextMenu.style.left = `${left}px`;
  dom.contextMenu.style.top = `${Math.max(8, top)}px`;
}

function closeContextMenu() {
  dom.contextMenu.hidden = true;
  state.contextId = null;
  document.querySelectorAll('[data-action="menu"].active').forEach((button) => button.classList.remove('active'));
}

function syncFavoriteUi(item) {
  const button = dom.libraryContent.querySelector(`[data-id="${item.id}"] [data-action="favorite"]`);

  if (!button) return;

  button.classList.toggle('active', item.favorite);
  button.setAttribute('aria-label', item.favorite ? 'Remove from favorites' : 'Add to favorites');
}

async function toggleFavorite(id) {
  const item = findMedia(id);

  if (!item || item.drop) return;

  const previous = item.favorite;
  item.favorite = !previous;
  syncFavoriteUi(item);

  if (state.mediaFilter === 'favorites') renderContent();

  try {
    const data = await fetchJson(`/favorite/${item.serverId}`, { method: 'POST' });
    item.favorite = Boolean(data.favorite);
    syncFavoriteUi(item);
  } catch (error) {
    item.favorite = previous;
    syncFavoriteUi(item);
    showToast(`Could not update favorite: ${error.message}`, 'error');
  }

  if (state.mediaFilter === 'favorites') renderContent();
}

function openEditDialog(id) {
  const item = findMedia(id);

  if (!item || item.drop) return;
  state.editingId = item.id;
  const parts = splitExtension(item.filename);
  dom.editFilename.value = parts.base;
  dom.editExtension.textContent = parts.extension;
  dom.editTags.value = item.tags.join(', ');
  dom.editDialog.showModal();
  requestAnimationFrame(() => dom.editFilename.select());
}

async function saveEdit(event) {
  event.preventDefault();
  const item = findMedia(state.editingId);

  if (!item || item.drop) return;

  const parts = splitExtension(item.filename);
  const nextBase = dom.editFilename.value.trim();
  const nextName = nextBase + parts.extension;
  const nextTags = [...new Set(dom.editTags.value.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))];

  if (!nextBase) {
    showToast('Name cannot be empty', 'error');

    return;
  }

  dom.saveEditBtn.disabled = true;

  try {
    if (nextName !== item.filename) {
      const renamed = await fetchJson(`/rename/${item.serverId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName: nextName })
      });

      const oldExtension = item.extension;
      item.filename = renamed.filename;
      item.extension = extensionOf(renamed.filename);

      if (oldExtension !== item.extension) item.thumbnailUrl = null;
    }

    const removed = item.tags.filter((tag) => !nextTags.includes(tag));
    const added = nextTags.filter((tag) => !item.tags.includes(tag));

    for (const tag of removed) {
      await fetchJson(`/tags/${item.serverId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', tag })
      });
    }

    for (const tag of added) {
      await fetchJson(`/tags/${item.serverId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', tag })
      });
    }

    item.tags = nextTags;
    dom.editDialog.close();
    showToast('Saved');
    renderApp();
  } catch (error) {
    showToast(`Could not save changes: ${error.message}`, 'error');
    await loadLibrary({ quiet: true });
  } finally {
    dom.saveEditBtn.disabled = false;
  }
}

function openDeleteDialog(id) {
  const item = findMedia(id);

  if (!item || item.drop) return;
  state.deletingId = item.id;
  dom.confirmFilename.textContent = item.filename;
  dom.confirmDialog.showModal();
}

async function deleteMedia(event) {
  event.preventDefault();
  const item = findMedia(state.deletingId);

  if (!item || item.drop) return;
  dom.confirmDeleteBtn.disabled = true;

  try {
    await fetchJson(`/delete/${item.serverId}`, { method: 'POST' });
    state.media = state.media.filter((media) => media.id !== item.id);

    if (state.currentId === item.id) closePlayer();
    dom.confirmDialog.close();
    showToast('File deleted from disk');
    renderApp();
  } catch (error) {
    showToast(`Delete failed: ${error.message}`, 'error');
  } finally {
    dom.confirmDeleteBtn.disabled = false;
  }
}

async function openInDesktop(id) {
  const item = findMedia(id);

  if (!item || item.drop) return;

  try {
    await fetchJson(`/open/${item.serverId}`, { method: 'POST' });
    showToast('Opening in your desktop player');
  } catch (error) {
    showToast(`Could not open the file: ${error.message}`, 'error');
  }
}

/* ---------- Dropped files (play without importing) ---------- */

function isSupportedFile(file) {
  const extension = extensionOf(file.name);

  return file.type.startsWith('video/') || file.type.startsWith('audio/') || VIDEO_EXTENSIONS.has(extension) || AUDIO_EXTENSIONS.has(extension);
}

function clearDroppedMedia() {
  if (!state.dropped.length) return;
  const ids = new Set(state.dropped.map((item) => item.id));

  if (ids.has(state.currentId)) closePlayer();
  else state.queue = state.queue.filter((id) => !ids.has(id));
  state.dropped.forEach((item) => {
    URL.revokeObjectURL(item.url);

    if (item.transcodeUrl?.startsWith('blob:')) URL.revokeObjectURL(item.transcodeUrl);
  });
  state.dropped = [];
}

async function playDroppedFiles(fileList) {
  const files = [...fileList].filter((file) => file && isSupportedFile(file));

  if (!files.length) {
    showToast('No playable audio or video in that drop', 'error');

    return;
  }

  clearDroppedMedia();
  state.dropped = files.map((file) => {
    const extension = extensionOf(file.name);

    return {
      id: `drop-${++state.dropCounter}`,
      serverId: null,
      filename: file.name,
      tags: [],
      favorite: false,
      thumbnailUrl: null,
      mediaType: AUDIO_EXTENSIONS.has(extension) ? 'audio' : 'video',
      extension,
      size: file.size,
      modifiedAt: null,
      available: true,
      folder: '',
      relativePath: file.name,
      drop: true,
      file,
      url: URL.createObjectURL(file),
      transcodeUrl: null
    };
  });
  openPlayer(state.dropped[0].id, { queue: state.dropped.map((item) => item.id) });
  showToast(files.length === 1
    ? 'Playing dropped file — not added to your library'
    : `Playing ${files.length} dropped files — not added to your library`);
}

/* ---------- Player ---------- */

function buildQueue(id) {
  const item = findMedia(id);

  if (item?.drop) return state.dropped.map((entry) => entry.id);
  let items = getFilteredMedia();

  if (!items.some((entry) => entry.id === id)) items = allLibraryMedia();

  return [...items.map((entry) => entry.id), ...state.dropped.map((entry) => entry.id)];
}

function playerSource(item) {
  return item.transcodeUrl || item.url;
}

function playerMetaText(item, suffix = '') {
  const base = `${String(item.extension || item.mediaType).toUpperCase()}${item.size ? ` · ${formatBytes(item.size)}` : ''}${item.available ? '' : ' · offline'}${item.drop ? ' · dropped' : ''}`;

  return suffix ? `${base} · ${suffix}` : base;
}

function openPlayer(id, { autoplay = true, preserveQueue = false, queue = null } = {}) {
  const item = findMedia(id);

  if (!item) return;

  if (Array.isArray(queue)) state.queue = [...queue];
  else if (!preserveQueue) state.queue = buildQueue(item.id);

  if (!state.queue.includes(item.id)) state.queue.push(item.id);

  state.currentId = item.id;
  dom.playerMessage.hidden = true;
  dom.playerMessageTitle.textContent = 'Unable to play this file';
  dom.playerMessageDetail.textContent = 'The file may be offline or use a codec your browser does not support.';
  dom.playerNativeBtn.hidden = true;
  state.transcodeAttempts.delete(item.id);
  dom.playerWindow.classList.remove('is-idle');
  dom.videoCanvas.classList.toggle('is-audio', item.mediaType === 'audio');
  dom.videoCanvas.classList.remove('is-playing');
  dom.playerTitle.textContent = item.filename;
  dom.playerMeta.textContent = playerMetaText(item);
  updatePlayerArtwork(item);

  dom.playerVideo.pause();
  dom.playerVideo.src = playerSource(item);
  dom.playerVideo.playbackRate = state.preferences.playbackRate;
  dom.playerVideo.load();
  resetTimeline();
  lastMediaPositionBucket = -1;
  setPlayerControlsEnabled(true);
  dom.playerPipBtn.disabled = item.mediaType === 'audio' || !document.pictureInPictureEnabled;
  renderQueue();
  syncCurrentMediaCard();
  updateMediaSession(item);

  if (autoplay) {
    dom.playerVideo.play().catch(() => {
      updatePlaybackUi(false);
    });
  }

  if (window.matchMedia?.('(max-width: 1019px)').matches) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function updatePlayerArtwork(item) {
  const image = dom.playerArtwork.querySelector('img');
  const glyph = dom.playerArtwork.querySelector('svg');

  if (item.thumbnailUrl) {
    image.src = item.thumbnailUrl;
    image.hidden = false;
    glyph.hidden = true;
    image.onerror = () => {
      image.hidden = true;
      glyph.hidden = false;
    };
  } else {
    image.removeAttribute('src');
    image.hidden = true;
    glyph.hidden = false;
    glyph.querySelector('use')?.setAttribute('href', `#i-${item.mediaType === 'audio' ? 'music' : 'film'}`);
  }
}

function showPlayerMessage(title, detail, item = null) {
  dom.playerMessageTitle.textContent = title;
  dom.playerMessageDetail.textContent = detail;
  dom.playerNativeBtn.hidden = !item || item.drop;

  if (item) {
    dom.playerMeta.textContent = title === 'Preparing a compatible video'
      ? 'Converting for playback…'
      : `${String(item.extension || '').toUpperCase()} · video unavailable`;
  }

  dom.playerMessage.hidden = false;
}

function showAudioTrack(item) {
  dom.videoCanvas.classList.add('is-audio');
  dom.playerPipBtn.disabled = true;
  dom.playerMessage.hidden = true;
  dom.playerMeta.textContent = playerMetaText(item, 'audio');
  updatePlaybackUi(!dom.playerVideo.paused);
}

function tryCompatiblePlayback(item) {
  if (!item || item.mediaType !== 'video') return false;

  if (item.drop && item.transcodePending) return true;

  if (!item.drop && state.transcodeAttempts.has(item.id)) return false;
  state.transcodeAttempts.add(item.id);
  showPlayerMessage(
    'Preparing a compatible video',
    item.drop ? 'Converting the dropped file for playback…' : 'This browser cannot display the video codec. Converting a local playback stream…',
    item
  );

  if (item.drop) {
    item.transcodePending = true;
    fetch('/transcode-local', {
      method: 'POST',
      headers: { 'Content-Type': item.file.type || 'application/octet-stream' },
      body: item.file
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Local conversion failed');
      item.transcodeUrl = URL.createObjectURL(await response.blob());
      item.transcodePending = false;

      if (state.currentId !== item.id) {
        URL.revokeObjectURL(item.transcodeUrl);
        item.transcodeUrl = null;

        return;
      }

      dom.playerVideo.src = playerSource(item);
      dom.playerVideo.load();
      dom.playerVideo.play().catch(() => {});
    }).catch((error) => {
      item.transcodePending = false;

      if (state.currentId === item.id) {
        showPlayerMessage('Video conversion failed', error.message, item);
        updatePlaybackUi(false);
      }
    });
  } else {
    dom.playerVideo.src = `${item.url}?transcode=1`;
    dom.playerVideo.load();
    dom.playerVideo.play().catch(() => {});
  }

  return true;
}

function setPlayerControlsEnabled(enabled) {
  [
    dom.playerPlayBtn, dom.canvasPlayBtn, dom.playerPrevBtn, dom.playerNextBtn,
    dom.playerBackBtn, dom.playerForwardBtn, dom.playerSeek, dom.playerMuteBtn,
    dom.playerVolume, dom.playbackRateBtn, dom.repeatBtn, dom.shuffleBtn,
    dom.playerCloseBtn, dom.playerPipBtn, dom.playerFullscreenBtn
  ].forEach((control) => { control.disabled = !enabled; });

  if (!enabled) setRatePopover(false);
}

function syncCurrentMediaCard() {
  dom.libraryContent.querySelectorAll('.is-current').forEach((element) => element.classList.remove('is-current'));
  dom.libraryContent.querySelectorAll('.card-play use, .row-play use').forEach((use) => use.setAttribute('href', '#i-play'));

  if (!state.currentId) return;

  const card = dom.libraryContent.querySelector(`[data-id="${state.currentId}"]`);

  if (!card) return;

  card.classList.add('is-current');

  const playIcon = card.querySelector('.card-play use, .row-play use');

  if (playIcon && !dom.playerVideo.paused) playIcon.setAttribute('href', '#i-pause');
}

function togglePlayback() {
  if (!state.currentId) {
    const first = getFilteredMedia()[0] || allLibraryMedia()[0];

    if (first) openPlayer(first.id);

    return;
  }

  if (dom.playerVideo.paused) dom.playerVideo.play().catch(() => {});
  else dom.playerVideo.pause();
}

function updatePlaybackUi(isPlaying) {
  dom.playerWindow.classList.toggle('is-paused', !isPlaying);
  dom.videoCanvas.classList.toggle('is-playing', isPlaying);
  setButtonIcon(dom.playerPlayBtn, isPlaying ? 'pause' : 'play');
  setButtonIcon(dom.canvasPlayBtn, isPlaying ? 'pause' : 'play');
  dom.playerPlayBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  dom.canvasPlayBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');

  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  document.querySelectorAll('.card-play use, .row-play use').forEach((use) => {
    const owner = use.closest('[data-id]');

    if (owner?.dataset.id === state.currentId) use.setAttribute('href', `#i-${isPlaying ? 'pause' : 'play'}`);
  });
  const activeBars = dom.queueList.querySelector('.queue-item.active .queue-playing');

  if (activeBars) activeBars.hidden = !isPlaying;
}

function closePlayer() {
  dom.playerVideo.pause();
  dom.playerVideo.removeAttribute('src');
  dom.playerVideo.load();
  state.currentId = null;
  state.queue = [];
  setQueueOpen(false);
  dom.playerWindow.classList.add('is-idle');
  dom.playerTitle.textContent = 'No media selected';
  dom.playerMeta.textContent = 'Ready';
  dom.playerMessage.hidden = true;
  dom.playerNativeBtn.hidden = true;
  dom.videoCanvas.classList.remove('is-audio', 'is-playing');
  resetTimeline();
  setPlayerControlsEnabled(false);
  syncCurrentMediaCard();
  renderQueue();

  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}

function setQueueOpen(open) {
  dom.playerWindow.classList.toggle('queue-open', open);
  dom.queueToggleBtn.classList.toggle('active', open);
  dom.queueToggleBtn.setAttribute('aria-expanded', String(open));

  if (open) renderQueue();
  else dom.queueList.innerHTML = '';
}

function seekBy(seconds) {
  if (!state.currentId || !Number.isFinite(dom.playerVideo.duration)) return;
  dom.playerVideo.currentTime = Math.max(0, Math.min(dom.playerVideo.duration, dom.playerVideo.currentTime + seconds));
}

function queueIndex() {
  return state.queue.indexOf(state.currentId);
}

function playAdjacent(direction) {
  if (!state.queue.length) return;
  let nextIndex;

  if (state.shuffle && state.queue.length > 1) {
    do {
      nextIndex = Math.floor(Math.random() * state.queue.length);
    } while (nextIndex === queueIndex());
  } else {
    nextIndex = (queueIndex() + direction + state.queue.length) % state.queue.length;
  }

  openPlayer(state.queue[nextIndex], { preserveQueue: true });
}

function resetTimeline() {
  dom.playerSeek.value = 0;
  dom.playerSeek.style.setProperty('--fill', '0%');
  dom.playerCurrentTime.textContent = '0:00';
  dom.playerDuration.textContent = '0:00';
}

function updateTimeline() {
  const duration = Number.isFinite(dom.playerVideo.duration) ? dom.playerVideo.duration : 0;
  const current = Number.isFinite(dom.playerVideo.currentTime) ? dom.playerVideo.currentTime : 0;
  const progress = duration ? (current / duration) * 1000 : 0;
  dom.playerSeek.value = progress;
  dom.playerSeek.style.setProperty('--fill', `${progress / 10}%`);
  dom.playerCurrentTime.textContent = formatTime(current);
  dom.playerDuration.textContent = formatTime(duration);
}

function updateVolumeUi() {
  const volume = dom.playerVideo.muted ? 0 : Math.round(dom.playerVideo.volume * 100);
  dom.playerVolume.value = volume;
  dom.playerVolume.style.setProperty('--fill', `${volume}%`);
  setButtonIcon(dom.playerMuteBtn, volume === 0 ? 'mute' : 'volume');
  dom.playerMuteBtn.setAttribute('aria-label', volume === 0 ? 'Unmute' : 'Mute');
}

function renderQueue() {
  const ids = state.currentId ? state.queue : [];
  const currentIndex = Math.max(0, ids.indexOf(state.currentId));
  const startIndex = Math.max(0, currentIndex - 5);
  const renderedIds = ids.slice(startIndex, startIndex + MAX_RENDERED_QUEUE_ITEMS);
  const items = renderedIds.map(findMedia).filter(Boolean);
  dom.queueCount.textContent = `${ids.length} item${ids.length === 1 ? '' : 's'}`;
  dom.queueBadge.textContent = String(ids.length);
  dom.queueBadge.hidden = !ids.length;
  dom.queueToggleBtn.disabled = !ids.length;

  if (!dom.playerWindow.classList.contains('queue-open')) {
    dom.queueList.innerHTML = '';

    return;
  }

  dom.queueList.innerHTML = items.map((item) => {
    const active = item.id === state.currentId;

    return `
      <button class="queue-item${active ? ' active' : ''}" type="button" data-queue-id="${item.id}">
        <span class="queue-thumb">${thumbnailMarkup(item)}</span>
        <span class="queue-copy"><strong>${escapeHtml(item.filename)}</strong><small>${escapeHtml(item.extension || item.mediaType)}</small></span>
        ${active ? `<span class="queue-playing"${dom.playerVideo.paused ? ' hidden' : ''}><i></i><i></i><i></i></span>` : ''}
      </button>`;
  }).join('') + (ids.length > renderedIds.length
    ? `<p class="queue-truncated">Showing ${items.length} of ${ids.length}</p>`
    : '');
  wireThumbnailFallbacks(dom.queueList);
}

async function togglePictureInPicture() {
  if (!state.currentId || !document.pictureInPictureEnabled || dom.playerVideo.readyState < 1) {
    showToast('Picture in picture is not available for this media', 'error');

    return;
  }

  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await dom.playerVideo.requestPictureInPicture();
  } catch (error) {
    showToast(`Picture in picture failed: ${error.message}`, 'error');
  }
}

async function toggleFullscreen() {
  if (!state.currentId) return;

  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();

      return;
    }

    await dom.playerWindow.requestFullscreen();
  } catch (error) {
    showToast(`Fullscreen failed: ${error.message}`, 'error');
  }
}

function updateMediaSession(item) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  const artwork = item.thumbnailUrl ? [{ src: new URL(item.thumbnailUrl, window.location.href).href }] : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: item.filename,
    artist: item.drop ? 'Dropped file' : (item.folder || 'web_vlc library'),
    album: item.tags.slice(0, 2).join(' · ') || 'Local media',
    artwork
  });
}

function updateMediaPositionState() {
  if (!('mediaSession' in navigator) || !Number.isFinite(dom.playerVideo.duration) || dom.playerVideo.duration <= 0) return;

  try {
    navigator.mediaSession.setPositionState({
      duration: dom.playerVideo.duration,
      playbackRate: dom.playerVideo.playbackRate,
      position: Math.min(dom.playerVideo.currentTime, dom.playerVideo.duration)
    });
  } catch {
    // Some browsers reject position updates while media is loading.
  }
}

/* ---------- Formatting ---------- */

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);

  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatRelativeDate(value) {
  if (!value) return '—';
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '—';
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);

  if (days <= 0) return 'Today';

  if (days === 1) return 'Yesterday';

  if (days < 7) return `${days} days ago`;

  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' error' : ''}`;
  toast.innerHTML = `${icon(type === 'error' ? 'info' : 'check')}<span>${escapeHtml(message)}</span>`;
  dom.toastRegion.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 200);
  }, 3200);
}

/* ---------- Events ---------- */

dom.searchInput.addEventListener('input', (event) => updateSearch(event.target.value));

dom.clearSearchBtn.addEventListener('click', () => {
  dom.searchInput.value = '';
  updateSearch('');
  dom.searchInput.focus();
});

dom.brandLink.addEventListener('click', (event) => {
  event.preventDefault();
  resetLibrary();
});

dom.mediaFilters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-media-filter]');

  if (!button) return;
  state.mediaFilter = button.dataset.mediaFilter;
  resetVisibleMedia();
  renderControls();
  renderContent();
});

dom.sortSelect.addEventListener('change', (event) => {
  state.sort = event.target.value;
  resetVisibleMedia();

  try { localStorage.setItem('webvlc:sort', state.sort); } catch { /* preference storage is optional */ }

  renderContent();
});

dom.viewGridBtn.addEventListener('click', () => setView('grid'));

dom.viewListBtn.addEventListener('click', () => setView('list'));

dom.addFolderBtn.addEventListener('click', addFolderFlow);

dom.emptyAddFolderBtn.addEventListener('click', addFolderFlow);

dom.addFolderSettingsBtn.addEventListener('click', addFolderFlow);

dom.tagBar.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]');

  if (!button) return;
  state.selectedTag = state.selectedTag === button.dataset.tag ? null : button.dataset.tag;
  resetVisibleMedia();
  renderTagBar();
  renderContent();
});

dom.settingsBtn.addEventListener('click', () => {
  renderSettings();
  dom.settingsDialog.showModal();
});

dom.themeControl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-theme-choice]');

  if (button) updatePreference({ theme: button.dataset.themeChoice });
});

dom.accentControl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-accent-choice]');

  if (button) updatePreference({ accent: button.dataset.accentChoice });
});

dom.densityControl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-density-choice]');

  if (button) updatePreference({ density: button.dataset.densityChoice });
});

dom.seekStepControl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-seek-step]');

  if (button) updatePreference({ seekStep: Number(button.dataset.seekStep) });
});

dom.glassToggle.addEventListener('click', () => updatePreference({ glass: !state.preferences.glass }));

dom.motionToggle.addEventListener('click', () => updatePreference({ reduceMotion: !state.preferences.reduceMotion }));

dom.settingsRate.addEventListener('input', () => {
  setPlaybackRate(Number(dom.settingsRate.value));
  paintRange(dom.settingsRate);
  dom.settingsRateValue.textContent = formatRate(state.preferences.playbackRate);
});

dom.settingsRate.addEventListener('change', () => updatePreference({ playbackRate: Number(dom.settingsRate.value) }));

dom.folderPathForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const folderPath = dom.folderPathInput.value.trim();

  if (!folderPath) return;
  const added = await addFolderByPath(folderPath);

  if (added) dom.folderPathInput.value = '';
});

dom.folderList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-folder]');

  if (button) removeFolder(button.dataset.removeFolder);
});

dom.rescanBtn.addEventListener('click', rescanLibrary);

const handleBrowserNavigation = (event) => {
  const button = event.target.closest('[data-dir-path]');

  if (button) loadBrowserPath(button.dataset.dirPath);
};

dom.browserQuick.addEventListener('click', handleBrowserNavigation);

dom.browserList.addEventListener('click', handleBrowserNavigation);

dom.browserPathForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadBrowserPath(dom.browserPathInput.value.trim());
});

dom.browserUseBtn.addEventListener('click', async () => {
  if (!state.browserPath) return;
  const added = await addFolderByPath(state.browserPath);

  if (added) dom.folderBrowserDialog.close();
});

dom.libraryContent.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-action]');

  if (!trigger) return;
  const owner = trigger.closest('[data-id]');

  if (owner) handleLibraryAction(trigger.dataset.action, owner.dataset.id, trigger);
});

dom.libraryContent.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-action="play"]')) {
    event.preventDefault();
    const owner = event.target.closest('[data-id]');

    if (owner) handleLibraryAction('play', owner.dataset.id, event.target);
  }
});

dom.contextMenu.addEventListener('click', (event) => {
  const button = event.target.closest('[data-menu-action]');
  const id = state.contextId;

  if (!button || !id) return;
  const action = button.dataset.menuAction;
  closeContextMenu();

  if (action === 'play') openPlayer(id);

  if (action === 'favorite') toggleFavorite(id);

  if (action === 'edit') openEditDialog(id);

  if (action === 'native') openInDesktop(id);

  if (action === 'delete') openDeleteDialog(id);
});

document.addEventListener('pointerdown', (event) => {
  if (dom.contextMenu.hidden) return;
  const target = event.target instanceof Element ? event.target : null;

  if (target && (dom.contextMenu.contains(target) || target.closest('[data-action="menu"]'))) return;
  closeContextMenu();
});

document.addEventListener('pointerdown', (event) => {
  if (dom.ratePopover.hidden) return;
  const target = event.target instanceof Element ? event.target : null;

  if (target && dom.rateControl.contains(target)) return;
  setRatePopover(false);
});

window.addEventListener('resize', closeContextMenu);

window.addEventListener('scroll', closeContextMenu, { passive: true });

document.querySelectorAll('[data-dialog-close]').forEach((button) => {
  button.addEventListener('click', () => document.getElementById(button.dataset.dialogClose)?.close());
});

dom.editForm.addEventListener('submit', saveEdit);

dom.confirmForm.addEventListener('submit', deleteMedia);

[dom.editDialog, dom.confirmDialog, dom.folderBrowserDialog, dom.settingsDialog].forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
});

dom.playerPlayBtn.addEventListener('click', togglePlayback);

dom.canvasPlayBtn.addEventListener('click', togglePlayback);

dom.playerVideo.addEventListener('click', togglePlayback);

dom.playerVideo.addEventListener('dblclick', toggleFullscreen);

dom.playerPrevBtn.addEventListener('click', () => playAdjacent(-1));

dom.playerNextBtn.addEventListener('click', () => playAdjacent(1));

dom.playerBackBtn.addEventListener('click', () => seekBy(-state.preferences.seekStep));

dom.playerForwardBtn.addEventListener('click', () => seekBy(state.preferences.seekStep));

dom.playerSeek.addEventListener('input', () => {
  if (Number.isFinite(dom.playerVideo.duration)) dom.playerVideo.currentTime = (dom.playerSeek.value / 1000) * dom.playerVideo.duration;
  dom.playerSeek.style.setProperty('--fill', `${dom.playerSeek.value / 10}%`);
});

dom.playerMuteBtn.addEventListener('click', () => {
  dom.playerVideo.muted = !dom.playerVideo.muted;
  updateVolumeUi();
});

dom.playerVolume.addEventListener('input', () => {
  dom.playerVideo.volume = Number(dom.playerVolume.value) / 100;
  dom.playerVideo.muted = Number(dom.playerVolume.value) === 0;

  try { localStorage.setItem('webvlc:volume', String(dom.playerVideo.volume)); } catch { /* optional */ }

  updateVolumeUi();
});

dom.playbackRateBtn.addEventListener('click', () => setRatePopover(dom.ratePopover.hidden));

dom.playbackRateRange.addEventListener('input', () => setPlaybackRate(Number(dom.playbackRateRange.value)));

dom.playbackRateRange.addEventListener('change', () => setPlaybackRate(Number(dom.playbackRateRange.value), { persist: true }));

dom.ratePresets.addEventListener('click', (event) => {
  const button = event.target.closest('[data-rate]');

  if (!button) return;
  setPlaybackRate(Number(button.dataset.rate), { persist: true });
});

dom.repeatBtn.addEventListener('click', () => {
  state.repeat = !state.repeat;
  dom.playerVideo.loop = state.repeat;
  dom.repeatBtn.classList.toggle('active', state.repeat);
  showToast(state.repeat ? 'Repeat on' : 'Repeat off');
});

dom.shuffleBtn.addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  dom.shuffleBtn.classList.toggle('active', state.shuffle);
  showToast(state.shuffle ? 'Shuffle on' : 'Shuffle off');
});

dom.playerCloseBtn.addEventListener('click', closePlayer);

dom.queueToggleBtn.addEventListener('click', () => {
  setQueueOpen(!dom.playerWindow.classList.contains('queue-open'));
});

dom.queueCloseBtn.addEventListener('click', () => setQueueOpen(false));

dom.playerPipBtn.addEventListener('click', togglePictureInPicture);

dom.playerFullscreenBtn.addEventListener('click', toggleFullscreen);

dom.queueList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-queue-id]');

  if (!button) return;
  setQueueOpen(false);
  openPlayer(button.dataset.queueId, { preserveQueue: true });
});

dom.playerVideo.addEventListener('play', () => updatePlaybackUi(true));

dom.playerVideo.addEventListener('pause', () => updatePlaybackUi(false));

dom.playerVideo.addEventListener('loadedmetadata', () => {
  updateTimeline();
  updateMediaPositionState();
  const item = findMedia(state.currentId);

  if (item?.mediaType === 'video' && dom.playerVideo.videoWidth === 0 && dom.playerVideo.videoHeight === 0) {
    const convertedSource = Boolean(item.transcodeUrl) || dom.playerVideo.currentSrc.includes('transcode=1');

    if (convertedSource) {
      showAudioTrack(item);

      return;
    }

    if (!tryCompatiblePlayback(item)) {
      showAudioTrack(item);
    }
  } else if (item?.mediaType === 'video') {
    dom.playerMessage.hidden = true;
    dom.videoCanvas.classList.remove('is-audio');
    dom.playerMeta.textContent = playerMetaText(item);
  }
});

dom.playerVideo.addEventListener('timeupdate', () => {
  updateTimeline();
  const positionBucket = Math.floor(dom.playerVideo.currentTime / 5);

  if (positionBucket !== lastMediaPositionBucket) {
    lastMediaPositionBucket = positionBucket;
    updateMediaPositionState();
  }
});

dom.playerVideo.addEventListener('ended', () => {
  if (!state.repeat && state.queue.length > 1) playAdjacent(1);
});

dom.playerVideo.addEventListener('error', () => {
  if (!state.currentId) return;
  const item = findMedia(state.currentId);
  const alreadyTranscoding = dom.playerVideo.src.includes('transcode=1');

  if (!alreadyTranscoding && tryCompatiblePlayback(item)) return;
  showPlayerMessage('Unable to play this file', 'Try the desktop player for this codec.', item);
  updatePlaybackUi(false);
});

dom.playerVideo.addEventListener('volumechange', updateVolumeUi);

dom.playerNativeBtn.addEventListener('click', () => openInDesktop(state.currentId));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !dom.ratePopover.hidden) {
    setRatePopover(false);

    return;
  }

  const target = event.target instanceof Element ? event.target : document.body;
  const typing = target.matches('input, textarea, select') || target.closest('dialog');

  if (typing) {
    if (event.key === 'Escape' && event.target === dom.searchInput) {
      dom.searchInput.value = '';
      updateSearch('');
      dom.searchInput.blur();
    }

    return;
  }

  if (event.key === '/') {
    event.preventDefault();
    dom.searchInput.focus();
    dom.searchInput.select();
  } else if (event.key === ' ' && state.currentId) {
    event.preventDefault();
    togglePlayback();
  } else if (event.key === 'ArrowLeft' && state.currentId) {
    event.preventDefault();
    seekBy(event.ctrlKey || event.metaKey ? -30 : -5);
  } else if (event.key === 'ArrowRight' && state.currentId) {
    event.preventDefault();
    seekBy(event.ctrlKey || event.metaKey ? 30 : 5);
  } else if ((event.key === 'm' || event.key === 'M') && state.currentId) {
    dom.playerMuteBtn.click();
  } else if ((event.key === 'f' || event.key === 'F') && state.currentId) {
    event.preventDefault();
    toggleFullscreen();
  } else if ((event.key === 'n' || event.key === 'N') && state.currentId) {
    playAdjacent(1);
  } else if ((event.key === 'p' || event.key === 'P') && state.currentId) {
    playAdjacent(-1);
  } else if (event.key === 'Escape') {
    closeContextMenu();
    setQueueOpen(false);
  }
});

window.addEventListener('dragenter', (event) => {
  if (![...event.dataTransfer.types].includes('Files')) return;
  event.preventDefault();
  state.dragDepth += 1;
  dom.dropOverlay.classList.add('active');
});

window.addEventListener('dragover', (event) => {
  if ([...event.dataTransfer.types].includes('Files')) event.preventDefault();
});

window.addEventListener('dragleave', (event) => {
  event.preventDefault();
  state.dragDepth = Math.max(0, state.dragDepth - 1);

  if (state.dragDepth === 0) dom.dropOverlay.classList.remove('active');
});

window.addEventListener('drop', (event) => {
  event.preventDefault();
  state.dragDepth = 0;
  dom.dropOverlay.classList.remove('active');
  playDroppedFiles(event.dataTransfer.files);
});

window.addEventListener('beforeunload', () => {
  state.dropped.forEach((item) => URL.revokeObjectURL(item.url));
});

if ('mediaSession' in navigator) {
  const safeHandler = (action, handler) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
  };

  safeHandler('play', () => dom.playerVideo.play());
  safeHandler('pause', () => dom.playerVideo.pause());
  safeHandler('previoustrack', () => playAdjacent(-1));
  safeHandler('nexttrack', () => playAdjacent(1));
  safeHandler('seekbackward', (details) => seekBy(-(details.seekOffset || state.preferences.seekStep)));
  safeHandler('seekforward', (details) => seekBy(details.seekOffset || state.preferences.seekStep));
  safeHandler('seekto', (details) => { dom.playerVideo.currentTime = details.seekTime || 0; });
}

/* ---------- Boot ---------- */

setPlayerControlsEnabled(false);

dom.sortSelect.value = state.sort;

dom.playerVideo.volume = Math.min(1, Math.max(0, storedNumber('webvlc:volume', 0.85)));

applyPreferences();

updateVolumeUi();

renderControls();

renderSettings();

loadLibrary();

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.preferences.theme === 'system') applyPreferences();
});
