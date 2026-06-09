const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile, exec, execFileSync } = require('child_process');
const db = require('./db');

const app = express();
const PORT = 4000;

// --- Configuration ---
const EDITS_DIR = 'C:\\Users\\R4YY\\Desktop\\R4Y\\Media\\Edits';
const THUMBNAILS_DIR = path.join(__dirname, 'thumbnails');
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- Ensure directories exist ---
if (!fs.existsSync(THUMBNAILS_DIR)) {
  fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
}

// Check if ffmpeg is available
let ffmpegAvailable = false;
try {
  execFileSync('where', ['ffmpeg'], { encoding: 'utf8', stdio: 'pipe' });
  ffmpegAvailable = true;
} catch {
  ffmpegAvailable = false;
}

// --- Middleware ---
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/thumbnails', express.static(THUMBNAILS_DIR));

// --- Initialize database ---
db.initDb();

// Run initial scan on startup
console.log('[STARTUP] Running initial scan...');
const scanResult = db.scanDirectory();
console.log('[STARTUP] Scan result:', JSON.stringify(scanResult));

// --- Helper: safe path ---
function isPathSafe(targetPath) {
  const resolved = path.resolve(targetPath);
  const editsDir = path.resolve(EDITS_DIR);
  return resolved.startsWith(editsDir);
}

// --- MIME types ---
const MIME_TYPES = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv', '.m4v': 'video/mp4', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg'
};

// --- Thumbnail generation ---
function generateThumbnail(filename, callback) {
  if (!ffmpegAvailable) { if (callback) callback(null); return; }

  const inputPath = path.join(EDITS_DIR, filename);
  const thumbName = filename.replace(/\.[^.]+$/, '.jpg');
  const outputPath = path.join(THUMBNAILS_DIR, thumbName);

  if (!fs.existsSync(inputPath)) { if (callback) callback(null); return; }
  if (fs.existsSync(outputPath)) { if (callback) callback(outputPath); return; }

  execFile('ffmpeg', [
    '-i', inputPath, '-ss', '00:00:01', '-vframes', '1',
    '-vf', 'scale=320:-1', '-q:v', '5', '-y', outputPath
  ], { timeout: 30000 }, (err) => {
    if (err) { console.error('FFmpeg error for', filename, ':', err.message); if (callback) callback(null); return; }
    if (callback) callback(outputPath);
  });
}

// ============================================================
//   API ROUTES — All ID-based for stable identity
// ============================================================

// GET /videos — List all active videos from DB
app.get('/videos', (req, res) => {
  try {
    // Rescan in background so we're always in sync
    db.scanDirectory();

    const videos = db.getAllActiveVideos();
    const result = videos.map(v => ({
      id: v.id,
      filename: v.filename,
      tags: (() => { try { return JSON.parse(v.tags); } catch { return []; } })(),
      favorite: !!v.favorite,
      hasThumbnail: v.thumbnail_path ? fs.existsSync(v.thumbnail_path) : false
    }));

    res.json({ videos: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list videos', details: err.message });
  }
});

// GET /video/:id — Stream video by database ID
app.get('/video/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

  const video = db.getVideoById(id);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const filePath = video.full_path;
  console.log('[VIDEO] ID:', id, '→', filePath);

  if (!isPathSafe(filePath)) return res.status(403).json({ error: 'Path traversal detected' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'video/mp4';

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    if (start >= fileSize || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    const stream = fs.createReadStream(filePath, { start, end });
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);
    stream.pipe(res);
  } else {
    res.setHeader('Content-Length', fileSize);
    fs.createReadStream(filePath).pipe(res);
  }
});

// GET /thumbnail/:id — Serve thumbnail by video ID
app.get('/thumbnail/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

  const video = db.getVideoById(id);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  const thumbName = video.filename.replace(/\.[^.]+$/, '.jpg');
  const thumbPath = path.join(THUMBNAILS_DIR, thumbName);

  if (fs.existsSync(thumbPath)) return res.sendFile(thumbPath);

  // Generate on demand
  if (ffmpegAvailable) {
    generateThumbnail(video.filename, (generatedPath) => {
      if (generatedPath && fs.existsSync(generatedPath)) {
        res.sendFile(generatedPath);
      } else {
        res.status(404).json({ error: 'Thumbnail not available' });
      }
    });
  } else {
    res.status(404).json({ error: 'Thumbnail generation unavailable' });
  }
});

// POST /rename/:id — Rename file on disk + update DB
app.post('/rename/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { newName } = req.body;
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
  if (!newName) return res.status(400).json({ error: 'Missing newName' });

  const result = db.updateFilename(id, newName);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// POST /delete/:id — Delete file from disk + soft-delete in DB
app.post('/delete/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

  const result = db.deleteVideo(id);
  if (result.error) return res.status(500).json(result);
  res.json(result);
});

// POST /favorite/:id — Toggle favorite
app.post('/favorite/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

  const result = db.toggleFavorite(id);
  if (!result) return res.status(404).json({ error: 'Video not found' });
  res.json(result);
});

// POST /tags/:id — Add/remove tags
app.post('/tags/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { action, tag } = req.body;
  console.log('[TAG API] request', { id, action, tag });
  if (isNaN(id)) {
    console.log('[TAG API] invalid ID');
    return res.status(400).json({ error: 'Invalid ID' });
  }
  if (!action || !tag) {
    console.log('[TAG API] missing fields');
    return res.status(400).json({ error: 'Missing action or tag' });
  }

  // Log existing tags before mutation
  const video = db.getVideoById(id);
  let existingTags = [];
  if (video) {
    try { existingTags = JSON.parse(video.tags); } catch { existingTags = []; }
  }
  console.log('[TAG API] before', existingTags);

  const result = db.updateTags(id, action, tag);
  if (!result) {
    console.log('[TAG API] video not found');
    return res.status(404).json({ success: false, error: 'Video not found' });
  }
  console.log('[TAG API] response', result);
  res.json(result);
});

// POST /open/:id — Open video in default system player (VLC fallback)
app.post('/open/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

  const result = db.openInVLC(id);
  if (result.error) return res.status(404).json(result);

  exec(`start "" "${result.fullPath}"`, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to open file', details: err.message });
    res.json({ success: true });
  });
});

// POST /scan — Rescan directory (manual trigger)
app.post('/scan', (req, res) => {
  try {
    const result = db.scanDirectory();
    // Also generate thumbnails lazily
    const videos = db.getAllActiveVideos();
    for (const v of videos) {
      const thumbName = v.filename.replace(/\.[^.]+$/, '.jpg');
      const thumbPath = path.join(THUMBNAILS_DIR, thumbName);
      if (!fs.existsSync(thumbPath) && ffmpegAvailable) {
        generateThumbnail(v.filename, () => {});
      }
    }
    res.json({ success: true, message: 'Scan completed', ...result });
  } catch (err) {
    res.status(500).json({ error: 'Scan failed', details: err.message });
  }
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Edits Viewer running at http://localhost:${PORT}`);
  console.log(`Watching directory: ${EDITS_DIR}`);
  console.log(`FFmpeg available: ${ffmpegAvailable ? 'Yes' : 'No'}`);
});
