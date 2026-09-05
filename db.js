const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const {
  DB_PATH,
  LEGACY_DB_PATH,
  MEDIA_DIR,
  MEDIA_EXTENSIONS,
  VIDEO_EXTENSIONS,
  isPathInsideMediaDir,
  thumbnailPathFor,
  USING_CUSTOM_DB
} = require('./config');

let db;

function initDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!USING_CUSTOM_DB && DB_PATH !== LEGACY_DB_PATH && !fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    console.log('[db] Imported the previous local library database.');
  }
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      filename       TEXT NOT NULL UNIQUE,
      full_path      TEXT NOT NULL,
      tags           TEXT NOT NULL DEFAULT '[]',
      favorite       INTEGER NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'active',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen      TEXT NOT NULL DEFAULT (datetime('now')),
      thumbnail_path TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
    CREATE INDEX IF NOT EXISTS idx_videos_filename ON videos(filename);
    CREATE INDEX IF NOT EXISTS idx_videos_full_path ON videos(full_path);
  `);

  console.log('[db] Ready:', DB_PATH);
  return db;
}

function getDb() {
  return db || initDb();
}

function getVideoById(id) {
  return getDb().prepare('SELECT * FROM videos WHERE id = ? AND status = ?').get(id, 'active');
}

function getVideoByFilename(filename) {
  return getDb().prepare('SELECT * FROM videos WHERE filename = ? AND status = ?').get(filename, 'active');
}

function getAllActiveVideos() {
  return getDb().prepare(`
    SELECT id, filename, full_path, tags, favorite, thumbnail_path, created_at, last_seen
    FROM videos
    WHERE status = ?
    ORDER BY filename COLLATE NOCASE
  `).all('active');
}

function scanDirectory() {
  const database = getDb();
  let entries;

  try {
    entries = fs.readdirSync(MEDIA_DIR, { withFileTypes: true });
  } catch (error) {
    console.warn('[scan] Media folder unavailable:', error.message);
    return {
      available: false,
      inserted: 0,
      updated: 0,
      markedMissing: 0,
      error: error.message
    };
  }

  const foundPaths = new Set();
  const existingByName = new Map(
    database.prepare('SELECT id, filename, full_path, status FROM videos').all().map((item) => [item.filename, item])
  );
  const insertMedia = database.prepare(`
    INSERT INTO videos (filename, full_path, tags, favorite, status, last_seen, thumbnail_path)
    VALUES (?, ?, '[]', 0, 'active', datetime('now'), ?)
  `);
  const refreshMedia = database.prepare(`
    UPDATE videos
    SET full_path = ?, last_seen = datetime('now'), status = 'active', thumbnail_path = ?
    WHERE id = ?
  `);
  const markMissing = database.prepare('UPDATE videos SET status = ? WHERE id = ?');

  const result = database.transaction(() => {
    let inserted = 0;
    let updated = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!MEDIA_EXTENSIONS.has(extension)) continue;

      const fullPath = path.join(MEDIA_DIR, entry.name);
      foundPaths.add(fullPath);
      const thumbnailPath = VIDEO_EXTENSIONS.has(extension) && fs.existsSync(thumbnailPathFor(entry.name))
        ? thumbnailPathFor(entry.name)
        : null;
      const existing = existingByName.get(entry.name);

      if (!existing) {
        insertMedia.run(entry.name, fullPath, thumbnailPath);
        inserted += 1;
      } else {
        refreshMedia.run(fullPath, thumbnailPath, existing.id);
        if (existing.full_path !== fullPath || existing.status !== 'active') updated += 1;
      }
    }

    let markedMissing = 0;
    const activeRows = database.prepare('SELECT id, full_path FROM videos WHERE status = ?').all('active');
    for (const item of activeRows) {
      if (!foundPaths.has(item.full_path)) {
        markedMissing += markMissing.run('missing', item.id).changes;
      }
    }

    return { available: true, inserted, updated, markedMissing };
  })();

  return result;
}

function toggleFavorite(id) {
  const video = getVideoById(id);
  if (!video) return null;
  const favorite = video.favorite ? 0 : 1;
  getDb().prepare('UPDATE videos SET favorite = ? WHERE id = ?').run(favorite, id);
  return { id, favorite: Boolean(favorite) };
}

function updateTags(id, action, rawTag) {
  const video = getVideoById(id);
  if (!video) return null;

  let tags;
  try {
    tags = JSON.parse(video.tags);
    if (!Array.isArray(tags)) tags = [];
  } catch {
    tags = [];
  }

  const tag = String(rawTag).trim().toLowerCase().slice(0, 50);
  if (action === 'add' && tag && !tags.includes(tag)) tags.push(tag);
  if (action === 'remove') tags = tags.filter((item) => item !== tag);

  getDb().prepare('UPDATE videos SET tags = ? WHERE id = ?').run(JSON.stringify(tags), id);
  return { success: true, id, tags };
}

function updateFilename(id, newFilename) {
  const video = getVideoById(id);
  if (!video) return { error: 'Media not found' };
  if (!isPathInsideMediaDir(video.full_path)) return { error: 'File is outside the configured media folder' };

  const safeName = path.basename(String(newFilename).trim());
  if (!safeName || safeName === '.' || safeName === '..') return { error: 'Invalid filename' };
  const extension = path.extname(safeName).toLowerCase();
  if (!MEDIA_EXTENSIONS.has(extension)) return { error: 'Unsupported media extension' };

  const oldPath = video.full_path;
  const newPath = path.join(path.dirname(oldPath), safeName);
  if (!isPathInsideMediaDir(newPath)) return { error: 'Invalid destination path' };
  if (oldPath === newPath) return { success: true, filename: safeName, id };
  if (fs.existsSync(newPath)) return { error: 'A file with that name already exists' };

  const conflictingRecord = getDb().prepare(`
    SELECT id, status FROM videos WHERE filename = ? AND id != ?
  `).get(safeName, id);
  if (conflictingRecord?.status === 'active') {
    return { error: 'Another library item already uses that filename' };
  }

  try {
    fs.renameSync(oldPath, newPath);
    const oldThumbnail = thumbnailPathFor(video.filename);
    const newThumbnail = thumbnailPathFor(safeName);

    getDb().transaction(() => {
      // Deleted and missing rows keep their history, but must not reserve a
      // filename when a live item is renamed into it.
      if (conflictingRecord) {
        getDb().prepare('DELETE FROM videos WHERE id = ?').run(conflictingRecord.id);
      }
      getDb().prepare(`
        UPDATE videos
        SET filename = ?, full_path = ?, thumbnail_path = ?, last_seen = datetime('now')
        WHERE id = ?
      `).run(safeName, newPath, null, id);
    })();

    if (fs.existsSync(oldThumbnail) && oldThumbnail !== newThumbnail) {
      try {
        if (fs.existsSync(newThumbnail)) fs.unlinkSync(newThumbnail);
        fs.renameSync(oldThumbnail, newThumbnail);
        getDb().prepare('UPDATE videos SET thumbnail_path = ? WHERE id = ?').run(newThumbnail, id);
      } catch {
        // A thumbnail is expendable and can be regenerated without affecting the media rename.
      }
    }

    return { success: true, filename: safeName, id };
  } catch (error) {
    // Do not report a failed rename after changing the file on disk.
    if (fs.existsSync(newPath) && !fs.existsSync(oldPath)) {
      try { fs.renameSync(newPath, oldPath); } catch { /* surface the original error below */ }
    }
    return { error: error.message };
  }
}

function deleteVideo(id) {
  const video = getVideoById(id);
  if (!video) return { error: 'Media not found' };
  if (!isPathInsideMediaDir(video.full_path)) return { error: 'File is outside the configured media folder' };

  try {
    fs.unlinkSync(video.full_path);
    const thumbnailPath = thumbnailPathFor(video.filename);
    if (fs.existsSync(thumbnailPath)) {
      try { fs.unlinkSync(thumbnailPath); } catch { /* deleting the media remains authoritative */ }
    }
    getDb().prepare('UPDATE videos SET status = ? WHERE id = ?').run('deleted', id);
    return { success: true, id };
  } catch (error) {
    return { error: error.message };
  }
}

function openInDesktop(id) {
  const video = getVideoById(id);
  if (!video) return { error: 'Media not found' };
  if (!isPathInsideMediaDir(video.full_path)) return { error: 'File is outside the configured media folder' };
  if (!fs.existsSync(video.full_path)) return { error: 'File is not available on disk' };
  return { fullPath: video.full_path };
}

function closeDb() {
  if (!db) return;
  db.close();
  db = null;
}

module.exports = {
  closeDb,
  deleteVideo,
  getAllActiveVideos,
  getDb,
  getVideoByFilename,
  getVideoById,
  initDb,
  openInDesktop,
  scanDirectory,
  toggleFavorite,
  updateFilename,
  updateTags
};
