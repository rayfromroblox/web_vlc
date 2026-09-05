#!/usr/bin/env sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE_VERSION=${WEBVLC_NODE_VERSION:-$(node --version)}
OUTPUT_DIRECTORY=${WEBVLC_RELEASE_DIR:-"$PROJECT_ROOT/release"}

case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  *) printf 'Unsupported Linux architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac

RELEASE_NAME="web_vlc-linux-$NODE_ARCH"
WORK_DIRECTORY=$(mktemp -d "${TMPDIR:-/tmp}/webvlc-package.XXXXXX")
STAGING_DIRECTORY="$WORK_DIRECTORY/$RELEASE_NAME"
RUNTIME_DIRECTORY=$(mktemp -d "${TMPDIR:-/tmp}/webvlc-node.XXXXXX")
RUNTIME_ARCHIVE="$RUNTIME_DIRECTORY/node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
RUNTIME_URL="https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz"

cleanup() {
  rm -rf "$WORK_DIRECTORY" "$RUNTIME_DIRECTORY"
}
trap cleanup EXIT INT TERM

mkdir -p "$OUTPUT_DIRECTORY" "$STAGING_DIRECTORY"
for release_entry in \
  config.js \
  db.js \
  server.js \
  start.js \
  package.json \
  package-lock.json \
  README.md \
  public \
  'Open web_vlc'
do
  cp -a "$PROJECT_ROOT/$release_entry" "$STAGING_DIRECTORY/"
done

curl -fsSL "$RUNTIME_URL" -o "$RUNTIME_ARCHIVE"
tar -xJf "$RUNTIME_ARCHIVE" -C "$RUNTIME_DIRECTORY"
mkdir -p "$STAGING_DIRECTORY/runtime"
cp -a "$RUNTIME_DIRECTORY/node-$NODE_VERSION-linux-$NODE_ARCH/." "$STAGING_DIRECTORY/runtime/"

(
  cd "$STAGING_DIRECTORY"
  "$STAGING_DIRECTORY/runtime/bin/npm" ci --omit=dev --no-audit --no-fund
  "$STAGING_DIRECTORY/runtime/bin/npm" rebuild better-sqlite3 --no-audit --no-fund
)

chmod +x "$STAGING_DIRECTORY/Open web_vlc"
RELEASE_ARCHIVE="$OUTPUT_DIRECTORY/$RELEASE_NAME.tar.gz"
rm -f "$RELEASE_ARCHIVE"
tar -C "$WORK_DIRECTORY" -czf "$RELEASE_ARCHIVE" "$RELEASE_NAME"
printf 'Portable release created: %s\n' "$RELEASE_ARCHIVE"
