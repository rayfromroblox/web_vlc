const fs = require('fs');

const os = require('os');

const path = require('path');

const { spawn } = require('child_process');

const { DATA_DIR, SETTINGS_PATH } = require('./config');

// Settings files and request values are decoded JSON; JSON primitives keep the
// global constructors, so constructor identity is an exact string check there.
const isDecodedString = (value) => value?.constructor === String;

const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'system',
  accent: 'orange',
  density: 'comfortable',
  glass: true,
  reduceMotion: false,
  seekStep: 10,
  playbackRate: 1
});

const THEME_VALUES = new Set(['system', 'light', 'dark']);

const ACCENT_VALUES = new Set(['orange', 'blue', 'violet', 'green', 'rose']);

const DENSITY_VALUES = new Set(['comfortable', 'compact']);

const SEEK_STEP_VALUES = new Set([5, 10, 15, 30]);

// Preferences arrive from decoded JSON. Primitive values keep their global
// constructors, so identity checks plus a value whitelist decode each field.
function decodePreferences(parsed) {
  const preferences = { ...DEFAULT_PREFERENCES };

  if (parsed?.constructor !== Object) return preferences;

  if (isDecodedString(parsed.theme) && THEME_VALUES.has(parsed.theme)) preferences.theme = parsed.theme;

  if (isDecodedString(parsed.accent) && ACCENT_VALUES.has(parsed.accent)) preferences.accent = parsed.accent;

  if (isDecodedString(parsed.density) && DENSITY_VALUES.has(parsed.density)) preferences.density = parsed.density;

  if (parsed.seekStep?.constructor === Number && SEEK_STEP_VALUES.has(parsed.seekStep)) preferences.seekStep = parsed.seekStep;

  if (parsed.glass?.constructor === Boolean) preferences.glass = parsed.glass;

  if (parsed.reduceMotion?.constructor === Boolean) preferences.reduceMotion = parsed.reduceMotion;

  if (parsed.playbackRate?.constructor === Number && Number.isFinite(parsed.playbackRate)) {
    preferences.playbackRate = Math.min(2, Math.max(0.5, Math.round(parsed.playbackRate * 100) / 100));
  }

  return preferences;
}

let cachedSettings = null;

// Establish the settings contract at the file boundary: only primitive string
// entries become library folders, and preferences decode through their whitelist.
function decodeSettings(parsed) {
  const folders = [];
  const preferences = decodePreferences(parsed?.preferences);

  if (!Array.isArray(parsed?.folders)) return { folders, preferences };

  for (const entry of parsed.folders) {
    if (isDecodedString(entry) && entry.trim()) folders.push(path.resolve(entry));
  }

  return { folders: [...new Set(folders)], preferences };
}

function readSettings() {
  if (cachedSettings) return cachedSettings;

  try {
    cachedSettings = decodeSettings(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')));
  } catch {
    cachedSettings = { folders: [], preferences: { ...DEFAULT_PREFERENCES } };
  }

  return cachedSettings;
}

function writeSettings(settings) {
  const next = {
    folders: [...new Set(settings.folders.map((folder) => path.resolve(folder)))],
    preferences: decodePreferences(settings.preferences)
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryPath = `${SETTINGS_PATH}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(temporaryPath, SETTINGS_PATH);
  cachedSettings = next;

  return next;
}

function getPreferences() {
  return { ...readSettings().preferences };
}

function updatePreferences(patch) {
  const settings = readSettings();
  const incoming = patch?.constructor === Object ? patch : {};
  const preferences = decodePreferences({ ...settings.preferences, ...incoming });

  writeSettings({ folders: settings.folders, preferences });

  return preferences;
}

function getLibraryFolders() {
  const settings = readSettings();

  if (settings.folders.length) return settings.folders;

  if (process.env.WEBVLC_MEDIA_DIR) return [path.resolve(process.env.WEBVLC_MEDIA_DIR)];

  return [];
}

function validateFolderPath(folderPath) {
  if (!isDecodedString(folderPath) || !folderPath.trim()) {
    return { error: 'Enter a folder path' };
  }

  const resolved = path.resolve(folderPath.trim().replace(/^~(?=$|[/\\])/, os.homedir()));
  let stat;

  try {
    stat = fs.statSync(resolved);
  } catch {
    return { error: 'That folder does not exist' };
  }

  if (!stat.isDirectory()) return { error: 'That path is not a folder' };

  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    return { error: 'That folder cannot be read' };
  }

  return { path: resolved };
}

function addLibraryFolder(folderPath) {
  const validation = validateFolderPath(folderPath);

  if (validation.error) return validation;
  const settings = readSettings();

  if (settings.folders.includes(validation.path)) {
    return { path: validation.path, added: false, folders: settings.folders };
  }

  const folders = [...settings.folders, validation.path];
  writeSettings({ folders, preferences: settings.preferences });

  return { path: validation.path, added: true, folders };
}

function removeLibraryFolder(folderPath) {
  const resolved = isDecodedString(folderPath) ? path.resolve(folderPath) : '';
  const settings = readSettings();
  const folders = settings.folders.filter((folder) => folder !== resolved);
  const removed = folders.length !== settings.folders.length;

  if (removed) writeSettings({ folders, preferences: settings.preferences });

  return { removed, folders };
}

function libraryFolderFor(targetPath) {
  const resolved = path.resolve(targetPath);

  return getLibraryFolders().find((folder) => {
    const relative = path.relative(folder, resolved);

    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  }) || null;
}

function isInsideLibrary(targetPath) {
  return Boolean(libraryFolderFor(targetPath));
}

function seedFoldersFromMediaPaths(mediaPaths) {
  if (readSettings().folders.length) return [];

  const folders = [...new Set(mediaPaths.map((mediaPath) => path.dirname(mediaPath)))]
    .filter((folder) => {
      try {
        return fs.statSync(folder).isDirectory();
      } catch {
        return false;
      }
    });

  if (folders.length) writeSettings({ folders, preferences: readSettings().preferences });

  return folders;
}

// Native folder dialogs. The server runs on the same machine as the browser in
// the intended setup, so it can open a real OS folder picker for the user.
function folderDialogInvocation(platform = process.platform, environment = process.env) {
  if (platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = 'Choose your media folder'",
      '$dialog.UseDescriptionForTitle = $true',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }'
    ].join('; ');

    return {
      command: path.join(environment.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoProfile', '-STA', '-Command', script]
    };
  }

  if (platform === 'darwin') {
    return {
      command: 'osascript',
      args: [
        '-e', 'set chosenFolder to choose folder with prompt "Choose your media folder"',
        '-e', 'POSIX path of chosenFolder'
      ]
    };
  }

  if (!environment.DISPLAY && !environment.WAYLAND_DISPLAY) {
    // No graphical session to show a dialog in; the web UI folder browser takes over.
    return [];
  }

  return [
    { command: 'zenity', args: ['--file-selection', '--directory', '--title=Choose your media folder'] },
    { command: 'kdialog', args: ['--getexistingdirectory', os.homedir(), 'Choose your media folder'] }
  ];
}

function runFolderDialog(candidate, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(candidate.command, candidate.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ cancelled: true });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < 4096) stdout += chunk.toString();
    });
    child.on('error', (error) => finish({ missing: error.code === 'ENOENT' }));
    child.on('close', (code) => {
      if (code === 0) {
        const picked = stdout.trim();
        finish(picked ? { path: picked } : { cancelled: true });

        return;
      }

      finish({ cancelled: true });
    });
  });
}

async function pickLibraryFolder({ timeoutMs = 10 * 60 * 1000 } = {}) {
  const candidates = folderDialogInvocation();
  const ordered = Array.isArray(candidates) ? candidates : [candidates];

  for (const candidate of ordered) {
    const result = await runFolderDialog(candidate, timeoutMs);

    if (result.missing) continue;

    return result;
  }

  return { unsupported: true };
}

// Built-in folder browser: lists subdirectories of any folder so the web UI can
// offer a picker that works everywhere, even without desktop dialog helpers.
const QUICK_FOLDER_NAMES = ['Desktop', 'Downloads', 'Documents', 'Videos', 'Music'];

function quickLocations() {
  const home = os.homedir();
  const candidates = [home, ...QUICK_FOLDER_NAMES.map((name) => path.join(home, name))];

  if (process.platform === 'darwin') candidates.push('/Volumes');

  if (process.platform === 'linux') candidates.push('/media', '/mnt', path.join('/run/media', path.basename(home)));

  return candidates
    .filter((candidate, index, list) => list.indexOf(candidate) === index)
    .filter((candidate) => {
      try {
        return fs.statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    });
}

function browserRoots() {
  if (process.platform !== 'win32') return ['/'];
  const drives = [];

  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const drive = `${letter}:\\`;

    try {
      if (fs.statSync(drive).isDirectory()) drives.push(drive);
    } catch {
      // Drive is not present.
    }
  }

  return drives.length ? drives : [os.homedir()];
}

function browseFolders(targetPath) {
  const home = os.homedir();

  const requested = isDecodedString(targetPath) && targetPath.trim()
    ? targetPath.trim().replace(/^~(?=$|[/\\])/, home)
    : home;

  const resolved = path.resolve(requested);

  let stat;

  try {
    stat = fs.statSync(resolved);
  } catch {
    return { error: 'That folder does not exist' };
  }

  if (!stat.isDirectory()) return { error: 'That path is not a folder' };

  let entries;

  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch {
    return { error: 'That folder cannot be read' };
  }

  const parent = path.dirname(resolved);

  return {
    path: resolved,
    parent: parent === resolved ? null : parent,
    home,
    roots: browserRoots(),
    quickLocations: quickLocations(),
    directories: entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({ name: entry.name, path: path.join(resolved, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
  };
}

module.exports = {
  DEFAULT_PREFERENCES,
  addLibraryFolder,
  browseFolders,
  decodePreferences,
  folderDialogInvocation,
  getLibraryFolders,
  getPreferences,
  isInsideLibrary,
  libraryFolderFor,
  pickLibraryFolder,
  removeLibraryFolder,
  seedFoldersFromMediaPaths,
  updatePreferences,
  validateFolderPath
};
