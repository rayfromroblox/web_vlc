
# Edits Viewer

A local-first video browser for people who work with a lot of video files. Point it at a directory and it gives you a searchable, taggable table or grid of everything in there with inline previews, a floating player and in-place renaming, tagging and deletion.

Built with Express and better-sqlite3, served over the local network, styled like a Windows XP-era utility app.

---

## Features

**Filesystem sync**
Scans a local directory for video files (`.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.wmv`, `.flv`, `.m4v`, `.mpg`, `.mpeg`) and keeps its database in sync. Detects new files, updated files and removed files. Re-scan on page load or manually with the Rescan button.

**Dual view modes**
Toggle between a table (list view) or grid (card view). Preference persists in `localStorage`.

**Hover preview**
Hover over thumbnails for a delayed muted preview (100ms). Helps identify clips quickly.

**Floating video player**
Draggable, resizable player with full controls and keyboard shortcuts.

| Key     | Action                    |
| ------- | ------------------------- |
| Space   | Play or pause             |
| ← / → | Seek 5s (Ctrl equals 30s) |
| ↑ / ↓ | Volume                    |
| F       | Fullscreen                |
| M       | Mute                      |
| Esc     | Close                     |

**In-place filename editing**
Inline rename with extension preservation and disk sync.

**Tagging**
Add and remove tags per video. Lowercased, deduplicated, searchable.

**Favorites**
Star videos and filter by favorites.

**Quick actions**

* Open in VLC or default system player
* Permanent delete with confirmation
* Delete key shortcut on hovered row

**Search**
Real-time filtering across filenames and tags. `/` focuses search.

**Thumbnails**
FFmpeg-generated frame-at-1s thumbnails, cached in `thumbnails/`.

---

## Tech Stack

| Layer      | Technology                        |
| ---------- | --------------------------------- |
| Backend    | Node.js + Express                 |
| Database   | SQLite (better-sqlite3, WAL mode) |
| Frontend   | Vanilla JS                        |
| Styling    | CSS (XP-style UI)                 |
| Thumbnails | FFmpeg (optional)                 |

---

## Requirements

### System requirements

* Node.js 18 or higher
* npm 9 or higher
* Windows, Linux or macOS
* At least 1GB free disk space for medium libraries

### Optional dependencies

* FFmpeg for thumbnail generation
  * Must be available in system PATH
  * Without it thumbnails are disabled but all other features work

### Recommended setup

* SSD storage for video directories for faster scanning
* 4GB or more RAM for large libraries
* Local network access if serving across devices

---

## Getting Started

### Prerequisites

* Node.js 18 or higher
* FFmpeg optional

---

### Install

```bash
git clone https://github.com/rayfromroblox/web_vlc
cd edits-viewer
npm install
```

---

### Configure

Set `EDITS_DIR` in `db.js` and `server.js`

```js
const EDITS_DIR = 'C:\\Users\\You\\Videos\\Edits';
```

Linux or macOS:

```js
const EDITS_DIR = '/home/you/Videos/Edits';
```

Default server port is 4000. Change `PORT` in `server.js` if needed.

---

### Run

```bash
npm start
```

Or use `start.bat` on Windows.

Startup flow:

1. Initialize SQLite database `edits.db`
2. Scan configured video directory
3. Start server at `http://localhost:4000`

---

## API Reference

| Method | Route              | Description                       |
| ------ | ------------------ | --------------------------------- |
| GET    | `/videos`        | List videos and trigger scan      |
| GET    | `/video/:id`     | Stream video with range support   |
| GET    | `/thumbnail/:id` | Get or generate thumbnail         |
| POST   | `/rename/:id`    | Rename file and update database   |
| POST   | `/delete/:id`    | Delete file and soft delete in DB |
| POST   | `/favorite/:id`  | Toggle favorite                   |
| POST   | `/tags/:id`      | Add or remove tags                |
| POST   | `/open/:id`      | Open in system player             |
| POST   | `/scan`          | Trigger directory rescan          |

---

## Project Structure

```id=
edits-viewer/
├── db.js
├── server.js
├── package.json
├── start.bat
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── thumbnails/
├── edits.db
└── README.md
```

---

## Design Notes

The UI is intentionally inspired by Windows XP era utilities with beveled controls, gradient title bars, monospace fonts and a minimal dependency footprint.

The floating player supports dragging and resizing and persists position during the session. Deletion uses a custom DOM overlay instead of native dialogs to avoid blocking behavior and to keep visual consistency.

---

## Coming Soon

**Directory selector**

A built-in directory picker will replace the manual `EDITS_DIR` configuration. This will allow users to select multiple media roots from the UI and dynamically switch between them. It will support persistent profiles so different libraries can be saved and reloaded without code changes. The selector will also validate folder contents before indexing and provide feedback on scan status, estimated file count and indexing progress.

Future versions will support watched directories with live filesystem events instead of periodic rescans. This will reduce latency between file creation and UI updates and eliminate manual refresh cycles.

**Positive performance increments**

Performance will improve incrementally through targeted optimizations rather than full rewrites. Planned upgrades include batched database writes to reduce SQLite contention, lazy metadata hydration so only visible rows are fully loaded, and virtualized rendering for large datasets to prevent DOM overload.

Thumbnail generation will be moved to a queued worker model so scans do not block UI responsiveness. Caching strategy improvements will reduce redundant FFmpeg calls by hashing file state. Search indexing will shift toward incremental inverted index updates instead of full-table scans.

These changes aim to scale the system smoothly from small libraries to tens of thousands of files without degrading interaction speed.

**Dedicated OS versions**

Native builds are planned for Windows and Linux with tighter OS integration. On Windows this includes registry-level file association so video files can be opened directly into the app and optional shell integration for context menu actions like "Add to Edits Viewer" and "Scan Folder Here".

On Linux the goal is a lightweight desktop wrapper using system file watchers and desktop environment integration for GNOME and KDE. On macOS a signed application bundle is planned with sandbox-aware directory access and native file picker support.

Each OS version will prioritize local performance improvements such as direct filesystem event hooks, native notifications for new media detection and reduced overhead compared to running the Node server manually.

---

## License

MIT
