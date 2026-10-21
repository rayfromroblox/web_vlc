# web_vlc

A media player that runs in your browser. Add the folders where your videos and music live, and web_vlc builds a library you can browse, search and play.

## Run

```bash
npx -y web-vlc
```

You need Node.js 24 or newer. It starts a local server and opens your browser. If you already know which folders you want:

```bash
npx -y web-vlc ~/Videos ~/Music
```

## What it does

Click something to play it. You get the usual player controls: seek, volume, speed, shuffle, repeat, fullscreen and picture-in-picture.

includes: search, tags, favorites and sorting when the library gets big. Settings stores your theme, accent color, density, reduced motion, skip step and default speed. You can drag a video onto the window to play it without adding it, and unplugged drives show their files as offline until they're back.

## Options

```
web-vlc [folder ...] [options]

  -p, --port <port>   Port to listen on (default 4000, or the next free one)
      --no-open       Don't open the browser
  -v, --version       Print the version
  -h, --help          Show help
```

## FFmpeg

Video thumbnails and conversion for codecs the browser can't play need [FFmpeg](https://ffmpeg.org) on your PATH. Without it, videos get a plain placeholder tile. 

## Where your data lives

database, settings and thumbnails here:

- Windows: `%LOCALAPPDATA%\web_vlc`
- macOS: `~/Library/Application Support/web_vlc`
- Linux: `~/.local/share/web_vlc`

## Development

```bash
git clone https://github.com/rayfromroblox/web_vlc.git
cd web_vlc
npm install
npm start
npm test
```

## License

MIT
