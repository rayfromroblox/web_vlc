const path = require('path');

// The browser can select a folder at runtime, so this directory is only an
// optional drop-in library for people who prefer to keep media beside the app.
const MEDIA_DIR = path.resolve(
  process.env.WEBVLC_MEDIA_DIR ||
  process.env.EDITS_DIR ||
  path.join(__dirname, 'media')
);

const THUMBNAILS_DIR = path.join(__dirname, 'thumbnails');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = process.env.WEBVLC_DB_PATH
  ? path.resolve(process.env.WEBVLC_DB_PATH)
  : path.join(__dirname, 'edits.db');

const parsedPort = Number.parseInt(process.env.WEBVLC_PORT || process.env.PORT || '4000', 10);
const PORT = Number.isFinite(parsedPort) ? parsedPort : 4000;
const HOST = process.env.WEBVLC_HOST || '127.0.0.1';

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.wmv', '.flv', '.m4v', '.mpg', '.mpeg', '.ogv'
]);

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.flac', '.aac', '.m4a',
  '.ogg', '.opus', '.wma'
]);

const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.m4v': 'video/mp4',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wma': 'audio/x-ms-wma'
};

function isPathInsideMediaDir(targetPath) {
  const relative = path.relative(MEDIA_DIR, path.resolve(targetPath));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function thumbnailPathFor(filename) {
  const thumbnailName = filename.replace(/\.[^.]+$/, '.jpg');
  return path.join(THUMBNAILS_DIR, thumbnailName);
}

module.exports = {
  AUDIO_EXTENSIONS,
  DB_PATH,
  HOST,
  MEDIA_DIR,
  MEDIA_EXTENSIONS,
  MIME_TYPES,
  PORT,
  PUBLIC_DIR,
  THUMBNAILS_DIR,
  VIDEO_EXTENSIONS,
  isPathInsideMediaDir,
  thumbnailPathFor
};
