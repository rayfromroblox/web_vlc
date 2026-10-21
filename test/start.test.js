const assert = require('node:assert/strict');

const test = require('node:test');

const { checkNodeVersion, parseArgs } = require('../start');

test('accepts Node.js 24 and newer only', () => {
  assert.equal(checkNodeVersion('23.11.0'), false);
  assert.equal(checkNodeVersion('24.0.0'), true);
  assert.equal(checkNodeVersion('26.8.2'), true);
});

test('parses folders, ports, and flags from the command line', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.port, null);
  assert.equal(defaults.openBrowser, true);
  assert.deepEqual(defaults.folders, []);

  const parsed = parseArgs(['/media/videos', '--port=4100', '--no-open', '/media/audio']);
  assert.equal(parsed.port, 4100);
  assert.equal(parsed.openBrowser, false);
  assert.deepEqual(parsed.folders, ['/media/videos', '/media/audio']);

  assert.equal(parseArgs(['-p', '4001']).port, 4001);
  assert.equal(parseArgs(['--port', '4002']).port, 4002);
});

test('rejects invalid ports and unknown options with friendly errors', () => {
  assert.equal(parseArgs(['--port', 'not-a-number']).error, 'The port must be a number between 0 and 65535');
  assert.equal(parseArgs(['--port=70000']).error, 'The port must be a number between 0 and 65535');
  assert.equal(parseArgs(['--verbose']).error, 'Unknown option: --verbose');
});
