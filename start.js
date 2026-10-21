#!/usr/bin/env node
const MIN_NODE_MAJOR = 24;

function checkNodeVersion(version = process.versions.node) {
  const major = Number.parseInt(version.split('.')[0], 10);

  return Number.isInteger(major) && major >= MIN_NODE_MAJOR;
}

function parseArgs(argv) {
  const options = { port: null, openBrowser: true, help: false, version: false, folders: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg === '--no-open') {
      options.openBrowser = false;
    } else if (arg === '--port' || arg === '-p') {
      options.port = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else if (arg.startsWith('--port=')) {
      options.port = Number.parseInt(arg.slice('--port='.length), 10);
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option: ${arg}` };
    } else {
      options.folders.push(arg);
    }
  }

  if (options.port !== null && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
    return { error: 'The port must be a number between 0 and 65535' };
  }

  return options;
}

function printHelp() {
  const { version } = require('./package.json');
  console.log(`
web_vlc ${version} — a private media library and player in your browser

Usage
  npx -y web-vlc [folder ...] [options]
  npm i -g web-vlc && web-vlc [folder ...] [options]

Options
  -p, --port <port>   Port to listen on (default 4000; picks a free port if busy)
      --no-open       Do not open the browser automatically
  -v, --version       Print the version
  -h, --help          Show this help

Folders passed on the command line are added to the library.
Media folders can also be added from the web UI at any time.`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.error) {
    console.error(`\n  ${options.error}\n  Run "web-vlc --help" for usage.`);

    return 1;
  }

  if (options.help) {
    printHelp();

    return 0;
  }

  if (options.version) {
    console.log(require('./package.json').version);

    return 0;
  }

  if (!checkNodeVersion()) {
    console.error(`\n  web_vlc needs Node.js ${MIN_NODE_MAJOR} or newer. You are running Node.js ${process.versions.node}.`);
    console.error('  Install the current LTS from https://nodejs.org and try again.\n');

    return 1;
  }

  const library = require('./library');

  for (const folder of options.folders) {
    const result = library.addLibraryFolder(folder);

    if (result.error) console.warn(`[folders] ${folder}: ${result.error}`);
  }

  if (options.openBrowser) process.env.WEBVLC_OPEN_BROWSER = '1';

  const { startServer } = require('./server');
  const started = await startServer({ port: options.port === null ? undefined : options.port });

  if (started.alreadyRunning) return 0;

  const shutdown = () => {
    started.server.close(() => {
      require('./db').closeDb();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return 0;
}

if (require.main === module) {
  main().then((code) => {
    if (code) process.exitCode = code;
  }).catch((error) => {
    if (error?.code !== 'EADDRINUSE') {
      console.error(`[web_vlc] ${error?.message || error}`);
    }

    process.exitCode = 1;
  });
}

module.exports = { checkNodeVersion, main, parseArgs, printHelp };
