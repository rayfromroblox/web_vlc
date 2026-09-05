const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MIN_NODE_MAJOR = 20;
const MAX_NODE_MAJOR = 26;

function checkNodeVersion(version = process.versions.node) {
  const major = Number.parseInt(version.split('.')[0], 10);
  return Number.isInteger(major) && major >= MIN_NODE_MAJOR && major <= MAX_NODE_MAJOR;
}

function checkDependencies() {
  let temporaryDatabase;
  try {
    require.resolve('express');
    const Database = require('better-sqlite3');
    temporaryDatabase = path.join(os.tmpdir(), `web-vlc-check-${process.pid}-${Date.now()}.db`);
    const database = new Database(temporaryDatabase);
    database.close();
    fs.unlinkSync(temporaryDatabase);
    return { ok: true, error: null };
  } catch (error) {
    if (temporaryDatabase) {
      for (const suffix of ['', '-shm', '-wal']) {
        try { fs.unlinkSync(`${temporaryDatabase}${suffix}`); } catch { /* file was not created */ }
      }
    }
    return { ok: false, error };
  }
}

function bundledNpmCli(runtimeDir = path.join(__dirname, 'runtime')) {
  const command = path.join(runtimeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return fs.existsSync(command) ? command : null;
}

function npmInvocation(args, options = {}) {
  const platform = options.platform || process.platform;
  const environment = options.environment || process.env;
  const nodeExecutable = options.nodeExecutable || process.execPath;
  const bundledCli = options.bundledCli === undefined ? bundledNpmCli() : options.bundledCli;

  if (bundledCli) {
    return { command: nodeExecutable, args: [bundledCli, ...args] };
  }
  if (platform === 'win32') {
    return {
      command: environment.ComSpec || environment.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd', ...args]
    };
  }
  return { command: 'npm', args };
}

function runNpm(args, options = {}) {
  const invocation = npmInvocation(args, options);
  const spawn = options.spawn || spawnSync;
  return spawn(invocation.command, invocation.args, { stdio: 'inherit' });
}

function commandFailure(label, result) {
  if (result.error) {
    return `${label} could not start: ${result.error.message}`;
  }
  if (result.signal) {
    return `${label} stopped with signal ${result.signal}`;
  }
  return `${label} exited with code ${result.status}`;
}

function prepareDependencies(options = {}) {
  const check = options.check || checkDependencies;
  const executeNpm = options.runNpm || runNpm;
  const output = options.output || console;
  let dependencyState = check();
  if (dependencyState.ok) return true;

  output.error(`\nDependency check failed: ${dependencyState.error?.message || 'unknown error'}\n`);

  if (dependencyState.error?.code === 'MODULE_NOT_FOUND') {
    output.log('Installing web_vlc dependencies…\n');
    const installResult = executeNpm(['install', '--no-audit', '--no-fund']);
    if (installResult.error || installResult.status !== 0) {
      output.error(`${commandFailure('npm install', installResult)}\n`);
      return false;
    }
    dependencyState = check();
    if (dependencyState.ok) return true;
  }

  output.log('Rebuilding the SQLite module for this Node.js version…\n');
  const rebuildResult = executeNpm(['rebuild', 'better-sqlite3', '--foreground-scripts', '--no-audit', '--no-fund']);
  if (rebuildResult.error || rebuildResult.status !== 0) {
    output.error(`${commandFailure('npm rebuild better-sqlite3', rebuildResult)}\n`);
    return false;
  }

  dependencyState = check();
  if (!dependencyState.ok) {
    output.error(`SQLite is still unavailable: ${dependencyState.error?.message || 'unknown error'}\n`);
    return false;
  }
  return true;
}

function main() {
  if (!checkNodeVersion()) {
    console.error(`\nweb_vlc needs Node.js ${MIN_NODE_MAJOR} through ${MAX_NODE_MAJOR}. You are running Node.js ${process.versions.node}.`);
    process.exitCode = 1;
    return;
  }

  if (process.env.WEBVLC_OPEN_BROWSER === undefined) {
    process.env.WEBVLC_OPEN_BROWSER = '1';
  }

  if (!prepareDependencies()) {
    process.exitCode = 1;
    return;
  }

  execFileSync(process.execPath, [path.join(__dirname, 'server.js')], { stdio: 'inherit' });
}

if (require.main === module) main();

module.exports = {
  checkNodeVersion,
  commandFailure,
  npmInvocation,
  prepareDependencies,
  runNpm
};
