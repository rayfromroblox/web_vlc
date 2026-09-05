const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webvlc-db-test-'));
process.env.WEBVLC_MEDIA_DIR = path.join(testRoot, 'media');
process.env.WEBVLC_DB_PATH = path.join(testRoot, 'library.db');
process.env.WEBVLC_THUMBNAILS_DIR = path.join(testRoot, 'thumbnails');
fs.mkdirSync(process.env.WEBVLC_MEDIA_DIR, { recursive: true });

const db = require('../db');

test.after(() => {
  db.closeDb();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test('rescanning existing media does not consume new database IDs', () => {
  fs.writeFileSync(path.join(process.env.WEBVLC_MEDIA_DIR, 'one.mp3'), 'one');
  db.scanDirectory();
  const first = db.getVideoByFilename('one.mp3');
  assert.equal(first.id, 1);

  db.scanDirectory();
  fs.writeFileSync(path.join(process.env.WEBVLC_MEDIA_DIR, 'two.mp3'), 'two');
  db.scanDirectory();

  assert.equal(db.getVideoByFilename('two.mp3').id, 2);
});

test('renaming into a deleted filename preserves the live media record', () => {
  fs.writeFileSync(path.join(process.env.WEBVLC_MEDIA_DIR, 'old-name.mp3'), 'old');
  db.scanDirectory();
  const deleted = db.getVideoByFilename('old-name.mp3');
  assert.equal(db.deleteVideo(deleted.id).success, true);

  fs.writeFileSync(path.join(process.env.WEBVLC_MEDIA_DIR, 'new-name.mp3'), 'new');
  db.scanDirectory();
  const live = db.getVideoByFilename('new-name.mp3');
  assert.equal(db.updateFilename(live.id, 'old-name.mp3').success, true);

  const renamed = db.getVideoByFilename('old-name.mp3');
  assert.equal(renamed.id, live.id);
  assert.equal(fs.existsSync(path.join(process.env.WEBVLC_MEDIA_DIR, 'old-name.mp3')), true);
  assert.equal(fs.existsSync(path.join(process.env.WEBVLC_MEDIA_DIR, 'new-name.mp3')), false);
});
