const assert = require('node:assert/strict');

const path = require('node:path');

const test = require('node:test');

const { AUDIO_EXTENSIONS, MEDIA_EXTENSIONS, VIDEO_EXTENSIONS, thumbnailPathFor } = require('../config');

test('thumbnail paths are stable and unique per media path', () => {
  const first = thumbnailPathFor('/media/clip.mp4');
  assert.equal(first, thumbnailPathFor('/media/clip.mp4'));
  assert.notEqual(first, thumbnailPathFor('/media/other/clip.mp4'));
  assert.equal(path.extname(first), '.jpg');
});

test('media extension sets cover common video and audio formats', () => {
  assert.ok(VIDEO_EXTENSIONS.has('.mkv'));
  assert.ok(VIDEO_EXTENSIONS.has('.mp4'));
  assert.ok(AUDIO_EXTENSIONS.has('.mp3'));
  assert.ok(AUDIO_EXTENSIONS.has('.flac'));
  assert.equal(MEDIA_EXTENSIONS.size, VIDEO_EXTENSIONS.size + AUDIO_EXTENSIONS.size);
});
