const crypto = require('crypto');
const os = require('os');
const path = require('path');

function defaultDataDirectory() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(), 'web_vlc');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'web_vlc');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'web_vlc');
}

const DATA_DIR = path.resolve(process.env.WEBVLC_DATA_DIR || defaultDataDirectory());

const MEDIA_DIR = path.resolve(
  process.env.WEBVLC_MEDIA_DIR ||
  process.env.EDITS_DIR ||
  path.join(DATA_DIR, 'media')
);

const THUMBNAILS_DIR = path.resolve(
  process.env.WEBVLC_THUMBNAILS_DIR || path.join(DATA_DIR, 'thumbnails')
);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = path.resolve(process.env.WEBVLC_DB_PATH || path.join(DATA_DIR, 'library.db'));
const LEGACY_DB_PATH = path.join(__dirname, 'edits.db');
const USING_CUSTOM_DB = Boolean(process.env.WEBVLC_DB_PATH || process.env.WEBVLC_DATA_DIR);

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
  const thumbnailName = `${crypto.createHash('sha256').update(filename).digest('hex').slice(0, 24)}.jpg`;
  return path.join(THUMBNAILS_DIR, thumbnailName);
}

module.exports = {
  AUDIO_EXTENSIONS,
  DATA_DIR,
  DB_PATH,
  HOST,
  MEDIA_DIR,
  MEDIA_EXTENSIONS,
  MIME_TYPES,
  PORT,
  PUBLIC_DIR,
  THUMBNAILS_DIR,
  LEGACY_DB_PATH,
  USING_CUSTOM_DB,
  VIDEO_EXTENSIONS,
  isPathInsideMediaDir,
  thumbnailPathFor
};
