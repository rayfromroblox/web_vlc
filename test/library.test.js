const assert = require('node:assert/strict');

const fs = require('node:fs');

const os = require('node:os');

const path = require('node:path');

const test = require('node:test');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webvlc-library-test-'));

process.env.WEBVLC_DATA_DIR = path.join(testRoot, 'data');

process.env.WEBVLC_SETTINGS_PATH = path.join(testRoot, 'settings.json');

delete process.env.WEBVLC_MEDIA_DIR;

const library = require('../library');

test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

test('validates folder paths before accepting them', () => {
  const filePath = path.join(testRoot, 'notes.txt');
  fs.writeFileSync(filePath, 'x');

  assert.equal(library.validateFolderPath('').error, 'Enter a folder path');
  assert.equal(library.validateFolderPath(path.join(testRoot, 'missing')).error, 'That folder does not exist');
  assert.equal(library.validateFolderPath(filePath).error, 'That path is not a folder');
  assert.equal(library.validateFolderPath(testRoot).path, testRoot);
});

test('adds, deduplicates, and removes media folders', () => {
  const mediaPath = path.join(testRoot, 'media');
  fs.mkdirSync(mediaPath, { recursive: true });
  const filePath = path.join(mediaPath, 'clip.mp4');
  fs.writeFileSync(filePath, 'x');

  const added = library.addLibraryFolder(mediaPath);
  assert.equal(added.added, true);
  assert.deepEqual(library.getLibraryFolders(), [mediaPath]);
  assert.equal(library.isInsideLibrary(filePath), true);
  assert.equal(library.libraryFolderFor(filePath), mediaPath);
  assert.equal(library.isInsideLibrary(path.join(testRoot, 'outside.mp4')), false);
  assert.equal(library.addLibraryFolder(mediaPath).added, false);

  const settings = JSON.parse(fs.readFileSync(process.env.WEBVLC_SETTINGS_PATH, 'utf8'));
  assert.deepEqual(settings.folders, [mediaPath]);

  const removed = library.removeLibraryFolder(mediaPath);
  assert.equal(removed.removed, true);
  assert.deepEqual(library.getLibraryFolders(), []);
});

test('seeds folders from existing media paths when none are configured', () => {
  const seededDirectory = path.join(testRoot, 'seeded');
  fs.mkdirSync(seededDirectory, { recursive: true });
  const mediaPath = path.join(seededDirectory, 'video.mp4');
  fs.writeFileSync(mediaPath, 'x');

  const seeded = library.seedFoldersFromMediaPaths([
    mediaPath,
    path.join(testRoot, 'windows-era-path', 'old.mp4')
  ]);

  assert.deepEqual(seeded, [seededDirectory]);
  assert.deepEqual(library.getLibraryFolders(), [seededDirectory]);
});

test('builds a native folder dialog invocation for each platform', () => {
  const windows = library.folderDialogInvocation('win32', { SystemRoot: 'C:\\Windows' });
  assert.match(windows.command, /powershell\.exe$/);
  assert.ok(windows.args.includes('-STA'));
  assert.match(windows.args.join(' '), /FolderBrowserDialog/);

  const mac = library.folderDialogInvocation('darwin', {});
  assert.equal(mac.command, 'osascript');
  assert.match(mac.args.join(' '), /choose folder/);

  const linux = library.folderDialogInvocation('linux', { DISPLAY: ':0' });
  assert.equal(linux[0].command, 'zenity');
  assert.equal(linux[1].command, 'kdialog');
  assert.deepEqual(library.folderDialogInvocation('linux', {}), []);
});

test('browses folders for the built-in picker', () => {
  const root = path.join(testRoot, 'browse');
  fs.mkdirSync(path.join(root, 'Alpha'), { recursive: true });
  fs.mkdirSync(path.join(root, 'beta'), { recursive: true });
  fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });
  fs.writeFileSync(path.join(root, 'file.mp4'), 'x');

  const listing = library.browseFolders(root);
  assert.equal(listing.path, root);
  assert.equal(listing.parent, path.dirname(root));
  assert.deepEqual(listing.directories.map((entry) => entry.name), ['Alpha', 'beta']);
  assert.ok(listing.quickLocations.includes(os.homedir()));
  assert.ok(Array.isArray(listing.roots));

  assert.equal(library.browseFolders(path.join(testRoot, 'missing')).error, 'That folder does not exist');
  assert.equal(library.browseFolders(path.join(root, 'file.mp4')).error, 'That path is not a folder');
  assert.equal(library.browseFolders('').path, os.homedir());
});

test('validates and persists preferences', () => {
  const decoded = library.decodePreferences({
    theme: 'dark',
    accent: 'neon',
    density: 'compact',
    glass: false,
    reduceMotion: 'yes',
    seekStep: 15,
    playbackRate: 9,
    extra: true
  });

  assert.deepEqual(decoded, {
    theme: 'dark',
    accent: 'orange',
    density: 'compact',
    glass: false,
    reduceMotion: false,
    seekStep: 15,
    playbackRate: 2
  });
  assert.deepEqual(library.decodePreferences(null), library.DEFAULT_PREFERENCES);
  assert.deepEqual(library.decodePreferences(['dark']), library.DEFAULT_PREFERENCES);

  const updated = library.updatePreferences({ accent: 'blue', seekStep: 30, glass: true, playbackRate: 1.25 });

  assert.equal(updated.accent, 'blue');
  assert.equal(updated.seekStep, 30);
  assert.equal(updated.glass, true);
  assert.equal(updated.playbackRate, 1.25);
  assert.deepEqual(library.getPreferences(), updated);

  const stored = JSON.parse(fs.readFileSync(process.env.WEBVLC_SETTINGS_PATH, 'utf8'));

  assert.deepEqual(stored.preferences, updated);

  const preferenceFolder = path.join(testRoot, 'preference-folder');

  fs.mkdirSync(preferenceFolder, { recursive: true });
  library.addLibraryFolder(preferenceFolder);
  assert.deepEqual(library.getPreferences(), updated);

  library.removeLibraryFolder(preferenceFolder);
  assert.deepEqual(library.getPreferences(), updated);
});
