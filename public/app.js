/* web_vlc — local-first media library and player */

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', 'ogv'
]);
const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma'
]);
const PLAYBACK_RATES = [1, 1.25, 1.5, 2, 0.75];

const state = {
  serverMedia: [],
  sessionMedia: [],
  search: '',
  section: 'all',
  selectedTag: null,
  mediaFilter: 'all',
  view: localStorage.getItem('webvlc:view') || 'grid',
  sort: localStorage.getItem('webvlc:sort') || 'name-asc',
  loading: true,
  config: null,
  currentId: null,
  queue: [],
  contextId: null,
  editingId: null,
  deletingId: null,
  expanded: false,
  shuffle: false,
  repeat: false,
  rateIndex: 0,
  localCounter: 0,
  dragDepth: 0
};

const dom = {
  body: document.body,
  searchInput: document.getElementById('searchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  globalSearch: document.querySelector('.global-search'),
  rescanBtn: document.getElementById('rescanBtn'),
  emptyScanBtn: document.getElementById('emptyScanBtn'),
  filePicker: document.getElementById('filePicker'),
  sidebarToggle: document.getElementById('sidebarToggle'),
  sidebarScrim: document.getElementById('sidebarScrim'),
  tagNavigation: document.getElementById('tagNavigation'),
  allCount: document.getElementById('allCount'),
  favoriteCount: document.getElementById('favoriteCount'),
  tagCount: document.getElementById('tagCount'),
  libraryPath: document.getElementById('libraryPath'),
  sourceState: document.getElementById('sourceState'),
  connectionPill: document.getElementById('connectionPill'),
  connectionLabel: document.getElementById('connectionLabel'),
  libraryEyebrow: document.getElementById('libraryEyebrow'),
  libraryTitle: document.getElementById('libraryTitle'),
  librarySubtitle: document.getElementById('librarySubtitle'),
  summaryMedia: document.getElementById('summaryMedia'),
  summaryFavorites: document.getElementById('summaryFavorites'),
  summaryFormats: document.getElementById('summaryFormats'),
  resultCount: document.getElementById('resultCount'),
  mediaFilters: document.getElementById('mediaFilters'),
  sortSelect: document.getElementById('sortSelect'),
  viewGridBtn: document.getElementById('viewGridBtn'),
  viewListBtn: document.getElementById('viewListBtn'),
  loading: document.getElementById('loading'),
  libraryContent: document.getElementById('libraryContent'),
  emptyState: document.getElementById('emptyState'),
  emptyTitle: document.getElementById('emptyTitle'),
  emptyMessage: document.getElementById('emptyMessage'),
  playerWindow: document.getElementById('playerWindow'),
  playerVideo: document.getElementById('playerVideo'),
  videoCanvas: document.getElementById('videoCanvas'),
  audioVisual: document.getElementById('audioVisual'),
  playerMessage: document.getElementById('playerMessage'),
  stageTitle: document.getElementById('stageTitle'),
  playerTitle: document.getElementById('playerTitle'),
  playerMeta: document.getElementById('playerMeta'),
  playerArtwork: document.getElementById('playerArtwork'),
  playerPlayBtn: document.getElementById('playerPlayBtn'),
  canvasPlayBtn: document.getElementById('canvasPlayBtn'),
  playerPrevBtn: document.getElementById('playerPrevBtn'),
  playerNextBtn: document.getElementById('playerNextBtn'),
  playerBackBtn: document.getElementById('playerBackBtn'),
  playerForwardBtn: document.getElementById('playerForwardBtn'),
  playerSeek: document.getElementById('playerSeek'),
  playerCurrentTime: document.getElementById('playerCurrentTime'),
  playerDuration: document.getElementById('playerDuration'),
  playerMuteBtn: document.getElementById('playerMuteBtn'),
  playerVolume: document.getElementById('playerVolume'),
  playbackRateBtn: document.getElementById('playbackRateBtn'),
  repeatBtn: document.getElementById('repeatBtn'),
  shuffleBtn: document.getElementById('shuffleBtn'),
  playerExpandBtn: document.getElementById('playerExpandBtn'),
  dockExpandBtn: document.getElementById('dockExpandBtn'),
  playerCollapseBtn: document.getElementById('playerCollapseBtn'),
  playerCloseBtn: document.getElementById('playerCloseBtn'),
  playerPipBtn: document.getElementById('playerPipBtn'),
  playerFullscreenBtn: document.getElementById('playerFullscreenBtn'),
  queueList: document.getElementById('queueList'),
  queueCount: document.getElementById('queueCount'),
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

function mediaTypeFrom(filename, suppliedType) {
  if (suppliedType === 'audio' || suppliedType === 'video') return suppliedType;
  return AUDIO_EXTENSIONS.has(extensionOf(filename)) ? 'audio' : 'video';
}

function normalizeServerMedia(item) {
  return {
    id: `server-${item.id}`,
    serverId: Number(item.id),
    filename: item.filename,
    tags: Array.isArray(item.tags) ? item.tags : [],
    favorite: Boolean(item.favorite),
    hasThumbnail: Boolean(item.hasThumbnail),
    thumbnailUrl: item.hasThumbnail ? `/thumbnail/${item.id}` : null,
    mediaType: mediaTypeFrom(item.filename, item.mediaType),
    extension: extensionOf(item.filename),
    size: Number(item.size) || 0,
    modifiedAt: item.modifiedAt || item.lastSeen || null,
    available: item.available !== false,
    local: false,
    url: `/video/${item.id}`
  };
}

function allMedia() {
  return [...state.sessionMedia, ...state.serverMedia];
}

function findMedia(id) {
  return allMedia().find((item) => item.id === String(id));
}

function compareName(a, b) {
  return a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' });
}

function timestampOf(item) {
  const parsed = Date.parse(item.modifiedAt || '');
  return Number.isFinite(parsed) ? parsed : (item.serverId || 0);
}

function getFilteredMedia() {
  const query = state.search.trim().toLocaleLowerCase();
  let items = allMedia().filter((item) => {
    if (query) {
      const haystack = `${item.filename} ${item.tags.join(' ')} ${item.extension}`.toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (state.section === 'favorites' && !item.favorite) return false;
    if (state.selectedTag && !item.tags.includes(state.selectedTag)) return false;
    if (state.mediaFilter !== 'all' && item.mediaType !== state.mediaFilter) return false;
    return true;
  });

  const sortMode = state.section === 'recent' ? 'newest' : state.sort;
  items.sort((a, b) => {
    if (sortMode === 'name-desc') return compareName(b, a);
    if (sortMode === 'newest') return timestampOf(b) - timestampOf(a) || compareName(a, b);
    if (sortMode === 'favorites') return Number(b.favorite) - Number(a.favorite) || compareName(a, b);
    return compareName(a, b);
  });

  if (state.section === 'recent') items = items.slice(0, 30);
  return items;
}

function tagCounts() {
  const counts = new Map();
  allMedia().forEach((item) => {
    item.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function renderSidebar() {
  const items = allMedia();
  const tags = tagCounts();
  dom.allCount.textContent = items.length;
  dom.favoriteCount.textContent = items.filter((item) => item.favorite).length;
  dom.tagCount.textContent = `${tags.length} tag${tags.length === 1 ? '' : 's'}`;

  const visibleTags = tags.slice(0, 10);
  if (state.selectedTag && !visibleTags.some(([tag]) => tag === state.selectedTag)) {
    const selected = tags.find(([tag]) => tag === state.selectedTag);
    if (selected) visibleTags.unshift(selected);
  }

  dom.tagNavigation.innerHTML = visibleTags.map(([tag, count]) => `
    <button class="tag-nav-item${state.selectedTag === tag ? ' active' : ''}" type="button" data-tag="${escapeHtml(tag)}">
      <span class="tag-dot"></span>
      <span>${escapeHtml(tag.replaceAll('_', ' '))}</span>
      <span class="tag-nav-count">${count}</span>
    </button>
  `).join('');

  document.querySelectorAll('.nav-item[data-section]').forEach((button) => {
    button.classList.toggle('active', state.section === button.dataset.section && !state.selectedTag);
  });

  const config = state.config;
  if (config) {
    dom.libraryPath.textContent = config.displayPath || config.path || 'Media folder';
    dom.libraryPath.title = config.path || '';
    dom.sourceState.classList.toggle('offline', !config.available);
    dom.sourceState.title = config.available ? 'Folder connected' : 'Folder unavailable';
  }
}

function renderHeading() {
  let eyebrow = 'Your media, your machine';
  let title = 'All media';
  let subtitle = 'Everything in one beautifully organized, private library.';

  if (state.selectedTag) {
    eyebrow = 'Collection';
    title = `#${state.selectedTag.replaceAll('_', ' ')}`;
    subtitle = `Every item tagged ${state.selectedTag.replaceAll('_', ' ')}.`;
  } else if (state.section === 'favorites') {
    eyebrow = 'Hand-picked by you';
    title = 'Favorites';
    subtitle = 'The media you always want within reach.';
  } else if (state.section === 'recent') {
    eyebrow = 'Fresh from your library';
    title = 'Recently added';
    subtitle = 'Your newest media, ready to pick up and play.';
  }

  if (state.search) {
    eyebrow = 'Library search';
    title = 'Search results';
    subtitle = `Matching “${state.search}” across filenames, formats, and tags.`;
  }

  dom.libraryEyebrow.textContent = eyebrow;
  dom.libraryTitle.textContent = title;
  dom.librarySubtitle.textContent = subtitle;
}

function renderSummary() {
  const items = allMedia();
  const formats = new Set(items.map((item) => item.extension).filter(Boolean));
  dom.summaryMedia.textContent = items.length;
  dom.summaryFavorites.textContent = items.filter((item) => item.favorite).length;
  dom.summaryFormats.textContent = formats.size;
}

function placeholderMarkup(item, hidden = false) {
  const mediaIcon = item.mediaType === 'audio' ? 'music' : 'film';
  return `<div class="card-placeholder media-thumb-fallback${item.mediaType === 'audio' ? ' audio-placeholder' : ''}${hidden ? ' is-hidden' : ''}">${icon(mediaIcon)}</div>`;
}

function thumbnailMarkup(item) {
  if (!item.thumbnailUrl) return placeholderMarkup(item);
  return `<img class="media-thumb" data-media-thumb src="${escapeHtml(item.thumbnailUrl)}" alt="" loading="lazy">${placeholderMarkup(item, true)}`;
}

function tagMarkup(tags, limit = 3) {
  if (!tags.length) return '<span class="card-tag">untagged</span>';
  const visible = tags.slice(0, limit).map((tag) => `<span class="card-tag">${escapeHtml(tag.replaceAll('_', ' '))}</span>`).join('');
  const remaining = tags.length - limit;
  return visible + (remaining > 0 ? `<span class="card-tag-more">+${remaining}</span>` : '');
}

function gridCardMarkup(item) {
  const isCurrent = state.currentId === item.id;
  const favoriteClass = item.favorite ? ' active favorite-indicator' : '';
  return `
    <article class="media-card${isCurrent ? ' is-current' : ''}" data-id="${item.id}">
      <div class="card-visual" data-action="play">
        ${thumbnailMarkup(item)}
        <div class="card-top-actions">
          <button class="card-icon-button favorite${favoriteClass}" type="button" data-action="favorite" aria-label="${item.favorite ? 'Remove from favorites' : 'Add to favorites'}">${icon('star')}</button>
          <button class="card-icon-button" type="button" data-action="menu" aria-label="More options">${icon('more')}</button>
        </div>
        <button class="card-play" type="button" data-action="play" aria-label="Play">${icon(isCurrent && !dom.playerVideo.paused ? 'pause' : 'play')}</button>
        <span class="card-badge${item.local ? ' local-badge' : ''}">${item.local ? 'This device' : escapeHtml(item.extension || item.mediaType)}</span>
        ${item.available ? '' : '<span class="card-badge offline-badge">Offline</span>'}
      </div>
      <div class="card-info">
        <h3 class="card-title" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</h3>
        <span class="card-format">${escapeHtml(item.extension || item.mediaType)}</span>
        <div class="card-tags">${tagMarkup(item.tags)}</div>
      </div>
    </article>
  `;
}

function listRowMarkup(item) {
  const isCurrent = state.currentId === item.id;
  const status = item.available ? (item.local ? 'Session' : 'On disk') : 'Offline';
  return `
    <div class="media-row${isCurrent ? ' is-current' : ''}" data-id="${item.id}">
      <div class="row-media">
        <div class="row-thumb" data-action="play">
          ${thumbnailMarkup(item)}
          <button class="row-play" type="button" data-action="play" aria-label="Play">${icon(isCurrent && !dom.playerVideo.paused ? 'pause' : 'play')}</button>
        </div>
        <div class="row-title-wrap">
          <strong title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</strong>
          <small>${escapeHtml(item.extension || item.mediaType)}${item.size ? ` · ${formatBytes(item.size)}` : ''}</small>
        </div>
      </div>
      <div class="row-tags">${item.tags.length ? item.tags.slice(0, 3).map((tag) => `<span class="tag-pill">${escapeHtml(tag.replaceAll('_', ' '))}</span>`).join('') : '<span class="tag-pill">untagged</span>'}</div>
      <span class="row-added">${formatRelativeDate(item.modifiedAt)}</span>
      <span class="row-status${item.available ? '' : ' offline'}">${status}</span>
      <button class="icon-button row-menu-button" type="button" data-action="menu" aria-label="More options">${icon('more')}</button>
    </div>
  `;
}

function wireThumbnailFallbacks(container) {
  container.querySelectorAll('img[data-media-thumb]').forEach((image) => {
    image.addEventListener('error', () => {
      image.classList.add('is-hidden');
      image.nextElementSibling?.classList.remove('is-hidden');
    }, { once: true });
  });
}

function renderContent() {
  dom.loading.hidden = !state.loading;
  if (state.loading) {
    dom.libraryContent.innerHTML = '';
    dom.emptyState.hidden = true;
    return;
  }

  const allItems = allMedia();
  const items = getFilteredMedia();
  dom.resultCount.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

  if (!allItems.length) {
    dom.libraryContent.innerHTML = '';
    dom.emptyState.hidden = false;
    dom.emptyTitle.textContent = 'Bring your media over';
    dom.emptyMessage.textContent = 'Open files from this device or point web_vlc at a folder to build your library.';
    return;
  }

  dom.emptyState.hidden = true;
  if (!items.length) {
    dom.libraryContent.innerHTML = `
      <div class="empty-filter-state">
        ${icon('search')}
        <strong>No media matches</strong>
        <p>Try another search, collection, or media type.</p>
      </div>`;
    return;
  }

  if (state.view === 'list') {
    dom.libraryContent.innerHTML = `
      <div class="media-list">
        <div class="list-header"><span>Title</span><span>Tags</span><span>Added</span><span>Status</span><span></span></div>
        ${items.map(listRowMarkup).join('')}
      </div>`;
  } else {
    dom.libraryContent.innerHTML = `<div class="media-grid">${items.map(gridCardMarkup).join('')}</div>`;
  }
  wireThumbnailFallbacks(dom.libraryContent);
}

function renderControls() {
  document.querySelectorAll('[data-media-filter]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mediaFilter === state.mediaFilter);
  });
  dom.sortSelect.value = state.section === 'recent' ? 'newest' : state.sort;
  dom.sortSelect.disabled = state.section === 'recent';
  dom.viewGridBtn.classList.toggle('active', state.view === 'grid');
  dom.viewListBtn.classList.toggle('active', state.view === 'list');
  dom.viewGridBtn.setAttribute('aria-pressed', String(state.view === 'grid'));
  dom.viewListBtn.setAttribute('aria-pressed', String(state.view === 'list'));
}

function renderApp() {
  renderSidebar();
  renderHeading();
  renderSummary();
  renderControls();
  renderContent();
  renderQueue();
}

function setConnection(online, label = online ? 'Local' : 'Offline') {
  dom.connectionPill.classList.toggle('offline', !online);
  dom.connectionLabel.textContent = label;
}

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

async function loadMedia({ quiet = false } = {}) {
  if (!quiet) {
    state.loading = true;
    renderContent();
  }
  try {
    const data = await fetchJson('/videos');
    state.serverMedia = (data.videos || []).map(normalizeServerMedia);
    state.config = data.library || {
      path: 'Configured media folder',
      displayPath: 'Media folder',
      available: true
    };
    setConnection(true, 'Local');
  } catch (error) {
    setConnection(false, 'Offline');
    if (!quiet) showToast(`Could not connect to the media server: ${error.message}`, 'error');
  } finally {
    state.loading = false;
    renderApp();
  }
}

async function rescanMedia() {
  if (dom.rescanBtn.disabled) return;
  dom.rescanBtn.disabled = true;
  dom.rescanBtn.classList.add('is-scanning');
  try {
    const data = await fetchJson('/scan', { method: 'POST' });
    await loadMedia({ quiet: true });
    if (data.available === false) {
      showToast('The configured media folder is unavailable. Check WEBVLC_MEDIA_DIR.', 'error');
    } else {
      showToast(`Scan complete · ${data.inserted || 0} new · ${data.markedMissing || 0} offline`);
    }
  } catch (error) {
    showToast(`Scan failed: ${error.message}`, 'error');
  } finally {
    dom.rescanBtn.disabled = false;
    dom.rescanBtn.classList.remove('is-scanning');
  }
}

function selectSection(section) {
  state.section = section;
  state.selectedTag = null;
  dom.body.classList.remove('sidebar-open');
  renderApp();
}

function selectTag(tag) {
  state.section = 'all';
  state.selectedTag = state.selectedTag === tag ? null : tag;
  dom.body.classList.remove('sidebar-open');
  renderApp();
}

function setView(view) {
  state.view = view;
  localStorage.setItem('webvlc:view', view);
  renderControls();
  renderContent();
}

function setMediaFilter(filter) {
  state.mediaFilter = filter;
  renderControls();
  renderContent();
}

function updateSearch(value) {
  state.search = value.trim();
  dom.globalSearch.classList.toggle('has-value', Boolean(value));
  renderHeading();
  renderContent();
}

function resetLibrary() {
  state.search = '';
  state.section = 'all';
  state.selectedTag = null;
  state.mediaFilter = 'all';
  dom.searchInput.value = '';
  dom.globalSearch.classList.remove('has-value');
  renderApp();
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
  dom.contextMenu.querySelector('[data-menu-action="favorite"] span').textContent = item.favorite ? 'Remove favorite' : 'Add to favorites';
  ['edit', 'native', 'delete'].forEach((action) => {
    dom.contextMenu.querySelector(`[data-menu-action="${action}"]`).disabled = item.local;
  });

  document.querySelectorAll('[data-action="menu"].active').forEach((button) => button.classList.remove('active'));
  trigger.classList.add('active');

  const rect = trigger.getBoundingClientRect();
  const menuWidth = 210;
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

async function toggleFavorite(id) {
  const item = findMedia(id);
  if (!item) return;
  if (item.local) {
    item.favorite = !item.favorite;
    renderApp();
    showToast(item.favorite ? 'Added to favorites for this session' : 'Removed from favorites');
    return;
  }

  const previous = item.favorite;
  item.favorite = !previous;
  renderApp();
  try {
    const data = await fetchJson(`/favorite/${item.serverId}`, { method: 'POST' });
    item.favorite = Boolean(data.favorite);
  } catch (error) {
    item.favorite = previous;
    showToast(`Could not update favorite: ${error.message}`, 'error');
  }
  renderApp();
}

function openEditDialog(id) {
  const item = findMedia(id);
  if (!item || item.local) return;
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
  if (!item || item.local) return;

  const parts = splitExtension(item.filename);
  const nextBase = dom.editFilename.value.trim();
  const nextName = nextBase + parts.extension;
  const nextTags = [...new Set(dom.editTags.value.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (!nextBase) {
    showToast('Filename cannot be empty', 'error');
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
      item.filename = renamed.filename;
      item.extension = extensionOf(renamed.filename);
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
    showToast('Media details saved');
    renderApp();
  } catch (error) {
    showToast(`Could not save changes: ${error.message}`, 'error');
    await loadMedia({ quiet: true });
  } finally {
    dom.saveEditBtn.disabled = false;
  }
}

function openDeleteDialog(id) {
  const item = findMedia(id);
  if (!item || item.local) return;
  state.deletingId = item.id;
  dom.confirmFilename.textContent = item.filename;
  dom.confirmDialog.showModal();
}

async function deleteMedia(event) {
  event.preventDefault();
  const item = findMedia(state.deletingId);
  if (!item || item.local) return;
  dom.confirmDeleteBtn.disabled = true;
  try {
    await fetchJson(`/delete/${item.serverId}`, { method: 'POST' });
    state.serverMedia = state.serverMedia.filter((media) => media.id !== item.id);
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
  if (!item || item.local) return;
  try {
    await fetchJson(`/open/${item.serverId}`, { method: 'POST' });
    showToast('Opening in your desktop player');
  } catch (error) {
    showToast(`Could not open the file: ${error.message}`, 'error');
  }
}

function buildQueue(id) {
  let items = getFilteredMedia();
  if (!items.some((item) => item.id === id)) items = allMedia();
  state.queue = items.map((item) => item.id);
}

function playerSource(item) {
  return item.local ? item.url : `/video/${item.serverId}`;
}

function openPlayer(id, { expand = true, autoplay = true, preserveQueue = false } = {}) {
  const item = findMedia(id);
  if (!item) return;
  if (!preserveQueue) buildQueue(item.id);
  if (!state.queue.includes(item.id)) state.queue.push(item.id);

  state.currentId = item.id;
  dom.playerMessage.hidden = true;
  dom.playerWindow.classList.remove('is-idle');
  dom.playerWindow.classList.add('is-paused');
  dom.videoCanvas.classList.toggle('is-audio', item.mediaType === 'audio');
  dom.videoCanvas.classList.remove('is-playing');
  dom.stageTitle.textContent = item.filename;
  dom.playerTitle.textContent = item.filename;
  dom.playerMeta.textContent = `${item.local ? 'This device' : 'Local library'} · ${(item.extension || item.mediaType).toUpperCase()}${item.size ? ` · ${formatBytes(item.size)}` : ''}`;
  updatePlayerArtwork(item);

  dom.playerVideo.pause();
  dom.playerVideo.removeAttribute('src');
  dom.playerVideo.load();
  dom.playerVideo.src = playerSource(item);
  dom.playerVideo.playbackRate = PLAYBACK_RATES[state.rateIndex];
  dom.playerVideo.load();
  resetTimeline();
  setPlayerControlsEnabled(true);
  renderQueue();
  renderContent();
  updateMediaSession(item);
  if (expand) setPlayerExpanded(true);

  if (autoplay) {
    dom.playerVideo.play().catch(() => {
      updatePlaybackUi(false);
    });
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

function setPlayerControlsEnabled(enabled) {
  [
    dom.playerPlayBtn, dom.canvasPlayBtn, dom.playerPrevBtn, dom.playerNextBtn,
    dom.playerBackBtn, dom.playerForwardBtn, dom.playerSeek, dom.playerMuteBtn,
    dom.playerVolume, dom.playbackRateBtn, dom.repeatBtn, dom.shuffleBtn,
    dom.playerExpandBtn, dom.dockExpandBtn, dom.playerPipBtn, dom.playerFullscreenBtn
  ].forEach((control) => { control.disabled = !enabled; });
}

function togglePlayback() {
  if (!state.currentId) {
    const first = getFilteredMedia()[0] || allMedia()[0];
    if (first) openPlayer(first.id);
    return;
  }
  if (dom.playerVideo.paused) dom.playerVideo.play().catch(() => {});
  else dom.playerVideo.pause();
}

function updatePlaybackUi(isPlaying) {
  dom.playerWindow.classList.toggle('is-paused', !isPlaying);
  dom.videoCanvas.classList.toggle('is-playing', isPlaying);
  dom.playerPlayBtn.classList.toggle('is-playing', isPlaying);
  setButtonIcon(dom.playerPlayBtn, isPlaying ? 'pause' : 'play');
  setButtonIcon(dom.canvasPlayBtn, isPlaying ? 'pause' : 'play');
  dom.playerPlayBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  dom.canvasPlayBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  document.querySelectorAll('.card-play use, .row-play use').forEach((use) => {
    const owner = use.closest('[data-id]');
    if (owner?.dataset.id === state.currentId) use.setAttribute('href', `#i-${isPlaying ? 'pause' : 'play'}`);
  });
  renderQueue();
}

function closePlayer() {
  dom.playerVideo.pause();
  dom.playerVideo.removeAttribute('src');
  dom.playerVideo.load();
  state.currentId = null;
  state.queue = [];
  setPlayerExpanded(false);
  dom.playerWindow.className = 'player-shell is-idle';
  dom.stageTitle.textContent = 'Nothing playing';
  dom.playerTitle.textContent = 'Choose something to play';
  dom.playerMeta.textContent = 'Your library is ready';
  dom.playerMessage.hidden = true;
  dom.videoCanvas.classList.remove('is-audio', 'is-playing');
  resetTimeline();
  setPlayerControlsEnabled(false);
  renderContent();
  renderQueue();
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}

function setPlayerExpanded(expanded) {
  if (!state.currentId && expanded) return;
  state.expanded = Boolean(expanded);
  dom.playerWindow.classList.toggle('is-expanded', state.expanded);
  dom.body.classList.toggle('player-expanded', state.expanded);
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
  openPlayer(state.queue[nextIndex], { expand: state.expanded, preserveQueue: true });
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
  const items = ids.map(findMedia).filter(Boolean);
  dom.queueCount.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
  dom.queueList.innerHTML = items.map((item) => {
    const active = item.id === state.currentId;
    return `
      <button class="queue-item${active ? ' active' : ''}" type="button" data-queue-id="${item.id}">
        <span class="queue-thumb">${thumbnailMarkup(item)}</span>
        <span class="queue-copy"><strong>${escapeHtml(item.filename)}</strong><small>${escapeHtml(item.extension || item.mediaType)}</small></span>
        ${active && !dom.playerVideo.paused ? '<span class="queue-playing"><i></i><i></i><i></i></span>' : ''}
      </button>`;
  }).join('');
  wireThumbnailFallbacks(dom.queueList);
}

function cyclePlaybackRate() {
  state.rateIndex = (state.rateIndex + 1) % PLAYBACK_RATES.length;
  const rate = PLAYBACK_RATES[state.rateIndex];
  dom.playerVideo.playbackRate = rate;
  dom.playbackRateBtn.textContent = `${rate}×`;
  showToast(`Playback speed: ${rate}×`);
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
    setPlayerExpanded(true);
    await dom.videoCanvas.requestFullscreen();
  } catch (error) {
    showToast(`Fullscreen failed: ${error.message}`, 'error');
  }
}

function updateMediaSession(item) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  const artwork = item.thumbnailUrl ? [{ src: new URL(item.thumbnailUrl, window.location.href).href }] : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: item.filename,
    artist: item.local ? 'This device' : 'web_vlc library',
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

function isSupportedFile(file) {
  const extension = extensionOf(file.name);
  return file.type.startsWith('video/') || file.type.startsWith('audio/') || VIDEO_EXTENSIONS.has(extension) || AUDIO_EXTENSIONS.has(extension);
}

async function addLocalFiles(fileList) {
  const files = [...fileList].filter(isSupportedFile);
  if (!files.length) {
    showToast('No supported audio or video files found', 'error');
    return;
  }

  const added = files.map((file) => {
    const item = {
      id: `local-${++state.localCounter}`,
      serverId: null,
      filename: file.name,
      tags: ['local'],
      favorite: false,
      hasThumbnail: false,
      thumbnailUrl: null,
      mediaType: file.type.startsWith('audio/') ? 'audio' : mediaTypeFrom(file.name),
      extension: extensionOf(file.name),
      size: file.size,
      modifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString(),
      available: true,
      local: true,
      file,
      url: URL.createObjectURL(file)
    };
    state.sessionMedia.push(item);
    return item;
  });

  state.section = 'all';
  state.selectedTag = null;
  state.mediaFilter = 'all';
  renderApp();
  showToast(`${added.length} local file${added.length === 1 ? '' : 's'} added for this session`);
  openPlayer(added[0].id);

  added.filter((item) => item.mediaType === 'video').forEach((item) => {
    createLocalThumbnail(item).then((thumbnailUrl) => {
      if (!thumbnailUrl || !findMedia(item.id)) return;
      item.thumbnailUrl = thumbnailUrl;
      item.hasThumbnail = true;
      const current = findMedia(state.currentId);
      if (current) {
        updatePlayerArtwork(current);
        updateMediaSession(current);
      }
      renderContent();
      renderQueue();
    });
  });
}

function createLocalThumbnail(item) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };
    const fail = () => { cleanup(); resolve(null); };
    video.muted = true;
    video.preload = 'metadata';
    video.src = item.url;
    video.addEventListener('error', fail, { once: true });
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(1, Math.max(0, (video.duration || 1) * 0.08));
    }, { once: true });
    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        const width = 480;
        canvas.width = width;
        canvas.height = Math.max(270, Math.round(width * (video.videoHeight / video.videoWidth || 0.5625)));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/jpeg', 0.82);
        cleanup();
        resolve(url);
      } catch {
        fail();
      }
    }, { once: true });
    setTimeout(fail, 8000);
  });
}

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

// Library controls
dom.searchInput.addEventListener('input', (event) => updateSearch(event.target.value));
dom.clearSearchBtn.addEventListener('click', () => {
  dom.searchInput.value = '';
  updateSearch('');
  dom.searchInput.focus();
});
document.querySelector('.brand').addEventListener('click', (event) => {
  event.preventDefault();
  resetLibrary();
});
document.querySelector('.sidebar-nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-section]');
  if (button) selectSection(button.dataset.section);
});
dom.tagNavigation.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]');
  if (button) selectTag(button.dataset.tag);
});
dom.mediaFilters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-media-filter]');
  if (button) setMediaFilter(button.dataset.mediaFilter);
});
dom.sortSelect.addEventListener('change', (event) => {
  state.sort = event.target.value;
  localStorage.setItem('webvlc:sort', state.sort);
  renderContent();
});
dom.viewGridBtn.addEventListener('click', () => setView('grid'));
dom.viewListBtn.addEventListener('click', () => setView('list'));
dom.rescanBtn.addEventListener('click', rescanMedia);
dom.emptyScanBtn.addEventListener('click', rescanMedia);
dom.filePicker.addEventListener('change', (event) => {
  addLocalFiles(event.target.files);
  event.target.value = '';
});
dom.sidebarToggle.addEventListener('click', () => dom.body.classList.toggle('sidebar-open'));
dom.sidebarScrim.addEventListener('click', () => dom.body.classList.remove('sidebar-open'));

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

// Context menu
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
  if (!dom.contextMenu.hidden && !dom.contextMenu.contains(event.target) && !event.target.closest('[data-action="menu"]')) closeContextMenu();
});
window.addEventListener('resize', closeContextMenu);
window.addEventListener('scroll', closeContextMenu, { passive: true });

// Dialogs
document.querySelectorAll('[data-dialog-close]').forEach((button) => {
  button.addEventListener('click', () => document.getElementById(button.dataset.dialogClose)?.close());
});
dom.editForm.addEventListener('submit', saveEdit);
dom.confirmForm.addEventListener('submit', deleteMedia);
[dom.editDialog, dom.confirmDialog].forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
});

// Player controls
dom.playerPlayBtn.addEventListener('click', togglePlayback);
dom.canvasPlayBtn.addEventListener('click', togglePlayback);
dom.playerVideo.addEventListener('click', togglePlayback);
dom.playerVideo.addEventListener('dblclick', toggleFullscreen);
dom.playerPrevBtn.addEventListener('click', () => playAdjacent(-1));
dom.playerNextBtn.addEventListener('click', () => playAdjacent(1));
dom.playerBackBtn.addEventListener('click', () => seekBy(-10));
dom.playerForwardBtn.addEventListener('click', () => seekBy(10));
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
  updateVolumeUi();
});
dom.playbackRateBtn.addEventListener('click', cyclePlaybackRate);
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
dom.playerExpandBtn.addEventListener('click', () => setPlayerExpanded(!state.expanded));
dom.dockExpandBtn.addEventListener('click', () => setPlayerExpanded(true));
dom.playerCollapseBtn.addEventListener('click', () => setPlayerExpanded(false));
dom.playerCloseBtn.addEventListener('click', closePlayer);
dom.playerPipBtn.addEventListener('click', togglePictureInPicture);
dom.playerFullscreenBtn.addEventListener('click', toggleFullscreen);
dom.queueList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-queue-id]');
  if (button) openPlayer(button.dataset.queueId, { expand: true, preserveQueue: true });
});

dom.playerVideo.addEventListener('play', () => updatePlaybackUi(true));
dom.playerVideo.addEventListener('pause', () => updatePlaybackUi(false));
dom.playerVideo.addEventListener('loadedmetadata', () => {
  updateTimeline();
  updateMediaPositionState();
});
dom.playerVideo.addEventListener('timeupdate', () => {
  updateTimeline();
  if (Math.floor(dom.playerVideo.currentTime) % 5 === 0) updateMediaPositionState();
});
dom.playerVideo.addEventListener('ended', () => {
  if (!state.repeat && state.queue.length > 1) playAdjacent(1);
});
dom.playerVideo.addEventListener('error', () => {
  if (!state.currentId) return;
  dom.playerMessage.hidden = false;
  updatePlaybackUi(false);
});
dom.playerVideo.addEventListener('volumechange', updateVolumeUi);

// Keyboard controls
document.addEventListener('keydown', (event) => {
  const typing = event.target.matches('input, textarea, select') || event.target.closest('dialog');
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
    dom.body.classList.remove('sidebar-open');
    if (state.expanded && !document.fullscreenElement) setPlayerExpanded(false);
  }
});

// Drag and drop local media
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
  addLocalFiles(event.dataTransfer.files);
});
window.addEventListener('beforeunload', () => {
  state.sessionMedia.forEach((item) => URL.revokeObjectURL(item.url));
});

if ('mediaSession' in navigator) {
  const safeHandler = (action, handler) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
  };
  safeHandler('play', () => dom.playerVideo.play());
  safeHandler('pause', () => dom.playerVideo.pause());
  safeHandler('previoustrack', () => playAdjacent(-1));
  safeHandler('nexttrack', () => playAdjacent(1));
  safeHandler('seekbackward', (details) => seekBy(-(details.seekOffset || 10)));
  safeHandler('seekforward', (details) => seekBy(details.seekOffset || 10));
  safeHandler('seekto', (details) => { dom.playerVideo.currentTime = details.seekTime || 0; });
}

// Boot
setPlayerControlsEnabled(false);
dom.sortSelect.value = state.sort;
dom.playerVideo.volume = 0.85;
updateVolumeUi();
renderControls();
loadMedia();
