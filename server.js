const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const db = require('./db');
const {
  HOST,
  MEDIA_DIR,
  MIME_TYPES,
  PORT,
  PUBLIC_DIR,
  THUMBNAILS_DIR,
  VIDEO_EXTENSIONS,
  isPathInsideMediaDir,
  thumbnailPathFor
} = require('./config');

const app = express();

fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });

let ffmpegAvailable = false;
try {
  execFileSync('ffmpeg', ['-version'], { encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
  ffmpegAvailable = true;
} catch {
  ffmpegAvailable = false;
}

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: 0 }));

db.initDb();

function parseTags(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mediaDirectoryAvailable() {
  try {
    return fs.statSync(MEDIA_DIR).isDirectory();
  } catch {
    return false;
  }
}

function displayPath(value) {
  const normalized = value.replaceAll('\\', '/');
  return normalized.split('/').filter(Boolean).pop() || value;
}

function mediaDetails(video) {
  const extension = path.extname(video.filename).toLowerCase();
  const thumbnailPath = thumbnailPathFor(video.filename);
  let stat = null;
  const safe = isPathInsideMediaDir(video.full_path);
  if (safe) {
    try {
      stat = fs.statSync(video.full_path);
    } catch {
      stat = null;
    }
  }

  return {
    id: video.id,
    filename: video.filename,
    tags: parseTags(video.tags),
    favorite: Boolean(video.favorite),
    hasThumbnail: VIDEO_EXTENSIONS.has(extension) && fs.existsSync(thumbnailPath),
    mediaType: VIDEO_EXTENSIONS.has(extension) ? 'video' : 'audio',
    extension: extension.slice(1),
    size: stat?.size || 0,
    modifiedAt: stat?.mtime?.toISOString() || video.created_at || video.last_seen,
    lastSeen: video.last_seen,
    available: Boolean(stat?.isFile())
  };
}

function generateThumbnail(video, callback) {
  const extension = path.extname(video.filename).toLowerCase();
  if (!ffmpegAvailable || !VIDEO_EXTENSIONS.has(extension)) return callback(null);
  if (!isPathInsideMediaDir(video.full_path) || !fs.existsSync(video.full_path)) return callback(null);

  const outputPath = thumbnailPathFor(video.filename);
  if (fs.existsSync(outputPath)) return callback(outputPath);

  execFile('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-ss', '00:00:01', '-i', video.full_path,
    '-frames:v', '1', '-vf', 'scale=640:-2',
    '-q:v', '5', '-y', outputPath
  ], { timeout: 45000 }, (error) => {
    if (error) {
      console.warn(`[thumbnail] ${video.filename}:`, error.message);
      callback(null);
      return;
    }
    callback(outputPath);
  });
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    app: 'web_vlc',
    libraryAvailable: mediaDirectoryAvailable(),
    ffmpegAvailable
  });
});

app.get('/videos', (req, res) => {
  try {
    const scan = db.scanDirectory();
    const videos = db.getAllActiveVideos().map(mediaDetails);
    res.json({
      videos,
      library: {
        path: MEDIA_DIR,
        displayPath: displayPath(MEDIA_DIR),
        available: mediaDirectoryAvailable(),
        ffmpegAvailable
      },
      scan
    });
  } catch (error) {
    console.error('[videos]', error);
    res.status(500).json({ error: 'Failed to load the media library' });
  }
});

app.get('/video/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid media ID' });

  const video = db.getVideoById(id);
  if (!video) return res.status(404).json({ error: 'Media not found' });
  if (!isPathInsideMediaDir(video.full_path)) return res.status(403).json({ error: 'Media is outside the configured library' });

  let stat;
  try {
    stat = fs.statSync(video.full_path);
  } catch {
    return res.status(404).json({ error: 'Media file is offline' });
  }
  if (!stat.isFile()) return res.status(404).json({ error: 'Media file is offline' });

  const fileSize = stat.size;
  const extension = path.extname(video.full_path).toLowerCase();
  const mimeType = MIME_TYPES[extension] || 'application/octet-stream';
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

  if (!range) {
    res.setHeader('Content-Length', fileSize);
    const stream = fs.createReadStream(video.full_path);
    stream.on('error', () => { if (!res.headersSent) res.sendStatus(500); else res.destroy(); });
    req.on('close', () => stream.destroy());
    stream.pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    res.setHeader('Content-Range', `bytes */${fileSize}`);
    return res.sendStatus(416);
  }

  let start = match[1] ? Number.parseInt(match[1], 10) : 0;
  let end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number.parseInt(match[2], 10);
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= fileSize) {
    res.setHeader('Content-Range', `bytes */${fileSize}`);
    return res.sendStatus(416);
  }
  end = Math.min(end, fileSize - 1);

  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  res.setHeader('Content-Length', end - start + 1);
  const stream = fs.createReadStream(video.full_path, { start, end });
  stream.on('error', () => res.destroy());
  req.on('close', () => stream.destroy());
  stream.pipe(res);
});

app.get('/thumbnail/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid media ID' });

  const video = db.getVideoById(id);
  if (!video) return res.status(404).json({ error: 'Media not found' });
  const extension = path.extname(video.filename).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(extension)) return res.status(404).json({ error: 'Audio items do not have video thumbnails' });

  const thumbnailPath = thumbnailPathFor(video.filename);
  const sendThumbnail = (filePath) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  };

  if (fs.existsSync(thumbnailPath)) return sendThumbnail(thumbnailPath);
  generateThumbnail(video, (generatedPath) => {
    if (!generatedPath || !fs.existsSync(generatedPath)) return res.status(404).json({ error: 'Thumbnail unavailable' });
    sendThumbnail(generatedPath);
  });
});

app.post('/rename/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const newName = typeof req.body?.newName === 'string' ? req.body.newName.trim() : '';
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid media ID' });
  if (!newName || newName.length > 255) return res.status(400).json({ error: 'Invalid filename' });

  const result = db.updateFilename(id, newName);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/delete/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid media ID' });
  const result = db.deleteVideo(id);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/favorite/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid media ID' });
  const result = db.toggleFavorite(id);
  if (!result) return res.status(404).json({ error: 'Media not found' });
  res.json(result);
});

app.post('/tags/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const action = req.body?.action;
  const tag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid media ID' });
  if (!['add', 'remove'].includes(action) || !tag || tag.length > 50) {
    return res.status(400).json({ error: 'Invalid tag update' });
  }

  const result = db.updateTags(id, action, tag);
  if (!result) return res.status(404).json({ error: 'Media not found' });
  res.json(result);
});

function openDesktopFile(filePath, callback) {
  if (process.platform === 'win32') {
    execFile('cmd.exe', ['/d', '/s', '/c', 'start', '', filePath], callback);
  } else if (process.platform === 'darwin') {
    execFile('open', [filePath], callback);
  } else {
    execFile('xdg-open', [filePath], callback);
  }
}

app.post('/open/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid media ID' });
  const result = db.openInDesktop(id);
  if (result.error) return res.status(404).json(result);

  openDesktopFile(result.fullPath, (error) => {
    if (error) return res.status(500).json({ error: 'Failed to open the desktop player' });
    res.json({ success: true });
  });
});

app.post('/scan', (req, res) => {
  try {
    const result = db.scanDirectory();
    if (result.available && ffmpegAvailable) {
      db.getAllActiveVideos().forEach((video) => {
        const extension = path.extname(video.filename).toLowerCase();
        if (VIDEO_EXTENSIONS.has(extension) && !fs.existsSync(thumbnailPathFor(video.filename))) {
          generateThumbnail(video, () => {});
        }
      });
    }
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[scan]', error);
    res.status(500).json({ error: 'Scan failed' });
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('[server]', error);
  res.status(500).json({ error: 'Unexpected server error' });
});

function startServer() {
  const scan = db.scanDirectory();
  const server = app.listen(PORT, HOST, () => {
    console.log(`\n  web_vlc is ready → http://${HOST}:${PORT}`);
    console.log(`  Media folder       → ${MEDIA_DIR}`);
    console.log(`  Folder connected   → ${scan.available ? 'yes' : 'no'}`);
    console.log(`  FFmpeg thumbnails  → ${ffmpegAvailable ? 'enabled' : 'unavailable'}\n`);
  });
  return server;
}

if (require.main === module) {
  const server = startServer();
  const shutdown = () => {
    server.close(() => {
      db.closeDb();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { app, startServer };
