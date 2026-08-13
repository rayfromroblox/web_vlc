# web_vlc

A private media player for your own video and audio folders. Nothing is uploaded.

## Start

Install Node.js 20, 22, or 24, then run:

```bash
git clone https://github.com/rayfromroblox/web_vlc.git
cd web_vlc
npm start
```

On the first run, `npm start` installs what the app needs and opens the player. On Windows, you can double-click `start.bat` instead.

## Use

Open [http://127.0.0.1:4000](http://127.0.0.1:4000), click **Choose folder**, and select your media folder. You can also drag in or open individual files.

The selected folder stays private and is available for the current browser session.

## Optional

- Install FFmpeg to generate video thumbnails.
- Use `WEBVLC_PORT=5000 npm start` to use a different port.

Some formats may not play in the browser because of codec support. Use **Open in desktop player** for those files.

## License

MIT
