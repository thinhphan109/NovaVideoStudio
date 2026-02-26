import { app, BrowserWindow, shell, ipcMain, Menu, dialog, Notification, Tray, nativeImage } from 'electron'
import { release } from 'node:os'
import { join } from 'node:path'
import { exec, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

// ─── Directory Structure ─────────────────────────────────
// ├─┬ dist-electron
// │ ├─ main.js
// │ └─ preload.js
// ├─┬ dist
// │ └── index.html

process.env.DIST_ELECTRON = join(__dirname, '../')
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
    ? join(process.env.DIST_ELECTRON, '../public')
    : process.env.DIST

// ─── System Compatibility ────────────────────────────────
if (release().startsWith('6.1')) app.disableHardwareAcceleration()
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
    app.quit()
    process.exit(0)
}

// ─── Binary Paths ────────────────────────────────────────
// In dev: binaries are in <project>/bin/
// In prod: binaries are in <resources>/bin/
const isDev = !app.isPackaged
const binPath = isDev
    ? join(process.cwd(), 'bin')
    : join(process.resourcesPath, 'bin')

const YTDLP = join(binPath, 'yt-dlp.exe')
const FFMPEG = join(binPath, 'ffmpeg.exe')

// Validate at startup
if (!existsSync(YTDLP)) console.error(`[FATAL] yt-dlp NOT FOUND: ${YTDLP}`)
if (!existsSync(FFMPEG)) console.error(`[FATAL] ffmpeg NOT FOUND: ${FFMPEG}`)
console.log(`[System] Binary path: ${binPath}`)
console.log(`[System] yt-dlp: ${existsSync(YTDLP) ? 'OK' : 'MISSING'}`)
console.log(`[System] ffmpeg: ${existsSync(FFMPEG) ? 'OK' : 'MISSING'}`)

// ─── Active Download Processes ───────────────────────────
// Track both process and args for pause/resume support
interface ActiveDownload {
    proc: import('node:child_process').ChildProcess
    args: string[]
    downloadDir: string
    videoUrl: string
    safeName: string
}
const activeProcesses = new Map<string, ActiveDownload>()

// Force kill a process tree on Windows (kills yt-dlp + child ffmpeg)
function killProcessTree(pid: number): void {
    try {
        exec(`taskkill /PID ${pid} /T /F`, (err) => {
            if (err) console.log(`[Kill] taskkill fallback for PID ${pid}: ${err.message}`)
        })
    } catch (e) {
        console.error(`[Kill] Error killing PID ${pid}:`, e)
    }
}

// ─── Tray ────────────────────────────────────────────────
let tray: Tray | null = null
let isQuitting = false

// ─── Window ──────────────────────────────────────────────
let win: BrowserWindow | null = null
const preload = join(__dirname, './preload.js')
const url = process.env.VITE_DEV_SERVER_URL
const indexHtml = join(process.env.DIST, 'index.html')

async function createWindow() {
    win = new BrowserWindow({
        title: 'Nova Video Studio',
        icon: join(process.env.VITE_PUBLIC!, 'logo.svg'),
        width: 1200,
        height: 800,
        autoHideMenuBar: true,
        webPreferences: {
            preload,
        },
    })

    if (process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(url!)
        win.webContents.openDevTools()
    } else {
        win.loadFile(indexHtml)
    }

    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', new Date().toLocaleString())
    })

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https:')) shell.openExternal(url)
        return { action: 'deny' }
    })

    // Minimize to tray instead of close
    win.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault()
            win?.hide()
        }
    })
}

// ─── App Lifecycle ───────────────────────────────────────
app.whenReady().then(() => {
    const template: any[] = [
        {
            label: 'Chỉnh sửa',
            submenu: [
                { label: 'Hoàn tác', role: 'undo' },
                { label: 'Làm lại', role: 'redo' },
                { type: 'separator' },
                { label: 'Cắt', role: 'cut', accelerator: 'Ctrl+X' },
                { label: 'Sao chép', role: 'copy', accelerator: 'Ctrl+C' },
                { label: 'Dán', role: 'paste', accelerator: 'Ctrl+V' },
                { label: 'Chọn tất cả', role: 'selectAll', accelerator: 'Ctrl+A' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    createWindow();

    // ─── System Tray ─────────────────────────────────────
    const logoPath = join(process.env.VITE_PUBLIC!, 'logo.svg')
    let trayIcon: Electron.NativeImage
    try {
        // Try SVG first (Electron can handle SVG on some platforms)
        trayIcon = nativeImage.createFromPath(logoPath)
        if (trayIcon.isEmpty()) throw new Error('empty')
    } catch {
        // Fallback to inline base64 PNG
        trayIcon = nativeImage.createFromDataURL(
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAWtJREFUWEftlrFuwzAMRC8dOvU/+v9f0qFTkxsIgqZIWnKSIoMB2BLveCRFeTNezPh/M/Y/BKjq2cz8W0SezeyBkm8fpJa4ueSqemVmt7KBl0T0tgSxCKCqV2b2cnDKG4D7OQjVMzYAf2dmj1XwnRqNAKp6YWbPh+a/AviYG/eo0W0E9OMf1c5MsQ0AYL8E8E5Er3OpBQDV2tdi8mNsZAYA0D4KgM8JkW0EMM0BvDezp6HA9gJkACgb8b77kfQJkXUKoKqfzOy69JH0DiAFsAcg7P52eTYC7GbBFECkFcxK7h/Lq5ndUPIrIrJbhJ4CkLQxigj4ky9m9lJzfgYgG/DhHMQs4NczewjJ94joUaCeAvjm0ynFKYBw+38F8Omf4pDjLADRfCPpGerQsZBsHIVJivl3sEgaKfcUe0qx1/nPkpGSHxJI+rxNGyn5y20F2BuMiGYDJfqSk2xz/qYz90M2P41fwGfrXAo/zqYFAAAAABJRU5ErkJggg=='
        )
    }
    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))
    tray.setToolTip('Nova Video Studio')
    const trayMenu = Menu.buildFromTemplate([
        { label: 'Show Nova Studio', click: () => { win?.show(); win?.focus() } },
        { type: 'separator' },
        { label: 'Quit', click: () => { isQuitting = true; app.quit() } }
    ])
    tray.setContextMenu(trayMenu)
    tray.on('double-click', () => { win?.show(); win?.focus() })
})

app.on('window-all-closed', () => {
    // Don't quit - minimize to tray
    if (isQuitting) {
        win = null
        app.quit()
    }
})

app.on('before-quit', () => {
    isQuitting = true
})

app.on('second-instance', () => {
    if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
    }
})

app.on('activate', () => {
    const allWindows = BrowserWindow.getAllWindows()
    if (allWindows.length) {
        allWindows[0].focus()
    } else {
        createWindow()
    }
})

ipcMain.handle('open-win', (_, arg) => {
    const childWindow = new BrowserWindow({
        webPreferences: {
            preload,
            nodeIntegration: true,
            contextIsolation: false,
        },
    })

    if (process.env.VITE_DEV_SERVER_URL) {
        childWindow.loadURL(`${url}#${arg}`)
    } else {
        childWindow.loadFile(indexHtml, { hash: arg })
    }
})

// ─── Folder Picker ───────────────────────────────────────
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory']
    })
    return result.filePaths[0]
})

// ─── Open path in file explorer ──────────────────────────
ipcMain.handle('open-path', async (_, dirPath: string) => {
    shell.openPath(dirPath)
})

ipcMain.handle('show-in-folder', async (_, filePath: string) => {
    shell.showItemInFolder(filePath)
})

// ═══════════════════════════════════════════════════════════
// ─── VIDEO INFO ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
ipcMain.handle('get-video-info', async (_, videoUrl: string) => {
    return new Promise((resolve) => {
        console.log(`[Analyze] URL: ${videoUrl}`)

        const args = ['-j', '--no-playlist', '--no-check-certificate', videoUrl]
        const proc = spawn(YTDLP, args, { windowsHide: true })

        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (d) => { stdout += d })
        proc.stderr.on('data', (d) => { stderr += d })

        proc.on('close', (code) => {
            if (code === 0 && stdout) {
                try {
                    const info = JSON.parse(stdout)
                    console.log(`[Analyze] Success: "${info.title}"`)
                    resolve(info)
                    return
                } catch (e) {
                    console.error('[Analyze] JSON parse failed:', e)
                }
            }

            // Fallback for raw streams / direct links
            console.warn(`[Analyze] Fallback (code=${code}). stderr: ${stderr.slice(0, 100)}`)
            const isM3U8 = videoUrl.toLowerCase().includes('.m3u8')
            resolve({
                title: isM3U8 ? 'Stream_' + Date.now() : 'Video_' + Date.now(),
                thumbnail: '',
                duration_string: isM3U8 ? 'Stream' : 'Unknown',
                uploader: 'Direct Link',
                id: 'raw'
            })
        })

        proc.on('error', (err) => {
            console.error('[Analyze] Process error:', err.message)
            resolve({
                title: 'Error_' + Date.now(),
                thumbnail: '',
                duration_string: 'Error',
                uploader: 'Unknown',
                id: 'error'
            })
        })
    })
})

// ═══════════════════════════════════════════════════════════
// ─── PLAYLIST INFO ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════
ipcMain.handle('get-playlist-info', async (_, playlistUrl: string) => {
    return new Promise((resolve) => {
        console.log(`[Playlist] Extracting: ${playlistUrl}`)
        const args = ['--flat-playlist', '-j', '--no-check-certificate', playlistUrl]
        const proc = spawn(YTDLP, args, { windowsHide: true })

        let stdout = ''
        proc.stdout.on('data', (d) => { stdout += d })

        proc.on('close', (code) => {
            const entries: any[] = []
            const lines = stdout.trim().split('\n').filter(l => l.trim())
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line)
                    entries.push({
                        url: entry.url || entry.webpage_url || `https://youtube.com/watch?v=${entry.id}`,
                        title: entry.title || 'Unknown',
                        duration: entry.duration_string || entry.duration || '',
                        uploader: entry.uploader || entry.channel || ''
                    })
                } catch { }
            }
            console.log(`[Playlist] Found ${entries.length} entries`)
            resolve(entries)
        })

        proc.on('error', () => resolve([]))
    })
})

// ═══════════════════════════════════════════════════════════
// ─── IMPORT TXT ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
ipcMain.handle('import-txt', async () => {
    const result = await dialog.showOpenDialog(win!, {
        title: 'Import URLs from .txt',
        properties: ['openFile'],
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
    })
    if (result.filePaths.length === 0) return []
    try {
        const content = readFileSync(result.filePaths[0], 'utf-8')
        const urls = content.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'))
        console.log(`[Import] Loaded ${urls.length} URLs from ${result.filePaths[0]}`)
        return urls
    } catch (e) {
        console.error('[Import] Failed:', e)
        return []
    }
})

// ═══════════════════════════════════════════════════════════
// ─── VIDEO DOWNLOAD ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════
ipcMain.handle('download-video', async (event, { videoUrl, format = 'mp4', quality = 'best', limitRate = '', customName, downloadPath }) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender)

    // 1. Determine output directory (MUST be absolute)
    const downloadDir = (downloadPath && downloadPath.length > 0)
        ? downloadPath
        : app.getPath('downloads')

    console.log(`[Download] Save to: ${downloadDir}`)

    // 2. Sanitize filename
    const timestamp = Date.now()
    const safeName = customName
        ? customName.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
        : `video_${timestamp}`

    // 3. Absolute output path
    const outputPath = join(downloadDir, `${safeName}.%(ext)s`)

    console.log(`[Download] Output: ${outputPath}`)
    console.log(`[Download] Format: ${format} | Quality: ${quality} | Limit: ${limitRate || 'unlimited'} | URL: ${videoUrl}`)

    return new Promise((resolve, reject) => {
        // 4. Build arguments
        const args: string[] = [
            '--newline',
            '--no-playlist',
            '--no-check-certificate',
            '--force-overwrites',
            '--ffmpeg-location', FFMPEG,
            '-o', outputPath,
        ]

        // 4b. Bandwidth limiter
        if (limitRate && limitRate !== '0') {
            args.push('--limit-rate', limitRate)
        }

        // 5. Format + Quality selection
        const isM3U8 = videoUrl.toLowerCase().includes('.m3u8')

        if (format === 'mp3') {
            args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0')
        } else {
            args.push('--merge-output-format', format)

            if (isM3U8) {
                // HLS streams: quality is usually in the URL itself
                args.push('--format', 'best', '--hls-prefer-native')
            } else if (quality === 'best') {
                if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
                    args.push('--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best')
                } else {
                    args.push('--format', 'bestvideo+bestaudio/best')
                }
            } else {
                // Specific quality: 1080, 720, 480, 360
                const height = quality
                args.push('--format', `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`)
            }
        }

        args.push(videoUrl)

        // 6. Spawn
        const proc = spawn(YTDLP, args, { cwd: downloadDir, windowsHide: true })

        // Track process for cancellation and pause/resume
        activeProcesses.set(videoUrl, { proc, args, downloadDir, videoUrl, safeName })

        let lastStderr = ''

        // 7. Parse stdout: progress + speed + ETA + filesize
        proc.stdout.on('data', (data) => {
            const text = data.toString()

            // Parse: [download]  45.2% of ~500.00MiB at 7.50MiB/s ETA 01:05 (frag 120/264)
            const pctMatch = text.match(/(\d+\.?\d*)%/)
            if (pctMatch) {
                const progress = parseFloat(pctMatch[1])

                // Extract speed: "at    7.50MiB/s" or "at  387.79KiB/s"
                const speedMatch = text.match(/at\s+(\d+\.?\d*\s*[KMG]iB\/s)/)
                const speed = speedMatch ? speedMatch[1].trim() : ''

                // Extract ETA: "ETA 01:05" or "ETA Unknown"
                const etaMatch = text.match(/ETA\s+(\S+)/)
                const eta = (etaMatch && etaMatch[1] !== 'Unknown') ? etaMatch[1] : ''

                // Extract total size: "of ~500.00MiB" or "of  233.95MiB"
                const sizeMatch = text.match(/of\s+~?\s*(\d+\.?\d*\s*[KMG]iB)/)
                const totalSize = sizeMatch ? sizeMatch[1].trim() : ''

                senderWin?.webContents.send('download-progress', {
                    progress, url: videoUrl, speed, eta, totalSize
                })
            }
        })

        // 8. Parse stderr for stream time progress
        proc.stderr.on('data', (data) => {
            const text = data.toString()
            lastStderr = text

            const timeMatch = text.match(/time=(\d{2}:\d{2}:\d{2})/)
            if (timeMatch) {
                senderWin?.webContents.send('download-progress', {
                    progress: -1, url: videoUrl, status: `Downloading: ${timeMatch[1]}`
                })
            }
        })

        // 9. Completion
        proc.on('close', (code) => {
            const wasActive = activeProcesses.has(videoUrl)
            activeProcesses.delete(videoUrl)
            console.log(`[Download] Exited: code ${code}, wasActive=${wasActive}`)

            if (code === 0) {
                // System notification
                if (Notification.isSupported()) {
                    new Notification({
                        title: 'Download Complete',
                        body: `${safeName} has been saved.`,
                        silent: false
                    }).show()
                }
                resolve({ success: true, path: downloadDir })
            } else if (code === 1 && !wasActive) {
                // Process was killed by cancel/pause (taskkill returns code 1)
                reject(new Error('Download cancelled'))
            } else if (code === null) {
                reject(new Error('Download cancelled'))
            } else {
                const errMsg = lastStderr.trim().slice(0, 200)
                reject(new Error(`Failed (code ${code}): ${errMsg}`))
            }
        })

        proc.on('error', (err) => {
            activeProcesses.delete(videoUrl)
            reject(new Error(`Engine error: ${err.message}`))
        })
    })
})

// ─── CANCEL DOWNLOAD (Force kill entire process tree) ────
ipcMain.handle('cancel-download', async (_, videoUrl: string) => {
    const active = activeProcesses.get(videoUrl)
    if (active) {
        const pid = active.proc.pid
        console.log(`[Cancel] Force killing PID ${pid} for: ${videoUrl}`)
        activeProcesses.delete(videoUrl)  // Remove BEFORE kill so close handler knows it was cancelled
        if (pid) killProcessTree(pid)
        return { success: true }
    }
    return { success: false, reason: 'No active process' }
})

// ─── PAUSE DOWNLOAD (Kill process but keep .part file for resume) ─
ipcMain.handle('pause-download', async (_, videoUrl: string) => {
    const active = activeProcesses.get(videoUrl)
    if (active) {
        const pid = active.proc.pid
        console.log(`[Pause] Pausing PID ${pid} for: ${videoUrl}`)
        // Save args before deleting
        const savedArgs = [...active.args]
        const savedDir = active.downloadDir
        const savedName = active.safeName
        activeProcesses.delete(videoUrl)  // Remove BEFORE kill
        if (pid) killProcessTree(pid)
        return { success: true, args: savedArgs, downloadDir: savedDir, safeName: savedName }
    }
    return { success: false, reason: 'No active process' }
})

// ═══════════════════════════════════════════════════════════
// ─── FILE PICKER ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
ipcMain.handle('select-files', async (_, options: { title?: string, filters?: any[] }) => {
    const result = await dialog.showOpenDialog(win!, {
        title: options.title || 'Select Files',
        properties: ['openFile', 'multiSelections'],
        filters: options.filters || [
            { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'webm', 'mov', 'flv', 'wmv', 'ts'] },
            { name: 'Audio Files', extensions: ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    })
    return result.filePaths
})

// ═══════════════════════════════════════════════════════════
// ─── FFMPEG MERGE ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
ipcMain.handle('merge-videos', async (event, { files, outputName, outputDir: customDir }) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender)
    const downloadDir = customDir || app.getPath('downloads')
    const safeName = (outputName || 'merged_video').replace(/[\\/:*?"<>|]/g, '_')
    const outputPath = join(downloadDir, `${safeName}.mp4`)

    return new Promise((resolve, reject) => {
        const fs = require('node:fs')
        const listPath = join(app.getPath('temp'), `concat_list_${Date.now()}.txt`)
        const content = files.map((f: string) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')
        fs.writeFileSync(listPath, content)

        const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath]

        console.log(`[Merge] Files: ${files.length}, Output: ${outputPath}`)
        const proc = spawn(FFMPEG, args, { windowsHide: true })

        proc.stderr.on('data', (data) => {
            const text = data.toString()
            // Parse time progress: time=00:01:23.45
            const timeMatch = text.match(/time=(\d{2}:\d{2}:\d{2})/)
            if (timeMatch) {
                senderWin?.webContents.send('ffmpeg-progress', {
                    type: 'merge',
                    status: `Processing: ${timeMatch[1]}`
                })
            }
        })

        proc.on('close', (code) => {
            try { fs.unlinkSync(listPath) } catch { }
            if (code === 0) {
                shell.openPath(downloadDir)
                resolve({ success: true, path: outputPath })
            } else {
                reject(new Error(`Merge failed (code ${code})`))
            }
        })

        proc.on('error', (err) => {
            reject(new Error(`FFmpeg error: ${err.message}`))
        })
    })
})

// ═══════════════════════════════════════════════════════════
// ─── FFMPEG CONVERT ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════
ipcMain.handle('convert-video', async (event, { inputFile, outputFormat, outputDir: customDir }) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender)
    const path = require('node:path')
    const outputDir = customDir || path.dirname(inputFile)
    const ext = path.extname(inputFile)
    const base = path.basename(inputFile, ext)
    const outputPath = join(outputDir, `${base}.${outputFormat}`)

    return new Promise((resolve, reject) => {
        let args: string[]

        if (outputFormat === 'mp3') {
            args = ['-y', '-i', inputFile, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', outputPath]
        } else if (outputFormat === 'gif') {
            args = ['-y', '-i', inputFile, '-vf', 'fps=15,scale=480:-1:flags=lanczos', '-loop', '0', outputPath]
        } else {
            args = ['-y', '-i', inputFile, '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-c:a', 'aac', outputPath]
        }

        console.log(`[Convert] ${inputFile} → ${outputPath}`)
        const proc = spawn(FFMPEG, args, { windowsHide: true })

        proc.stderr.on('data', (data) => {
            const text = data.toString()
            const timeMatch = text.match(/time=(\d{2}:\d{2}:\d{2})/)
            if (timeMatch) {
                senderWin?.webContents.send('ffmpeg-progress', {
                    type: 'convert',
                    status: `Converting: ${timeMatch[1]}`
                })
            }
        })

        proc.on('close', (code) => {
            if (code === 0) {
                shell.openPath(outputDir)
                resolve({ success: true, path: outputPath })
            } else {
                reject(new Error(`Conversion failed (code ${code})`))
            }
        })

        proc.on('error', (err) => {
            reject(new Error(`FFmpeg error: ${err.message}`))
        })
    })
})
