const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);

if (nodeMajor < 20 || nodeMajor > 24) {
  console.error(`\nweb_vlc needs Node.js 20, 22, or 24. You are running Node.js ${process.versions.node}.`);
  console.error('Install a supported LTS version, then run this launcher again.\n');
  process.exit(1);
}

function dependenciesWork() {
  let temporaryDatabase;
  try {
    require.resolve('express');
    const Database = require('better-sqlite3');
    temporaryDatabase = path.join(os.tmpdir(), `web-vlc-check-${process.pid}-${Date.now()}.db`);
    const database = new Database(temporaryDatabase);
    database.close();
    fs.unlinkSync(temporaryDatabase);
    return true;
  } catch {
    if (temporaryDatabase) {
      try { fs.unlinkSync(temporaryDatabase); } catch { /* no temporary file to clean up */ }
    }
    return false;
  }
}

if (!dependenciesWork()) {
  console.log('\nFirst run detected — installing web_vlc…\n');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { stdio: 'inherit' });
  if (result.error || result.status !== 0 || !dependenciesWork()) {
    console.error('\nweb_vlc could not prepare its dependencies. Run npm install and try again.\n');
    process.exit(1);
  }
}

execFileSync(process.execPath, ['server.js'], { stdio: 'inherit' });
