const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { MEDIA_DIR, isPathInsideMediaDir, thumbnailPathFor } = require('../config');

test('thumbnail paths do not collide for files with the same base name', () => {
  const mp4Thumbnail = thumbnailPathFor('clip.mp4');
  const webmThumbnail = thumbnailPathFor('clip.webm');
  assert.notEqual(mp4Thumbnail, webmThumbnail);
  assert.equal(path.extname(mp4Thumbnail), '.jpg');
});

test('rejects paths outside the configured media directory', () => {
  assert.equal(isPathInsideMediaDir(path.join(MEDIA_DIR, 'clip.mp4')), true);
  assert.equal(isPathInsideMediaDir(path.resolve(MEDIA_DIR, '..', 'clip.mp4')), false);
});
