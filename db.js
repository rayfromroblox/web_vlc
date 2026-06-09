// db.js — SQLite database layer (replaces metadata.json)
// Source of truth for app state. Filesystem is source of media.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'edits.db');
const EDITS_DIR = 'C:\\Users\\R4YY\\Desktop\\R4Y\\Media\\Edits';
const THUMBNAILS_DIR = path.join(__dirname, 'thumbnails');

let db;

function initDb() {
  db = new Database(DB_PATH);

  // Enable WAL mode for concurrent read performance
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      filename      TEXT NOT NULL UNIQUE,
      full_path     TEXT NOT NULL,
      tags          TEXT NOT NULL DEFAULT '[]',
      favorite      INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen     TEXT NOT NULL DEFAULT (datetime('now')),
      thumbnail_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
    CREATE INDEX IF NOT EXISTS idx_videos_filename ON videos(filename);
    CREATE INDEX IF NOT EXISTS idx_videos_full_path ON videos(full_path);
  `);

  console.log('[DB] Initialized:', DB_PATH);
  return db;
}

function getDb() {
  if (!db) return initDb();
  return db;
}

// --- Video lookup helpers ---

function getVideoById(id) {
  return getDb().prepare('SELECT * FROM videos WHERE id = ? AND status = ?').get(id, 'active');
}

function getVideoByFilename(filename) {
  return getDb().prepare('SELECT * FROM videos WHERE filename = ? AND status = ?').get(filename, 'active');
}

function getAllActiveVideos() {
  return getDb().prepare(
    'SELECT id, filename, tags, favorite, thumbnail_path, last_seen FROM videos WHERE status = ? ORDER BY filename COLLATE NOCASE'
  ).all('active');
}

// --- Scanner: sync filesystem → database ---

const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.wmv', '.flv', '.m4v', '.mpg', '.mpeg'
]);

function scanDirectory() {
  const db = getDb();
  const foundPaths = new Set();
  const inserted = [];
  const updated = [];

  let entries;
  try {
    entries = fs.readdirSync(EDITS_DIR, { withFileTypes: true });
  } catch (err) {
    console.error('[SCAN] Failed to read directory:', err.message);
    return { inserted: 0, updated: 0, markedMissing: 0 };
  }

  const insertStmt = db.prepare(`
    INSERT INTO videos (filename, full_path, tags, favorite, status, last_seen, thumbnail_path)
    VALUES (?, ?, '[]', 0, 'active', datetime('now'), ?)
    ON CONFLICT(filename) DO UPDATE SET
      full_path = excluded.full_path,
      last_seen = datetime('now'),
      status = 'active'
  `);

  const transaction = db.transaction(() => {
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTS.has(ext)) continue;

      const fullPath = path.join(EDITS_DIR, entry.name);
      foundPaths.add(fullPath);

      // Determine thumbnail path
      const thumbName = entry.name.replace(/\.[^.]+$/, '.jpg');
      const thumbPath = path.join(THUMBNAILS_DIR, thumbName);
      const thumbnailExists = fs.existsSync(thumbPath) ? thumbPath : null;

      const result = insertStmt.run(entry.name, fullPath, thumbnailExists);
      if (result.changes > 0) {
        if (result.lastInsertRowid) {
          inserted.push(entry.name);
        } else {
          updated.push(entry.name);
        }
      }
    }

    // Mark records as missing if their file is no longer on disk
    const missing = db.prepare(
      'UPDATE videos SET status = ? WHERE status = ? AND full_path NOT IN (' +
        Array.from(foundPaths).map(p => `'${p.replace(/'/g, "''")}'`).join(',') +
      ')'
    );
    // Only mark missing if we actually found files (avoid wiping on empty scan)
    if (foundPaths.size > 0) {
      const missingCount = missing.run('missing', 'active').changes;
      return { inserted: inserted.length, updated: updated.length, markedMissing: missingCount };
    }
    return { inserted: inserted.length, updated: updated.length, markedMissing: 0 };
  });

  return transaction();
}

// --- Metadata update helpers ---

function toggleFavorite(id) {
  const video = getVideoById(id);
  if (!video) return null;
  const newVal = video.favorite ? 0 : 1;
  getDb().prepare('UPDATE videos SET favorite = ? WHERE id = ?').run(newVal, id);
  return { id, favorite: !!newVal };
}

function updateTags(id, action, tag) {
  const video = getVideoById(id);
  if (!video) return null;

  let tags;
  try { tags = JSON.parse(video.tags); } catch { tags = []; }

  if (action === 'add') {
    const lower = tag.toLowerCase().trim();
    if (lower && !tags.includes(lower)) tags.push(lower);
  } else if (action === 'remove') {
    tags = tags.filter(t => t !== tag);
  }

  getDb().prepare('UPDATE videos SET tags = ? WHERE id = ?').run(JSON.stringify(tags), id);
  console.log('[TAG API] after', tags);
  return { success: true, id, tags };
}

function updateFilename(id, newFilename) {
  const video = getVideoById(id);
  if (!video) return { error: 'Video not found' };

  const safeNew = path.basename(newFilename);
  if (!safeNew) return { error: 'Invalid filename' };

  const oldPath = video.full_path;
  const dir = path.dirname(oldPath);
  const newPath = path.join(dir, safeNew);

  if (oldPath === newPath) return { success: true, filename: safeNew };

  // Check if target already exists
  if (fs.existsSync(newPath)) return { error: 'A file with that name already exists' };

  try {
    fs.renameSync(oldPath, newPath);

    // Rename thumbnail if it exists
    const oldThumbName = video.filename.replace(/\.[^.]+$/, '.jpg');
    const newThumbName = safeNew.replace(/\.[^.]+$/, '.jpg');
    const oldThumbPath = path.join(THUMBNAILS_DIR, oldThumbName);
    const newThumbPath = path.join(THUMBNAILS_DIR, newThumbName);
    if (fs.existsSync(oldThumbPath)) {
      try { fs.renameSync(oldThumbPath, newThumbPath); } catch (e) {}
    }

    getDb().prepare(
      'UPDATE videos SET filename = ?, full_path = ?, thumbnail_path = ? WHERE id = ?'
    ).run(safeNew, newPath, fs.existsSync(newThumbPath) ? newThumbPath : null, id);

    return { success: true, filename: safeNew, id };
  } catch (err) {
    return { error: err.message };
  }
}

function deleteVideo(id) {
  const video = getVideoById(id);
  if (!video) return { error: 'Video not found' };

  try {
    fs.unlinkSync(video.full_path);

    // Remove thumbnail
    const thumbName = video.filename.replace(/\.[^.]+$/, '.jpg');
    const thumbPath = path.join(THUMBNAILS_DIR, thumbName);
    if (fs.existsSync(thumbPath)) {
      try { fs.unlinkSync(thumbPath); } catch (e) {}
    }

    getDb().prepare('UPDATE videos SET status = ? WHERE id = ?').run('deleted', id);
    return { success: true, id };
  } catch (err) {
    return { error: err.message };
  }
}

function openInVLC(id) {
  const video = getVideoById(id);
  if (!video) return { error: 'Video not found' };
  return { fullPath: video.full_path };
}

// --- Cleanup ---
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  initDb,
  getDb,
  getVideoById,
  getVideoByFilename,
  getAllActiveVideos,
  scanDirectory,
  toggleFavorite,
  updateTags,
  updateFilename,
  deleteVideo,
  openInVLC,
  closeDb
};
