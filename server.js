const express = require('express');

const fs = require('fs');

const http = require('http');

const path = require('path');

const { execFile, execFileSync, spawn } = require('child_process');

const db = require('./db');

const library = require('./library');

const {
  DATA_DIR,
  HOST,
  MIME_TYPES,
  PORT,
  PUBLIC_DIR,
  THUMBNAILS_DIR,
  VIDEO_EXTENSIONS,
  thumbnailPathFor
} = require('./config');

const app = express();

const ffmpegCommand = process.env.WEBVLC_FFMPEG_PATH || 'ffmpeg';

fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });

let ffmpegAvailable = false;

const thumbnailJobs = new Map();

const failedThumbnailPaths = new Map();

const thumbnailQueue = [];

const MAX_CONCURRENT_THUMBNAILS = 1;

let activeThumbnailJobs = 0;

try {
  execFileSync(ffmpegCommand, ['-version'], { encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
  ffmpegAvailable = true;
} catch {
  ffmpegAvailable = false;
}

app.disable('x-powered-by');

app.use(express.json({ limit: '32kb' }));

app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: 0
}));

db.initDb();

function parseTags(value) {
  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Request bodies are decoded JSON; JSON primitives keep the global String
// constructor, so constructor identity decodes a real string exactly.
function decodeTrimmedString(value) {
  return value?.constructor === String ? value.trim() : '';
}

function mediaDetails(video) {
  const extension = path.extname(video.filename).toLowerCase();
  const thumbnailPath = thumbnailPathFor(video.full_path);
  const folder = library.libraryFolderFor(video.full_path);
  let stat = null;

  if (folder) {
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
    available: Boolean(stat?.isFile()),
    folder: folder ? path.basename(folder) : '',
    relativePath: folder ? path.relative(folder, video.full_path) : video.filename
  };
}

function libraryPayload(scan) {
  const counts = new Map((scan?.folders || []).map((folder) => [folder.path, folder]));

  return {
    folders: library.getLibraryFolders().map((folderPath) => {
      const stats = counts.get(folderPath);

      return {
        path: folderPath,
        name: path.basename(folderPath) || folderPath,
        available: stats ? stats.available : false,
        count: stats ? stats.count : 0
      };
    }),
    ffmpegAvailable,
    preferences: library.getPreferences()
  };
}

function generateThumbnail(video, callback) {
  const extension = path.extname(video.filename).toLowerCase();

  if (!ffmpegAvailable || !VIDEO_EXTENSIONS.has(extension)) return callback(null);

  const outputPath = thumbnailPathFor(video.full_path);

  if (fs.existsSync(outputPath)) return callback(outputPath);

  const sourceSignature = (() => {
    try {
      const sourceStat = fs.statSync(video.full_path);

      return `${sourceStat.size}:${sourceStat.mtimeMs}`;
    } catch {
      return 'missing';
    }
  })();

  if (failedThumbnailPaths.get(outputPath) === sourceSignature) return callback(null);
  failedThumbnailPaths.delete(outputPath);

  const pendingCallbacks = thumbnailJobs.get(outputPath);

  if (pendingCallbacks) {
    pendingCallbacks.push(callback);

    return;
  }

  thumbnailJobs.set(outputPath, [callback]);
  thumbnailQueue.push({ video, outputPath, sourceSignature });
  processThumbnailQueue();
}

function processThumbnailQueue() {
  while (activeThumbnailJobs < MAX_CONCURRENT_THUMBNAILS && thumbnailQueue.length) {
    const job = thumbnailQueue.shift();
    activeThumbnailJobs += 1;

    const thumbnailArgs = (seek) => [
      '-hide_banner', '-loglevel', 'error',
      '-threads', '1', '-an',
      '-ss', seek, '-i', job.video.full_path,
      '-frames:v', '1', '-vf', 'scale=640:-2',
      '-q:v', '5', '-y', job.outputPath
    ];

    const finish = (error) => {
      activeThumbnailJobs -= 1;
      const callbacks = thumbnailJobs.get(job.outputPath) || [];
      thumbnailJobs.delete(job.outputPath);

      if (error || !fs.existsSync(job.outputPath)) {
        const thumbnailError = error || new Error('FFmpeg did not create a thumbnail');
        failedThumbnailPaths.set(job.outputPath, job.sourceSignature);
        console.warn(`[thumbnail] ${job.video.filename}:`, thumbnailError.message);
        callbacks.forEach((pendingCallback) => pendingCallback(null));
      } else {
        failedThumbnailPaths.delete(job.outputPath);
        callbacks.forEach((pendingCallback) => pendingCallback(job.outputPath));
      }

      processThumbnailQueue();
    };

    execFile(ffmpegCommand, thumbnailArgs('00:00:01'), { timeout: 45000 }, (error) => {
      if (!error && fs.existsSync(job.outputPath)) return finish(null);

      try { fs.unlinkSync(job.outputPath); } catch { /* no partial thumbnail */ }

      execFile(ffmpegCommand, thumbnailArgs('00:00:00'), { timeout: 45000 }, (fallbackError) => {
        finish(fallbackError || error || new Error('FFmpeg did not create a thumbnail'));
      });
    });
  }
}

function streamCompatibleVideo(video, req, res) {
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Accept-Ranges', 'none');

  const transcoder = spawn(ffmpegCommand, [
    '-hide_banner', '-loglevel', 'error',
    '-i', video.full_path,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let errorOutput = '';
  transcoder.stderr.on('data', (chunk) => {
    if (errorOutput.length < 4096) errorOutput += chunk.toString();
  });
  transcoder.stdout.pipe(res);

  const abort = () => {
    if (!transcoder.killed) transcoder.kill('SIGKILL');
  };

  res.on('close', abort);
  transcoder.on('error', (error) => {
    if (!res.headersSent) res.status(500).json({ error: 'Compatible video conversion failed' });
    else res.destroy(error);
  });
  transcoder.on('close', (code) => {
    res.off('close', abort);

    if (code !== 0 && !res.destroyed && !res.headersSent) {
      res.status(500).json({ error: errorOutput.trim() || 'Compatible video conversion failed' });
    }
  });
}

app.post('/transcode-local', (req, res) => {
  if (!ffmpegAvailable) return res.status(503).json({ error: 'FFmpeg is not available for local conversion' });

  const tempDirectory = fs.mkdtempSync(path.join(require('os').tmpdir(), 'webvlc-local-transcode-'));
  const sourcePath = path.join(tempDirectory, 'source-media');
  const sourceStream = fs.createWriteStream(sourcePath);
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;

    try { fs.rmSync(tempDirectory, { recursive: true, force: true }); } catch { /* best-effort temp cleanup */ }
  };

  req.on('aborted', () => {
    sourceStream.destroy();
    cleanup();
  });
  sourceStream.on('error', (error) => {
    cleanup();

    if (!res.headersSent) res.status(500).json({ error: `Local file upload failed: ${error.message}` });
  });
  sourceStream.on('finish', () => {
    streamCompatibleVideo({ full_path: sourcePath }, req, res);
    res.once('finish', cleanup);
    res.once('close', cleanup);
  });
  req.pipe(sourceStream);
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    app: 'web_vlc',
    folders: library.getLibraryFolders().length,
    ffmpegAvailable
  });
});

app.get('/videos', (req, res) => {
  try {
    const scan = db.syncFolders(library.getLibraryFolders());
    const videos = db.getAllActiveVideos().map(mediaDetails);
    res.json({
      videos,
      library: libraryPayload(scan),
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

  if (!library.isInsideLibrary(video.full_path)) return res.status(403).json({ error: 'Media is outside your media folders' });

  let stat;

  try {
    stat = fs.statSync(video.full_path);
  } catch {
    return res.status(404).json({ error: 'Media file is offline' });
  }

  if (!stat.isFile()) return res.status(404).json({ error: 'Media file is offline' });

  const fileSize = stat.size;
  const extension = path.extname(video.full_path).toLowerCase();

  if (req.query.transcode === '1') {
    if (!ffmpegAvailable || !VIDEO_EXTENSIONS.has(extension)) {
      return res.status(415).json({ error: 'Compatible video conversion is unavailable' });
    }

    return streamCompatibleVideo(video, req, res);
  }

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

  const thumbnailPath = thumbnailPathFor(video.full_path);

  const sendThumbnail = (filePath) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  };

  if (fs.existsSync(thumbnailPath)) return sendThumbnail(thumbnailPath);
  generateThumbnail(video, (generatedPath) => {
    if (!generatedPath || !fs.existsSync(generatedPath)) return res.status(404).json({ error: 'Thumbnail unavailable' });
    sendThumbnail(generatedPath);
  });
});

app.post('/library/folders', (req, res) => {
  const result = library.addLibraryFolder(req.body?.path);

  if (result.error) return res.status(400).json({ error: result.error });
  const scan = db.syncFolders(library.getLibraryFolders());
  res.json({ success: true, added: result.added, path: result.path, library: libraryPayload(scan), scan });
});

app.delete('/library/folders', (req, res) => {
  const result = library.removeLibraryFolder(req.body?.path);
  const scan = db.syncFolders(library.getLibraryFolders());
  res.json({ success: true, removed: result.removed, library: libraryPayload(scan), scan });
});

app.post('/library/pick-folder', async (req, res) => {
  try {
    const result = await library.pickLibraryFolder();
    res.json(result);
  } catch (error) {
    console.error('[pick-folder]', error);
    res.status(500).json({ error: 'The folder picker could not start' });
  }
});

app.get('/library/browse', (req, res) => {
  const result = library.browseFolders(req.query.path);

  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/scan', (req, res) => {
  try {
    const scan = db.syncFolders(library.getLibraryFolders());
    res.json({ success: true, library: libraryPayload(scan), scan });
  } catch (error) {
    console.error('[scan]', error);
    res.status(500).json({ error: 'Scan failed' });
  }
});

app.put('/library/preferences', (req, res) => {
  const preferences = library.updatePreferences(req.body);
  res.json({ success: true, preferences });
});

app.post('/rename/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const newName = decodeTrimmedString(req.body?.newName);

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
  const tag = decodeTrimmedString(req.body?.tag);

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

function existingWebVlcServer(callback, port = PORT) {
  let settled = false;

  const finish = (isWebVlc) => {
    if (settled) return;
    settled = true;
    callback(isWebVlc);
  };

  const request = http.get({ host: HOST, port, path: '/health', timeout: 1200 }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      if (body.length < 2048) body += chunk;
    });
    response.on('end', () => {
      try {
        finish(response.statusCode === 200 && JSON.parse(body).app === 'web_vlc');
      } catch {
        finish(false);
      }
    });
  });

  request.on('timeout', () => request.destroy());
  request.on('error', () => finish(false));
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

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('[server]', error);
  res.status(500).json({ error: 'Unexpected server error' });
});

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

function folderSummary() {
  const folders = library.getLibraryFolders();

  if (!folders.length) return 'none yet — add one from the web UI';

  return folders.map((folder) => path.basename(folder) || folder).join(', ');
}

async function startServer({ port = PORT, openBrowser = process.env.WEBVLC_OPEN_BROWSER === '1' } = {}) {
  const folders = library.getLibraryFolders();

  if (!folders.length) {
    const seeded = library.seedFoldersFromMediaPaths(db.getAllActiveVideos().map((video) => video.full_path));

    if (seeded.length) console.log(`[library] Restored ${seeded.length} media folder(s) from the previous library.`);
  }

  const scan = db.syncFolders(library.getLibraryFolders());

  const server = http.createServer(app);
  const serverStates = [];
  let listeningPort = null;

  for (let candidate = port; candidate < port + 10 && listeningPort === null; candidate += 1) {
    try {
      await listen(server, candidate);
      listeningPort = candidate;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      serverStates.push(candidate);
    }
  }

  if (listeningPort === null) {
    console.error(`[server] Ports ${port}-${port + 9} are all in use by other applications.`);
    db.closeDb();
    throw Object.assign(new Error('No free port'), { code: 'EADDRINUSE' });
  }

  if (listeningPort !== port) {
    const alreadyRunning = await new Promise((resolve) => existingWebVlcServer(resolve, port));

    if (alreadyRunning) {
      console.log(`\n  web_vlc is already running at http://${HOST}:${port}\n`);

      if (openBrowser) openDesktopFile(`http://${HOST}:${port}`, () => {});
      server.close();
      db.closeDb();

      return { alreadyRunning: true, port };
    }
  }

  const address = `http://${HOST}:${listeningPort}`;
  const connected = scan.folders.filter((folder) => folder.available);
  console.log(`\n  web_vlc is ready    → ${address}`);
  console.log(`  Media folders       → ${folderSummary()}`);
  console.log(`  Library             → ${scan.found} item(s) in ${connected.length} folder(s)`);
  console.log(`  Library data        → ${DATA_DIR}`);
  console.log(`  Video thumbnails    → ${ffmpegAvailable ? 'enabled' : 'install FFmpeg to enable'}\n`);

  if (openBrowser) openDesktopFile(address, () => {});

  return { server, port: listeningPort };
}

if (require.main === module) {
  startServer().then(({ server }) => {
    if (!server) return;

    const shutdown = () => {
      server.close(() => {
        db.closeDb();
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch(() => {
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };
