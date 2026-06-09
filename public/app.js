/* ============================================================
   Edits Viewer v2.1 — Stable CRUD, list/grid views
   ============================================================ */

let videos = [];
let currentSearch = '';
let favFilterActive = false;
let hoveredId = null;
let viewMode = localStorage.getItem('editViewMode') || 'list';

// --- DOM references ---
const videoBody = document.getElementById('videoBody');
const searchInput = document.getElementById('searchInput');
const favFilter = document.getElementById('favFilter');
const resultCount = document.getElementById('resultCount');
const loadingEl = document.getElementById('loading');
const contentEl = document.getElementById('content');
const gridContainer = document.getElementById('gridContainer');
const emptyStateEl = document.getElementById('emptyState');
const statusText = document.getElementById('statusText');
const rescanBtn = document.getElementById('rescanBtn');
const viewListBtn = document.getElementById('viewListBtn');
const viewGridBtn = document.getElementById('viewGridBtn');

// --- Player DOM references ---
const hoverPreview = document.getElementById('hoverPreview');
const hoverVideo = document.getElementById('hoverVideo');
const playerWindow = document.getElementById('playerWindow');
const playerVideo = document.getElementById('playerVideo');
const playerTitle = document.getElementById('playerTitle');
const playerPlayBtn = document.getElementById('playerPlayBtn');
const playerTime = document.getElementById('playerTime');
const playerSeek = document.getElementById('playerSeek');
const playerMuteBtn = document.getElementById('playerMuteBtn');
const playerVolume = document.getElementById('playerVolume');
const playerFullscreenBtn = document.getElementById('playerFullscreenBtn');
const playerCloseBtn = document.getElementById('playerCloseBtn');
const playerTitleBar = document.getElementById('playerTitleBar');

// --- Hover/Player state ---
let hoverTimeout = null;
let hoverCurrentId = null;
const HOVER_DELAY = 100;
let playerOpen = false;
let playerCurrentId = null;

// ============================================================
//   VIEW MODE
// ============================================================

function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem('editViewMode', mode);
  viewListBtn.className = 'btn btn-small view-btn' + (mode === 'list' ? ' active' : '');
  viewGridBtn.className = 'btn btn-small view-btn' + (mode === 'grid' ? ' active' : '');
  renderContent();
}

// ============================================================
//   HOVER ROW TRACKING
// ============================================================

rescanBtn.addEventListener('click', rescanVideos);

searchInput.addEventListener('input', function() {
  currentSearch = this.value.toLowerCase();
  renderContent();
});

favFilter.addEventListener('change', function() {
  favFilterActive = this.checked;
  renderContent();
});

// ============================================================
//   HOVER TRACKING + PREVIEW (document-level delegation)
//   Single event listeners that work for both list and grid views
// ============================================================

document.addEventListener('mouseover', function(e) {
  const el = e.target.closest('#videoBody [data-id], #gridContainer [data-id]');
  if (el) hoveredId = parseInt(el.getAttribute('data-id'), 10);

  const thumbCell = e.target.closest('#videoBody .thumb-cell, #gridContainer .card-thumb');
  if (!thumbCell) return;
  const row = thumbCell.closest('[data-id]');
  if (!row) return;
  const id = parseInt(row.getAttribute('data-id'), 10);
  if (!id) return;
  if (playerOpen && playerCurrentId === id) return;
  if (hoverTimeout) clearTimeout(hoverTimeout);
  hoverTimeout = setTimeout(function() { showHoverPreview(thumbCell, id); }, HOVER_DELAY);
});

document.addEventListener('mouseout', function(e) {
  const el = e.target.closest('#videoBody [data-id], #gridContainer [data-id]');
  if (el && parseInt(el.getAttribute('data-id'), 10) === hoveredId) hoveredId = null;

  const thumbCell = e.target.closest('#videoBody .thumb-cell, #gridContainer .card-thumb');
  if (!thumbCell) return;
  if (e.relatedTarget && (e.relatedTarget.closest('#videoBody .thumb-cell, #gridContainer .card-thumb') || e.relatedTarget.closest('#hoverPreview'))) return;
  hideHoverPreview();
});

document.addEventListener('click', function(e) {
  // Handle tag removal via delegated handler (avoids inline onclick escaping issues)
  const removeLink = e.target.closest('.tag-remove');
  if (removeLink) {
    e.preventDefault();
    e.stopPropagation();
    const id = parseInt(removeLink.getAttribute('data-id'), 10);
    const tag = decodeURIComponent(removeLink.getAttribute('data-tag'));
    removeTag(id, tag);
    return;
  }

  const thumbCell = e.target.closest('#videoBody .thumb-cell, #gridContainer .card-thumb');
  if (!thumbCell) return;
  const row = thumbCell.closest('[data-id]');
  if (!row) return;
  const id = parseInt(row.getAttribute('data-id'), 10);
  if (!id) return;
  if (e.target.closest('button') || e.target.closest('.filename-edit, .tag-remove, .add-tag-btn')) return;
  hideHoverPreview();
  openPlayer(id);
});

function showHoverPreview(thumbCell, id) {
  if (hoverCurrentId === id) return;
  hoverCurrentId = id;
  const rect = thumbCell.getBoundingClientRect();
  let top = rect.bottom + 4, left = rect.left;
  if (left + 320 > window.innerWidth - 8) left = window.innerWidth - 328;
  if (left < 8) left = 8;
  if (top + 200 > window.innerHeight - 30) top = rect.top - 204;
  if (top < 8) top = 8;
  hoverPreview.style.cssText = 'display:block;left:' + left + 'px;top:' + top + 'px;';

  hoverVideo.pause();
  hoverVideo.removeAttribute('src');
  hoverVideo.load();
  hoverVideo.oncanplay = null;
  hoverVideo.onerror = null;
  hoverVideo.src = '/video/' + id;
  hoverVideo.muted = true;
  hoverVideo.load();
  hoverVideo.onerror = function() { hideHoverPreview(); };
  hoverVideo.oncanplay = function() {
    hoverVideo.oncanplay = null;
    if (hoverCurrentId === id) hoverVideo.play().catch(function() {});
  };
  if (hoverVideo.readyState >= 3) hoverVideo.oncanplay();
}

function hideHoverPreview() {
  if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
  hoverPreview.style.display = 'none';
  hoverVideo.pause();
  hoverVideo.removeAttribute('src');
  hoverVideo.load();
  hoverCurrentId = null;
}

// ============================================================
//   FLOATING PLAYER
// ============================================================

function openPlayer(id) {
  if (playerOpen && playerCurrentId === id) { playerWindow.style.zIndex = 600; return; }
  playerCurrentId = id;
  playerOpen = true;
  const video = videos.find(v => v.id === id);
  playerTitle.textContent = video ? video.filename : 'Now Playing';
  playerVideo.pause();
  playerVideo.removeAttribute('src');
  playerVideo.load();
  playerVideo.oncanplay = null;
  playerVideo.onerror = null;
  playerVideo.src = '/video/' + id;
  playerVideo.volume = playerVolume.value / 100;
  playerVideo.load();
  playerWindow.style.display = 'flex';
  playerWindow.style.zIndex = 600;
  playerPlayBtn.textContent = '\u25B6';
  playerSeek.value = 0;
  playerTime.textContent = '0:00 / 0:00';
  playerVideo.focus();
  playerVideo.onerror = function() { showNotification('Failed to load video', 'error'); };
  playerVideo.oncanplay = function() {
    playerVideo.oncanplay = null;
    if (playerCurrentId === id) playerVideo.play().then(function() { playerPlayBtn.textContent = '\u23F8'; }).catch(function() {});
  };
  if (playerVideo.readyState >= 3) playerVideo.oncanplay();
}

function closePlayer() {
  playerOpen = false; playerCurrentId = null;
  playerVideo.pause(); playerVideo.removeAttribute('src'); playerVideo.load();
  playerWindow.style.display = 'none';
  if (hoverCurrentId) hideHoverPreview();
}

playerCloseBtn.addEventListener('click', closePlayer);
playerPlayBtn.addEventListener('click', function() {
  if (playerVideo.paused) { playerVideo.play(); playerPlayBtn.textContent = '\u23F8'; }
  else { playerVideo.pause(); playerPlayBtn.textContent = '\u25B6'; }
});
playerVideo.addEventListener('play', function() { playerPlayBtn.textContent = '\u23F8'; });
playerVideo.addEventListener('pause', function() { playerPlayBtn.textContent = '\u25B6'; });
playerVideo.addEventListener('timeupdate', function() {
  if (playerVideo.duration) playerSeek.value = (playerVideo.currentTime / playerVideo.duration) * 1000;
  playerTime.textContent = formatTime(playerVideo.currentTime) + ' / ' + formatTime(playerVideo.duration);
});
playerSeek.addEventListener('input', function() {
  if (playerVideo.duration) playerVideo.currentTime = (this.value / 1000) * playerVideo.duration;
});
playerMuteBtn.addEventListener('click', function() {
  playerVideo.muted = !playerVideo.muted;
  playerMuteBtn.textContent = playerVideo.muted ? '\u{1F507}' : '\u{1F50A}';
});
playerVolume.addEventListener('input', function() {
  playerVideo.volume = this.value / 100;
  if (playerVideo.volume > 0 && playerVideo.muted) { playerVideo.muted = false; playerMuteBtn.textContent = '\u{1F50A}'; }
  if (playerVideo.volume === 0) playerMuteBtn.textContent = '\u{1F507}';
});
playerFullscreenBtn.addEventListener('click', toggleFullscreen);
function toggleFullscreen() {
  if (!document.fullscreenElement) playerWindow.requestFullscreen().catch(function() {});
  else document.exitFullscreen().catch(function() {});
}
playerWindow.addEventListener('fullscreenchange', function() { playerVideo.style.objectFit = 'contain'; });

// --- Dragging ---
let dragState = null;
playerTitleBar.addEventListener('mousedown', function(e) {
  if (e.target.tagName === 'BUTTON' || document.fullscreenElement) return;
  dragState = { startX: e.clientX, startY: e.clientY, origLeft: playerWindow.offsetLeft, origTop: playerWindow.offsetTop };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
  e.preventDefault();
});
function onDragMove(e) {
  if (!dragState) return;
  playerWindow.style.left = (dragState.origLeft + e.clientX - dragState.startX) + 'px';
  playerWindow.style.top = (dragState.origTop + e.clientY - dragState.startY) + 'px';
}
function onDragEnd() { dragState = null; document.removeEventListener('mousemove', onDragMove); document.removeEventListener('mouseup', onDragEnd); }

// ============================================================
//   KEYBOARD SHORTCUTS
// ============================================================

playerWindow.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    if (e.key === 'Escape' && !editingFilename && !editingTagCell) closePlayer();
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  switch (e.key) {
    case ' ': e.preventDefault(); playerPlayBtn.click(); break;
    case 'f': case 'F': if (!ctrl) { e.preventDefault(); toggleFullscreen(); } break;
    case 'ArrowRight': e.preventDefault(); playerVideo.currentTime = Math.min(playerVideo.currentTime + (ctrl ? 30 : 5), playerVideo.duration || Infinity); break;
    case 'ArrowLeft': e.preventDefault(); playerVideo.currentTime = Math.max(playerVideo.currentTime - (ctrl ? 30 : 5), 0); break;
    case 'ArrowUp': e.preventDefault(); playerVolume.value = Math.min(parseInt(playerVolume.value) + 10, 100); playerVolume.dispatchEvent(new Event('input')); break;
    case 'ArrowDown': e.preventDefault(); playerVolume.value = Math.max(parseInt(playerVolume.value) - 10, 0); playerVolume.dispatchEvent(new Event('input')); break;
    case 'm': case 'M': if (!ctrl) { e.preventDefault(); playerMuteBtn.click(); } break;
    case 'Escape': if (document.fullscreenElement) document.exitFullscreen().catch(function() {}); else closePlayer(); break;
  }
});

document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') { if (e.key === 'Escape') return; return; }
  if (playerOpen && playerWindow.contains(e.target)) return;
  switch (e.key) {
    case '/': e.preventDefault(); searchInput.focus(); searchInput.select(); break;
    case 'Delete': case 'Del': if (hoveredId) { const v = videos.find(x => x.id === hoveredId); if (v) confirmDelete(v.id); } break;
    case 'f': case 'F': if (hoveredId) toggleFavorite(hoveredId); break;
  }
});

// ============================================================
//   LOAD VIDEOS
// ============================================================

async function loadVideos() {
  console.log('[LOAD] start');
  loadingEl.style.display = 'block';
  contentEl.style.display = 'none';
  gridContainer.style.display = 'none';
  emptyStateEl.style.display = 'none';
  statusText.textContent = 'Scanning...';
  try {
    console.log('[LOAD] fetching /videos');
    const res = await fetch('/videos');
    console.log('[LOAD] response received', res.status);
    const data = await res.json();
    console.log('[LOAD] parsed JSON', JSON.stringify(data).substring(0, 200));
    if (data.videos && data.videos.length > 0) {
      videos = data.videos;
      loadingEl.style.display = 'none';
      contentEl.style.display = viewMode === 'list' ? 'block' : 'none';
      gridContainer.style.display = viewMode === 'grid' ? 'block' : 'none';
      emptyStateEl.style.display = 'none';
      console.log('[LOAD] rendering');
      renderContent();
      console.log('[LOAD] render complete');
      statusText.textContent = 'Ready - ' + videos.length + ' videos';
    } else {
      loadingEl.style.display = 'none';
      contentEl.style.display = 'none';
      gridContainer.style.display = 'none';
      emptyStateEl.style.display = 'block';
      statusText.textContent = 'No videos found';
    }
  } catch (err) {
    console.log('[LOAD] ERROR:', err.message);
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    gridContainer.style.display = 'none';
    emptyStateEl.style.display = 'block';
    statusText.textContent = 'Error: ' + err.message;
    showNotification('Failed to load videos: ' + err.message, 'error');
  }
}

// ============================================================
//   RENDER CONTENT (dispatches to list or grid)
// ============================================================

function renderContent() {
  if (viewMode === 'grid') {
    contentEl.style.display = 'none';
    gridContainer.style.display = 'block';
    renderGridView();
  } else {
    contentEl.style.display = 'block';
    gridContainer.style.display = 'none';
    renderListView();
  }
}

function getFiltered() {
  return videos.filter(function(v) {
    if (currentSearch) {
      var nameMatch = v.filename.toLowerCase().includes(currentSearch);
      var tagMatch = v.tags.some(function(t) { return t.toLowerCase().includes(currentSearch); });
      if (!nameMatch && !tagMatch) return false;
    }
    if (favFilterActive && !v.favorite) return false;
    return true;
  });
}

// ============================================================
//   LIST VIEW
// ============================================================

function renderListView() {
  const filtered = getFiltered();
  if (filtered.length === 0) {
    videoBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#888;font-family:\'Courier New\',monospace;">No matching videos.</td></tr>';
    resultCount.textContent = '0 videos';
    return;
  }
  const scrollY = window.scrollY;
  let html = '';
  for (const v of filtered) {
    const favStar = v.favorite ? '\u2605' : '\u2606';
    const favClass = v.favorite ? 'active' : 'inactive';
    html += '<tr data-id="' + v.id + '">';
    html += '<td class="thumb-cell" title="Hover to preview, click to play">';
    if (v.hasThumbnail) html += '<img src="/thumbnail/' + v.id + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' + '<div class="thumb-placeholder" style="display:none;">&#x1F3AC;</div>';
    else html += '<div class="thumb-placeholder">&#x1F3AC;</div>';
    html += '</td>';
    html += '<td class="filename-cell" onclick="startFilenameEdit(this)" title="Click to rename"><span class="filename-text">' + escapeHtml(v.filename) + '</span></td>';
    html += '<td class="tags-cell" onclick="startTagEdit(this)"><div class="tag-list">';
    for (const tag of v.tags) html += '<span class="tag-badge">' + escapeHtml(tag) + ' <a href="#" class="tag-remove" data-id="' + v.id + '" data-tag="' + encodeURIComponent(tag) + '">&times;</a></span>';
    html += '<span class="add-tag-btn" onclick="event.stopPropagation();startTagEdit(this.parentElement.parentElement)">+</span></div></td>';
    html += '<td class="fav-cell"><button class="btn-fav ' + favClass + '" onclick="toggleFavorite(' + v.id + ')" title="Toggle favorite">' + favStar + '</button></td>';
    html += '<td class="actions-cell"><button class="btn btn-small" onclick="openInVLC(' + v.id + ')" title="Open in VLC">&#x25B6; VLC</button> <button class="btn btn-small btn-del" onclick="confirmDelete(' + v.id + ')" title="Delete">&#x2716; Del</button></td>';
    html += '</tr>';
  }
  videoBody.innerHTML = html;
  resultCount.textContent = filtered.length + ' videos';
  window.scrollTo(0, scrollY);
}

// ============================================================
//   GRID VIEW
// ============================================================

function renderGridView() {
  const filtered = getFiltered();
  gridContainer.innerHTML = '';
  if (filtered.length === 0) {
    gridContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#888;font-family:\'Courier New\',monospace;">No matching videos.</div>';
    resultCount.textContent = '0 videos';
    return;
  }
  const scrollY = window.scrollY;
  let html = '<div class="video-grid">';
  for (const v of filtered) {
    const favStar = v.favorite ? '\u2605' : '\u2606';
    const favClass = v.favorite ? 'active' : '';
    html += '<div class="video-card" data-id="' + v.id + '">';
    html += '<div class="card-thumb">';
    if (v.hasThumbnail) html += '<img src="/thumbnail/' + v.id + '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' + '<div class="thumb-placeholder" style="display:none;">&#x1F3AC;</div>';
    else html += '<div class="thumb-placeholder">&#x1F3AC;</div>';
    html += '</div>';
    html += '<div class="card-body">';
    html += '<span class="card-filename">' + escapeHtml(v.filename) + '</span>';
    html += '<div class="card-tags">';
    for (const tag of v.tags) html += '<span class="tag-badge">' + escapeHtml(tag) + '</span>';
    html += '</div>';
    html += '<span class="card-fav ' + favClass + '">' + favStar + '</span>';
    html += '</div></div>';
  }
  html += '</div>';
  gridContainer.innerHTML = html;
  resultCount.textContent = filtered.length + ' videos';
  window.scrollTo(0, scrollY);
}

// ============================================================
//   HELPERS
// ============================================================

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function splitExtension(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return { base: filename, ext: '' };
  return { base: filename.substring(0, dot), ext: filename.substring(dot) };
}

// ============================================================
//   FILENAME EDITING (in-place update, no scroll jump)
// ============================================================

let editingFilename = null;

function startFilenameEdit(cell) {
  if (editingFilename) return;
  const span = cell.querySelector('.filename-text');
  if (!span) return;
  const row = cell.closest('tr[data-id]');
  if (!row) return;
  const id = parseInt(row.getAttribute('data-id'), 10);
  if (!id) return;

  const fullName = span.textContent;
  const parsed = splitExtension(fullName);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'filename-edit';
  input.value = parsed.base;
  input.setAttribute('data-ext', parsed.ext);
  input.setAttribute('data-full', fullName);

  span.style.display = 'none';
  cell.insertBefore(input, span);
  input.focus();
  input.select();
  editingFilename = cell;

  function finishEdit(save) {
    if (!editingFilename) return;
    const newBase = input.value.trim();
    const origExt = input.getAttribute('data-ext') || '';
    const origFull = input.getAttribute('data-full');
    if (save && newBase && newBase + origExt !== origFull) {
      renameFile(id, newBase + origExt, span);
    } else {
      span.textContent = origFull;
      input.remove();
      span.style.display = '';
      editingFilename = null;
    }
  }

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
  });
  input.addEventListener('blur', function() { setTimeout(function() { finishEdit(true); }, 100); });
  input.addEventListener('click', function(e) { e.stopPropagation(); });
}

async function renameFile(id, newName, span) {
  const scrollY = window.scrollY;
  statusText.textContent = 'Renaming...';
  try {
    const res = await fetch('/rename/' + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName: newName })
    });
    const data = await res.json();
    if (data.success) {
      // Update in-memory state
      const v = videos.find(v => v.id === id);
      if (v) v.filename = data.filename;
      // Update DOM in-place — avoids full re-render scroll jump
      if (span) span.textContent = data.filename;
      showNotification('Renamed to: ' + data.filename);
    } else {
      showNotification('Rename failed: ' + (data.error || 'Unknown error'), 'error');
      // Span still has original text; cleanup code below restores display
    }
  } catch (err) {
    showNotification('Rename error: ' + err.message, 'error');
  }
  // Restore scroll position
  window.scrollTo(0, scrollY);
  statusText.textContent = 'Ready - ' + videos.length + ' videos';
  // Clean up edit state
  if (span) { const input = span.previousSibling; if (input && input.tagName === 'INPUT') { input.remove(); span.style.display = ''; } }
  editingFilename = null;
}

// ============================================================
//   TAG EDITING (immediate sync from API response)
// ============================================================

let editingTagCell = null;

function startTagEdit(cell) {
  if (cell.tagName !== 'TD') { cell = cell.closest('td'); if (!cell) return; }
  if (editingTagCell) return;
  const row = cell.closest('tr[data-id]');
  if (!row) return;
  const id = parseInt(row.getAttribute('data-id'), 10);
  if (!id) return;

  const tagList = cell.querySelector('.tag-list');
  if (!tagList) return;
  const addBtn = tagList.querySelector('.add-tag-btn');
  if (addBtn) addBtn.style.display = 'none';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-input-inline';
  input.placeholder = 'Type tag, Enter to add';
  tagList.appendChild(input);
  input.focus();
  editingTagCell = cell;

  function finishEdit() {
    if (!editingTagCell) return;
    input.remove();
    if (addBtn) addBtn.style.display = '';
    editingTagCell = null;
  }

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const tag = input.value.trim();
      if (tag) addTag(id, tag);
      finishEdit();
    } else if (e.key === 'Escape') { e.preventDefault(); finishEdit(); }
  });
  input.addEventListener('blur', function() { setTimeout(function() { if (editingTagCell) finishEdit(); }, 150); });
}

async function addTag(id, tag) {
  console.log('[TAG] adding', tag, id);
  try {
    const res = await fetch('/tags/' + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', tag: tag })
    });
    console.log('[TAG] response status', res.status);
    const data = await res.json();
    console.log('[TAG] response body', data);
    if (data.success && data.tags) {
      // Replace local state with server response immediately
      const v = videos.find(v => v.id === id);
      if (v) {
        v.tags = data.tags;
        console.log('[TAG] updated state', data.tags);
      }
      renderContent();
    } else {
      console.log('[TAG] failed — data:', data);
      showNotification('Failed to add tag: ' + (data.error || 'unknown error'), 'error');
    }
  } catch (err) {
    console.log('[TAG] error:', err.message);
    showNotification('Tag error: ' + err.message, 'error');
  }
}

async function removeTag(id, tag) {
  console.log('[TAG] removing', tag, id);
  try {
    const res = await fetch('/tags/' + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', tag: tag })
    });
    console.log('[TAG] response status', res.status);
    const data = await res.json();
    console.log('[TAG] response body', data);
    if (data.success && data.tags) {
      const v = videos.find(v => v.id === id);
      if (v) {
        v.tags = data.tags;
        console.log('[TAG] updated state', data.tags);
      }
      renderContent();
    } else {
      console.log('[TAG] failed — data:', data);
      showNotification('Failed to remove tag: ' + (data.error || 'unknown error'), 'error');
    }
  } catch (err) {
    console.log('[TAG] error:', err.message);
    showNotification('Tag error: ' + err.message, 'error');
  }
}

// ============================================================
//   FAVORITE (in-place)
// ============================================================

async function toggleFavorite(id) {
  const scrollY = window.scrollY;
  try {
    const res = await fetch('/favorite/' + id, { method: 'POST' });
    const data = await res.json();
    if (data.favorite !== undefined) {
      const v = videos.find(v => v.id === id);
      if (v) v.favorite = data.favorite;
      renderContent();
    } else {
      showNotification('Failed to toggle favorite', 'error');
    }
  } catch (err) {
    showNotification('Favorite error: ' + err.message, 'error');
  }
  window.scrollTo(0, scrollY);
}

// ============================================================
//   DELETE
// ============================================================

function confirmDelete(id) {
  const video = videos.find(v => v.id === id);
  const filename = video ? video.filename : 'unknown';
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML =
    '<div class="confirm-box">' +
    '<h3>&#x26A0; Confirm Delete</h3>' +
    '<p>Permanently delete this file?<br><strong>' + escapeHtml(filename) + '</strong></p>' +
    '<div class="btn-group">' +
    '<button class="btn" onclick="this.closest(\'.confirm-overlay\').remove()">Cancel</button>' +
    '<button class="btn btn-del" onclick="deleteFile(' + id + ', this)">Delete</button>' +
    '</div></div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  const keyHandler = function(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', keyHandler); } };
  document.addEventListener('keydown', keyHandler);
}

async function deleteFile(id, btn) {
  const scrollY = window.scrollY;
  btn.disabled = true;
  btn.textContent = 'Deleting...';
  try {
    const res = await fetch('/delete/' + id, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showNotification('Deleted');
      if (playerCurrentId === id) closePlayer();
      videos = videos.filter(v => v.id !== id);
      const overlay = btn.closest('.confirm-overlay');
      if (overlay) overlay.remove();
      renderContent();
      statusText.textContent = 'Ready - ' + videos.length + ' videos';
      if (videos.length === 0) {
        contentEl.style.display = 'none';
        gridContainer.style.display = 'none';
        emptyStateEl.style.display = 'block';
      }
    } else {
      showNotification('Delete failed: ' + (data.error || 'Unknown error'), 'error');
      btn.disabled = false; btn.textContent = 'Delete';
    }
  } catch (err) {
    showNotification('Delete error: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = 'Delete';
  }
  window.scrollTo(0, scrollY);
}

// ============================================================
//   OPEN IN VLC
// ============================================================

async function openInVLC(id) {
  try {
    const res = await fetch('/open/' + id, { method: 'POST' });
    const data = await res.json();
    if (!data.success) showNotification('Failed to open file: ' + (data.error || 'Unknown error'), 'error');
  } catch (err) { showNotification('Open error: ' + err.message, 'error'); }
}

// ============================================================
//   RESCAN
// ============================================================

async function rescanVideos() {
  rescanBtn.disabled = true;
  rescanBtn.textContent = 'Scanning...';
  statusText.textContent = 'Rescanning...';
  try {
    const res = await fetch('/scan', { method: 'POST' });
    const data = await res.json();
    if (data.success) showNotification('Scan complete: ' + (data.inserted || 0) + ' new, ' + (data.updated || 0) + ' updated');
    else showNotification('Scan failed: ' + (data.error || 'Unknown error'), 'error');
  } catch (err) { showNotification('Scan error: ' + err.message, 'error'); }
  await loadVideos();
  rescanBtn.disabled = false;
  rescanBtn.textContent = '\u21bb Rescan';
}

// ============================================================
//   NOTIFICATION
// ============================================================

let notificationTimeout = null;
function showNotification(message, type) {
  if (notificationTimeout) { clearTimeout(notificationTimeout); const old = document.querySelector('.notification'); if (old) old.remove(); }
  const el = document.createElement('div');
  el.className = 'notification' + (type === 'error' ? ' error' : '');
  el.textContent = message;
  document.body.appendChild(el);
  notificationTimeout = setTimeout(function() { el.classList.add('fade'); setTimeout(function() { el.remove(); }, 500); notificationTimeout = null; }, 3000);
}

// ============================================================
//   INIT
// ============================================================

setViewMode(viewMode);
loadVideos();
