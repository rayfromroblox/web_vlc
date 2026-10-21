const fs = require('fs');

const path = require('path');

const { DatabaseSync } = require('node:sqlite');

const {
  DB_PATH,
  LEGACY_DB_PATH,
  MEDIA_EXTENSIONS,
  USING_CUSTOM_DB,
  thumbnailPathFor
} = require('./config');

const { isInsideLibrary } = require('./library');

const MAX_SCAN_DEPTH = 12;

let db;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS videos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    filename   TEXT NOT NULL,
    full_path  TEXT NOT NULL UNIQUE,
    tags       TEXT NOT NULL DEFAULT '[]',
    favorite   INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
  CREATE INDEX IF NOT EXISTS idx_videos_filename ON videos(filename);
`;

function migrateLegacyDatabaseFile() {
  if (USING_CUSTOM_DB || fs.existsSync(DB_PATH) || !fs.existsSync(LEGACY_DB_PATH)) return;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${LEGACY_DB_PATH}${suffix}`;

    if (fs.existsSync(source)) {
      try {
        fs.copyFileSync(source, `${DB_PATH}${suffix}`);
      } catch { /* a missing sidecar is not fatal */ }
    }
  }

  console.log('[db] Imported the previous local library database.');
}

function migrateLegacySchema(database) {
  const table = database.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'videos'
  `).get();

  if (!table?.sql || !/filename\s+TEXT\s+NOT NULL\s+UNIQUE/i.test(table.sql)) return;

  console.log('[db] Upgrading the library schema (duplicate filenames are now supported).');
  database.exec(`
    BEGIN;
    ALTER TABLE videos RENAME TO videos_legacy;
    ${SCHEMA_SQL}
    INSERT OR IGNORE INTO videos (id, filename, full_path, tags, favorite, status, created_at, last_seen)
      SELECT id, filename, full_path, tags, favorite, status, created_at, last_seen
      FROM videos_legacy ORDER BY id;
    DROP TABLE videos_legacy;
    COMMIT;
  `);
}

function initDb() {
  if (db) return db;
  migrateLegacyDatabaseFile();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH, { timeout: 5000 });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrateLegacySchema(db);
  db.exec(SCHEMA_SQL);
  console.log('[db] Ready:', DB_PATH);

  return db;
}

function getDb() {
  return db || initDb();
}

function withTransaction(callback) {
  const database = getDb();
  database.exec('BEGIN');

  try {
    const result = callback();
    database.exec('COMMIT');

    return result;
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* surface the original error */ }

    throw error;
  }
}

function getVideoById(id) {
  return getDb().prepare('SELECT * FROM videos WHERE id = ? AND status = ?').get(id, 'active');
}

function getVideoByPath(fullPath) {
  return getDb().prepare('SELECT * FROM videos WHERE full_path = ?').get(path.resolve(fullPath));
}

function getAllActiveVideos() {
  return getDb().prepare(`
    SELECT id, filename, full_path, tags, favorite, created_at, last_seen
    FROM videos
    WHERE status = ?
    ORDER BY filename COLLATE NOCASE
  `).all('active');
}

function walkMediaFiles(directory, depth, output) {
  if (depth > MAX_SCAN_DEPTH) return;
  let entries;

  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walkMediaFiles(entryPath, depth + 1, output);
    } else if (entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      output.push(entryPath);
    }
  }
}

function syncFolders(folders) {
  const database = getDb();
  const foundPaths = new Set();

  const folderStats = folders.map((folder) => {
    let available = false;

    try {
      available = fs.statSync(folder).isDirectory();
    } catch {
      available = false;
    }

    if (!available) return { path: folder, available: false, count: 0 };

    const files = [];
    walkMediaFiles(folder, 0, files);
    files.forEach((file) => foundPaths.add(file));

    return { path: folder, available: true, count: files.length };
  });

  const existingByPath = new Map(
    database.prepare('SELECT id, filename, full_path FROM videos').all().map((row) => [row.full_path, row])
  );

  const insertMedia = database.prepare(`
    INSERT INTO videos (filename, full_path, tags, favorite, status, last_seen)
    VALUES (?, ?, '[]', 0, 'active', datetime('now'))
  `);

  const refreshMedia = database.prepare(`
    UPDATE videos SET filename = ?, status = 'active', last_seen = datetime('now') WHERE id = ?
  `);

  const markMissing = database.prepare('UPDATE videos SET status = ? WHERE id = ?');

  const result = withTransaction(() => {
    let inserted = 0;
    let updated = 0;
    let markedMissing = 0;

    for (const fullPath of foundPaths) {
      const existing = existingByPath.get(fullPath);

      if (!existing) {
        insertMedia.run(path.basename(fullPath), fullPath);
        inserted += 1;
      } else if (existing.status !== 'active') {
        refreshMedia.run(path.basename(fullPath), existing.id);
        updated += 1;
      }
    }

    for (const row of existingByPath.values()) {
      if (!foundPaths.has(row.full_path)) {
        markedMissing += markMissing.run('missing', row.id).changes || 0;
      }
    }

    return { inserted, updated, markedMissing };
  });

  return {
    folders: folderStats,
    found: foundPaths.size,
    ...result
  };
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

function moveThumbnail(oldPath, newPath) {
  const oldThumbnail = thumbnailPathFor(oldPath);
  const newThumbnail = thumbnailPathFor(newPath);

  if (oldThumbnail === newThumbnail || !fs.existsSync(oldThumbnail)) return;

  try {
    if (fs.existsSync(newThumbnail)) fs.unlinkSync(newThumbnail);
    fs.renameSync(oldThumbnail, newThumbnail);
  } catch {
    // Thumbnails are expendable and regenerate on demand.
  }
}

function updateFilename(id, newFilename) {
  const video = getVideoById(id);

  if (!video) return { error: 'Media not found' };

  if (!isInsideLibrary(video.full_path)) return { error: 'File is outside your media folders' };

  const safeName = path.basename(String(newFilename).trim());

  if (!safeName || safeName === '.' || safeName === '..') return { error: 'Invalid filename' };
  const extension = path.extname(safeName).toLowerCase();

  if (!MEDIA_EXTENSIONS.has(extension)) return { error: 'Unsupported media extension' };

  const oldPath = video.full_path;
  const newPath = path.join(path.dirname(oldPath), safeName);

  if (!isInsideLibrary(newPath)) return { error: 'Invalid destination path' };

  if (oldPath === newPath) return { success: true, filename: safeName, id };

  if (fs.existsSync(newPath)) return { error: 'A file with that name already exists' };

  const conflicting = getVideoByPath(newPath);

  if (conflicting && conflicting.id !== id) {
    return { error: 'Another library item already uses that file' };
  }

  try {
    fs.renameSync(oldPath, newPath);
    getDb().prepare(`
      UPDATE videos
      SET filename = ?, full_path = ?, last_seen = datetime('now')
      WHERE id = ?
    `).run(safeName, newPath, id);
    moveThumbnail(oldPath, newPath);

    return { success: true, filename: safeName, id };
  } catch (error) {
    if (fs.existsSync(newPath) && !fs.existsSync(oldPath)) {
      try { fs.renameSync(newPath, oldPath); } catch { /* surface the original error below */ }
    }

    return { error: error.message };
  }
}

function deleteVideo(id) {
  const video = getVideoById(id);

  if (!video) return { error: 'Media not found' };

  if (!isInsideLibrary(video.full_path)) return { error: 'File is outside your media folders' };

  try {
    fs.unlinkSync(video.full_path);
  } catch (error) {
    return { error: error.message };
  }

  const thumbnailPath = thumbnailPathFor(video.full_path);

  if (fs.existsSync(thumbnailPath)) {
    try { fs.unlinkSync(thumbnailPath); } catch { /* deleting the media remains authoritative */ }
  }

  getDb().prepare('UPDATE videos SET status = ? WHERE id = ?').run('deleted', id);

  return { success: true, id };
}

function openInDesktop(id) {
  const video = getVideoById(id);

  if (!video) return { error: 'Media not found' };

  if (!isInsideLibrary(video.full_path)) return { error: 'File is outside your media folders' };

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
  getVideoById,
  getVideoByPath,
  initDb,
  openInDesktop,
  syncFolders,
  toggleFavorite,
  updateFilename,
  updateTags
};
