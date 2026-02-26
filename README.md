<div align="center">

# 🎬 Nova Video Studio

**All-in-One Video Downloader, Merger & Converter**

[![Build](https://github.com/thinhphan109/NovaVideoStudio/actions/workflows/build.yml/badge.svg)](https://github.com/thinhphan109/NovaVideoStudio/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/thinhphan109/NovaVideoStudio?style=flat-square&color=blue)](https://github.com/thinhphan109/NovaVideoStudio/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

<img src="public/logo.svg" width="128" height="128" alt="Nova Video Studio Logo" />

*Download videos from 1000+ sites, merge clips, convert formats — all in one beautiful desktop app.*

</div>

---

## ✨ Features

### 🔽 Downloader
- **1000+ supported sites** — YouTube, Vimeo, TikTok, Twitch, Facebook, Dailymotion, M3U8/HLS streams, direct links
- **Playlist support** — Paste a YouTube playlist URL → auto-expands all videos
- **Quality selection** — Best / 1080p / 720p / 480p / 360p
- **Format options** — MP4, MKV, MP3 (audio extraction)
- **Parallel downloads** — Up to 5 concurrent downloads
- **Pause / Resume** — Pause downloads and resume from where you left off
- **Cancel** — Force-kill instantly with process tree termination
- **Bandwidth limiter** — Limit speed: 1 / 2 / 5 / 10 MB/s
- **Batch import** — Import URLs from `.txt` files
- **Clipboard auto-detect** — Detects video URLs in clipboard, shows toast to add
- **Drag & Drop** — Drag links from browser directly into the app
- **Download history** — Last 100 downloads saved locally

### ✂️ Merger (Video Forge)
- Merge multiple video files into one
- FFmpeg stream copy (no re-encoding = instant speed)
- Real-time progress display

### 🔄 Converter (Studio Converter)
- Convert between formats: MP4, MKV, MP3, GIF
- H.264 encoding with CRF 22 quality
- GIF: 480px width, 15fps
- MP3: 320kbps audio extraction
- Real-time FFmpeg progress

### 💎 UX & Polish
- **System tray** — Minimize to tray, download in background
- **Settings panel** — Max concurrent, default format/quality, bandwidth limit
- **Keyboard shortcuts** — Ctrl+V paste, Ctrl+Enter add, Escape close
- **System notifications** — Desktop notification when download completes
- **Dark premium UI** — Glassmorphism, animations, noise texture

---

## 📸 Screenshots

| Downloader | Merger | Converter | Settings |
|:---:|:---:|:---:|:---:|
| Queue with pause/resume | Multi-file merge | Format converter | Settings panel |

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- [Git](https://git-scm.com/)

### Install & Run
```bash
# Clone the repository
git clone https://github.com/thinhphan109/NovaVideoStudio.git
cd NovaVideoStudio

# Install dependencies
npm install

# Download binaries (yt-dlp + ffmpeg) into bin/
# Place yt-dlp.exe and ffmpeg.exe in the bin/ folder
# yt-dlp: https://github.com/yt-dlp/yt-dlp/releases
# ffmpeg: https://ffmpeg.org/download.html

# Start development
npm run dev
```

### Build for Production
```bash
# Build Windows installer (.exe)
npm run build
```

Output will be in `release/` folder.

---

## 🏗️ Architecture

```
NovaVideoStudio/
├── electron/
│   ├── main.ts          # Main process (IPC handlers, yt-dlp/ffmpeg integration)
│   └── preload.ts       # Preload script (clipboard API bridge)
├── src/
│   ├── App.tsx           # React UI (all tabs, queue, settings)
│   ├── main.tsx          # React entry point
│   ├── index.css         # Tailwind + custom styles
│   └── types.d.ts        # TypeScript declarations
├── bin/
│   ├── yt-dlp.exe        # Video download engine
│   └── ffmpeg.exe        # Media processing engine
├── public/
│   └── logo.svg          # App logo
├── package.json
├── vite.config.ts
├── electron-builder.json5
└── .github/
    └── workflows/
        └── build.yml     # CI/CD pipeline
```

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Framework | Electron 32 |
| Frontend | React 18 + TypeScript |
| Styling | Tailwind CSS 4 |
| Bundler | Vite 5 |
| Animation | Framer Motion |
| Icons | Lucide React |
| Video Engine | yt-dlp |
| Media Engine | FFmpeg |
| Packaging | electron-builder |

### IPC Handlers
| Handler | Description |
|---------|-------------|
| `get-video-info` | Extract metadata from URL |
| `get-playlist-info` | Expand playlist into individual URLs |
| `download-video` | Download with progress, quality, bandwidth limit |
| `cancel-download` | Force-kill process tree (taskkill /T /F) |
| `pause-download` | Kill process, preserve .part file for resume |
| `merge-videos` | FFmpeg concat with progress |
| `convert-video` | FFmpeg format conversion with progress |
| `select-files` | OS file picker dialog |
| `select-folder` | OS folder picker dialog |
| `import-txt` | Read URLs from .txt file |
| `open-path` | Open folder in Explorer |
| `show-in-folder` | Reveal file in Explorer |

---

## ⚙️ Configuration

Settings are saved to `localStorage` and persist across restarts:

| Setting | Options | Default |
|---------|---------|---------|
| Max Parallel | 1 – 5 | 3 |
| Default Format | MP4, MKV, MP3 | MP4 |
| Default Quality | Best, 1080p, 720p, 480p | Best |
| Bandwidth Limit | Unlimited, 1M, 2M, 5M, 10M | Unlimited |

---

## 🛠️ Development

```bash
# Start dev server with hot reload
npm run dev

# Type check
npx tsc --noEmit

# Build production bundle
npm run build
```

---

## 📦 Release

Releases are automated via GitHub Actions:

1. Create a version tag: `git tag v1.0.0 && git push --tags`
2. CI builds Windows installer
3. Release is created with `.exe` attached
4. Discord webhook notifies build status

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with ❤️ by [thinhphan](https://thinhphan.io.vn)**

*Powered by Electron • React • yt-dlp • FFmpeg*

</div>
