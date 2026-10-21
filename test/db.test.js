const assert = require('node:assert/strict');

const fs = require('node:fs');

const os = require('node:os');

const path = require('node:path');

const test = require('node:test');

const { DatabaseSync } = require('node:sqlite');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webvlc-db-test-'));

process.env.WEBVLC_DATA_DIR = path.join(testRoot, 'data');

process.env.WEBVLC_DB_PATH = path.join(testRoot, 'library.db');

process.env.WEBVLC_THUMBNAILS_DIR = path.join(testRoot, 'thumbnails');

delete process.env.WEBVLC_MEDIA_DIR;

const mediaDirectory = path.join(testRoot, 'media');

const nestedDirectory = path.join(mediaDirectory, 'Season 1');

const extrasDirectory = path.join(nestedDirectory, 'Extras');

fs.mkdirSync(extrasDirectory, { recursive: true });

// A v1-schema database exercises the automatic schema migration on first use.
const legacyDatabase = new DatabaseSync(process.env.WEBVLC_DB_PATH);

legacyDatabase.exec(`
  CREATE TABLE videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    full_path TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    favorite INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    thumbnail_path TEXT
  );
`);

legacyDatabase
  .prepare('INSERT INTO videos (filename, full_path, tags, favorite) VALUES (?, ?, ?, ?)')
  .run('season.mp4', path.join(nestedDirectory, 'season.mp4'), '["legacy"]', 1);

legacyDatabase.close();

fs.writeFileSync(path.join(nestedDirectory, 'season.mp4'), 'x');

const db = require('../db');

const library = require('../library');

test.after(() => {
  db.closeDb();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test('migrates a legacy (v1) database without losing rows', () => {
  const migrated = db.getAllActiveVideos().find((video) => video.filename === 'season.mp4');
  assert.ok(migrated, 'legacy row should survive the migration');
  assert.equal(migrated.favorite, 1);
  assert.equal(migrated.tags, '["legacy"]');
});

test('recursive scan discovers nested media and ignores everything else', () => {
  fs.writeFileSync(path.join(mediaDirectory, 'root-clip.mp4'), 'x');
  fs.writeFileSync(path.join(nestedDirectory, 'episode.mp3'), 'x');
  fs.writeFileSync(path.join(extrasDirectory, 'bonus.mkv'), 'x');
  fs.writeFileSync(path.join(extrasDirectory, 'notes.txt'), 'x');
  fs.mkdirSync(path.join(mediaDirectory, '.hidden'), { recursive: true });
  fs.writeFileSync(path.join(mediaDirectory, '.hidden', 'secret.mp4'), 'x');

  const scan = db.syncFolders([mediaDirectory]);
  const filenames = db.getAllActiveVideos().map((video) => video.filename).sort();
  assert.deepEqual(filenames, ['bonus.mkv', 'episode.mp3', 'root-clip.mp4', 'season.mp4']);
  assert.equal(scan.folders[0].available, true);
  assert.equal(scan.folders[0].count, 4);
});

test('keeps duplicate filenames in different folders apart', () => {
  fs.mkdirSync(path.join(mediaDirectory, 'Duplicates'), { recursive: true });
  fs.writeFileSync(path.join(mediaDirectory, 'Duplicates', 'root-clip.mp4'), 'x');
  db.syncFolders([mediaDirectory]);

  const duplicates = db.getAllActiveVideos().filter((video) => video.filename === 'root-clip.mp4');
  assert.equal(duplicates.length, 2);
  assert.notEqual(duplicates[0].full_path, duplicates[1].full_path);
  const first = db.getVideoByPath(path.join(mediaDirectory, 'root-clip.mp4'));
  const second = db.getVideoByPath(path.join(mediaDirectory, 'Duplicates', 'root-clip.mp4'));
  assert.ok(first && second && first.id !== second.id);
});

test('rescanning existing media does not consume new database IDs', () => {
  const before = db.getAllActiveVideos();
  const podcastPath = path.join(mediaDirectory, 'podcast.mp3');

  db.syncFolders([mediaDirectory]);
  fs.writeFileSync(podcastPath, 'x');
  db.syncFolders([mediaDirectory]);
  db.syncFolders([mediaDirectory]);

  const after = db.getAllActiveVideos();

  for (const video of before) {
    const current = after.find((entry) => entry.full_path === video.full_path);
    assert.equal(current.id, video.id);
  }

  assert.ok(db.getVideoByPath(podcastPath), 'new file should be indexed exactly once');
});

test('marks files missing when they disappear and restores them when they return', () => {
  const temporaryPath = path.join(mediaDirectory, 'temporary.wav');
  fs.writeFileSync(temporaryPath, 'x');
  db.syncFolders([mediaDirectory]);
  const indexed = db.getVideoByPath(temporaryPath);
  assert.ok(indexed);

  fs.rmSync(temporaryPath);
  db.syncFolders([mediaDirectory]);
  assert.equal(db.getVideoById(indexed.id), undefined);

  fs.writeFileSync(temporaryPath, 'x');
  db.syncFolders([mediaDirectory]);
  assert.ok(db.getVideoById(indexed.id), 'returning file should become active again');
});

test('reports unavailable folders and restores rows when the folder returns', () => {
  const scan = db.syncFolders([path.join(testRoot, 'detached-drive')]);
  assert.equal(scan.folders[0].available, false);
  assert.equal(scan.folders[0].count, 0);

  const restored = db.syncFolders([mediaDirectory]);
  assert.ok(restored.found > 0);
  assert.ok(db.getAllActiveVideos().length > 0);
});

test('renames files on disk and refuses conflicts or escapes', () => {
  const mediaFolder = library.addLibraryFolder(mediaDirectory);
  assert.equal(mediaFolder.added, true);

  const target = db.getVideoByPath(path.join(mediaDirectory, 'root-clip.mp4'));
  const renamed = db.updateFilename(target.id, 'renamed-clip.mp4');
  assert.equal(renamed.success, true);
  assert.equal(fs.existsSync(path.join(mediaDirectory, 'renamed-clip.mp4')), true);
  assert.equal(fs.existsSync(path.join(mediaDirectory, 'root-clip.mp4')), false);

  const conflict = db.updateFilename(renamed.id, 'podcast.mp3');
  assert.match(conflict.error, /already exists/);

  const escape = db.updateFilename(renamed.id, '..');
  assert.ok(escape.error);
});

test('deletes files from disk and marks rows deleted', () => {
  const target = db.getVideoByPath(path.join(mediaDirectory, 'podcast.mp3'));
  assert.ok(db.deleteVideo(target.id).success);
  assert.equal(fs.existsSync(path.join(mediaDirectory, 'podcast.mp3')), false);
  assert.equal(db.getVideoById(target.id), undefined);
});

test('toggles favorites and edits tags', () => {
  const target = db.getAllActiveVideos()[0];
  const favorite = db.toggleFavorite(target.id);
  assert.equal(favorite.favorite, true);
  assert.equal(db.toggleFavorite(target.id).favorite, false);

  const added = db.updateTags(target.id, 'add', 'Road Trip');
  assert.deepEqual(added.tags, ['road trip']);
  const removed = db.updateTags(target.id, 'remove', 'road trip');
  assert.deepEqual(removed.tags, []);
});
