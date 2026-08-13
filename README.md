# web_vlc

Your local media library, beautifully played in the browser.

web_vlc indexes a folder on your computer, keeps the library metadata in SQLite, and gives you a polished VLC-inspired player without uploading your files anywhere. You can also drag media directly into the browser for an instant, private playback session.

## What it does

- Lets you choose a local media folder from inside the app
- Streams media with byte-range support for responsive seeking
- Generates and caches video thumbnails with FFmpeg when available
- Opens local files instantly through drag and drop or the file picker
- Browses media in responsive grid and list views
- Searches filenames, formats, and tags in real time
- Filters by favorites, recent media, collection tag, video, or audio
- Sorts by name, date added, or favorites
- Renames files and manages tags without leaving the library
- Opens a file in the operating system's default media player
- Keeps a playback queue with previous, next, shuffle, and repeat
- Includes seek controls, volume, speed, Picture in Picture, and fullscreen
- Integrates with browser Media Session controls
- Works across desktop, tablet, and mobile layouts

Everything is local-first. Indexed files remain on disk, and files opened through the browser remain in that browser session.

## Quick start

Install Node.js 20, 22, or 24 (an LTS release), then run:

```bash
git clone https://github.com/rayfromroblox/web_vlc.git
cd web_vlc
npm start
```

`npm start` installs or repairs everything the app needs, then starts the player. On Windows, you can also double-click `start.bat` after downloading the project.

Open [http://127.0.0.1:4000](http://127.0.0.1:4000), click **Choose folder**, and select your media folder. Nothing is uploaded; selected media stays available for the current browser session. You can also open or drag in individual files.

## Troubleshooting

- **Port already in use** — set a different port with `WEBVLC_PORT`, for example `WEBVLC_PORT=5000 npm start` on macOS/Linux or `$env:WEBVLC_PORT = "5000"` in Windows PowerShell.
- **The launcher says Node.js is unsupported** — install Node.js 20, 22, or 24 (an LTS release), then start the app again.
- **A file will not play in the browser** — some formats (such as MKV) depend on codecs the browser does not support. Use the “Open in desktop player” action to play those files in VLC or another native player.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEBVLC_MEDIA_DIR` | `./media` | Optional app-managed folder to index and watch |
| `WEBVLC_PORT` | `4000` | HTTP port |
| `WEBVLC_HOST` | `127.0.0.1` | Bind address |
| `WEBVLC_DB_PATH` | `./edits.db` | SQLite database path |

`WEBVLC_MEDIA_DIR` is optional; normal use is to choose a folder in the app. `EDITS_DIR` and `PORT` are still accepted as compatibility aliases.

To make the app available elsewhere on your private network, set `WEBVLC_HOST=0.0.0.0`. Be aware that library actions include rename and permanent delete, so do not expose the server directly to the public internet.

## Supported library formats

Video: `mp4`, `mov`, `avi`, `mkv`, `webm`, `wmv`, `flv`, `m4v`, `mpg`, `mpeg`, `ogv`

Audio: `mp3`, `wav`, `flac`, `aac`, `m4a`, `ogg`, `opus`, `wma`

web_vlc can index all formats above. Actual in-browser playback depends on the codecs supported by the browser. The “Open in desktop player” action remains available for formats that need VLC or another native player.

## Player shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play or pause |
| `←` / `→` | Seek 5 seconds |
| `Ctrl` + `←` / `→` | Seek 30 seconds |
| `M` | Mute or unmute |
| `F` | Fullscreen |
| `N` / `P` | Next or previous item |
| `/` | Focus library search |
| `Esc` | Close menus or collapse the player |

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Server, folder, and FFmpeg status |
| `GET` | `/videos` | Scan and return the active library |
| `GET` | `/video/:id` | Stream media with range support |
| `GET` | `/thumbnail/:id` | Return or generate a thumbnail |
| `POST` | `/scan` | Rescan the configured folder |
| `POST` | `/favorite/:id` | Toggle a favorite |
| `POST` | `/tags/:id` | Add or remove a tag |
| `POST` | `/rename/:id` | Rename a file on disk |
| `POST` | `/open/:id` | Open in the desktop media player |
| `POST` | `/delete/:id` | Permanently delete a file |

## Project layout

```text
web_vlc/
├── config.js          # portable runtime configuration
├── db.js              # SQLite and filesystem synchronization
├── server.js          # Express API and media streaming
├── public/
│   ├── index.html     # semantic application shell
│   ├── style.css      # responsive visual system
│   └── app.js         # library and player behavior
├── thumbnails/        # generated thumbnail cache
└── edits.db           # local metadata database
```

## Privacy model

The server does not upload media or call third-party services. Browser-opened files use temporary object URLs and are removed when the tab closes. The database stores only filenames, local paths, tags, favorite state, and scan timestamps.

## License

MIT
