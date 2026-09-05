const assert = require('node:assert/strict');
const test = require('node:test');
const {
  checkNodeVersion,
  commandFailure,
  npmInvocation,
  prepareDependencies
} = require('../start');

test('accepts supported Node.js versions only', () => {
  assert.equal(checkNodeVersion('20.0.0'), true);
  assert.equal(checkNodeVersion('24.19.0'), true);
  assert.equal(checkNodeVersion('26.9.0'), true);
  assert.equal(checkNodeVersion('19.9.0'), false);
  assert.equal(checkNodeVersion('27.0.0'), false);
});

test('runs npm.cmd through cmd.exe on Windows', () => {
  const invocation = npmInvocation(['rebuild', 'better-sqlite3'], {
    platform: 'win32',
    environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    bundledCli: null
  });
  assert.deepEqual(invocation, {
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'npm.cmd', 'rebuild', 'better-sqlite3']
  });
});

test('uses the bundled npm CLI through the active Node executable', () => {
  const invocation = npmInvocation(['install'], {
    platform: 'win32',
    nodeExecutable: 'D:\\web_vlc\\runtime\\node.exe',
    bundledCli: 'D:\\web_vlc\\runtime\\node_modules\\npm\\bin\\npm-cli.js'
  });
  assert.deepEqual(invocation, {
    command: 'D:\\web_vlc\\runtime\\node.exe',
    args: ['D:\\web_vlc\\runtime\\node_modules\\npm\\bin\\npm-cli.js', 'install']
  });
});

test('rebuilds an incompatible native SQLite module without reinstalling everything', () => {
  const checks = [
    { ok: false, error: Object.assign(new Error('NODE_MODULE_VERSION mismatch'), { code: 'ERR_DLOPEN_FAILED' }) },
    { ok: true, error: null }
  ];
  const commands = [];
  const messages = [];
  const success = prepareDependencies({
    check: () => checks.shift(),
    runNpm: (args) => { commands.push(args); return { status: 0 }; },
    output: { log: (message) => messages.push(message), error: (message) => messages.push(message) }
  });

  assert.equal(success, true);
  assert.deepEqual(commands, [[
    'rebuild', 'better-sqlite3', '--foreground-scripts', '--no-audit', '--no-fund'
  ]]);
  assert.match(messages.join('\n'), /NODE_MODULE_VERSION mismatch/);
});

test('reports the underlying spawn error', () => {
  assert.equal(
    commandFailure('npm install', { error: new Error('spawn EINVAL') }),
    'npm install could not start: spawn EINVAL'
  );
});
