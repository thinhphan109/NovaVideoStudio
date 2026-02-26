import { useState, useEffect, useRef, useCallback } from 'react'
import { Download, Scissors, RefreshCw, Play, CheckCircle2, Trash2, Plus, FileText, AlertCircle, Folder, ChevronDown, XCircle, Zap, Clipboard, Link, FilePlus, Clock, X, Pause, RotateCcw, FolderOpen, Settings, StopCircle, Upload, ListVideo, Gauge } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

interface DownloadItem {
    id: string;
    url: string;
    title: string;
    thumbnail: string;
    duration: string;
    uploader: string;
    customName: string;
    progress: number;
    status: 'idle' | 'analyzing' | 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled' | 'paused';
    error?: string;
    speed?: string;
    eta?: string;
    totalSize?: string;
    outputDir?: string;
}

interface HistoryItem {
    name: string;
    url: string;
    date: string;
    format: string;
}

interface AppSettings {
    maxConcurrent: number;
    defaultFormat: string;
    defaultQuality: string;
    limitRate: string; // '0' = unlimited, '1M', '2M', '5M', '10M'
}

const DEFAULT_SETTINGS: AppSettings = { maxConcurrent: 3, defaultFormat: 'mp4', defaultQuality: 'best', limitRate: '0' }

function loadSettings(): AppSettings {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('nova_settings') || '{}') } }
    catch { return DEFAULT_SETTINGS }
}
function saveSettings(s: AppSettings) { localStorage.setItem('nova_settings', JSON.stringify(s)) }

function isVideoUrl(text: string): boolean {
    if (!text || text.length < 10) return false
    try {
        const url = new URL(text.trim())
        if (!['http:', 'https:'].includes(url.protocol)) return false
        return /\.(m3u8|mp4|mkv|webm|avi)(\?|$)/i.test(text) ||
            /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|facebook\.com.*video|tiktok\.com/i.test(text) ||
            /b-cdn\.net|bunny\.net|cloudfront\.net/i.test(text)
    } catch { return false }
}

function loadHistory(): HistoryItem[] {
    try { return JSON.parse(localStorage.getItem('nova_history') || '[]') } catch { return [] }
}
function saveHistory(h: HistoryItem[]) { localStorage.setItem('nova_history', JSON.stringify(h.slice(0, 100))) }

export default function App() {
    const [activeTab, setActiveTab] = useState<'download' | 'process' | 'convert'>('download')
    const [inputUrls, setInputUrls] = useState('')
    const [queue, setQueue] = useState<DownloadItem[]>([])
    const [globalStatus, setGlobalStatus] = useState('')
    const [downloadDir, setDownloadDir] = useState('')

    // Settings
    const [settings, setSettings] = useState<AppSettings>(loadSettings)
    const [showSettings, setShowSettings] = useState(false)
    const [selectedFormat, setSelectedFormat] = useState(settings.defaultFormat)
    const [selectedQuality, setSelectedQuality] = useState(settings.defaultQuality)

    // Clipboard auto-detect
    const [clipboardToast, setClipboardToast] = useState<string | null>(null)
    const lastClipboardRef = useRef('')

    // Drag & drop
    const [isDragOver, setIsDragOver] = useState(false)

    // Merger state
    const [mergeFiles, setMergeFiles] = useState<string[]>([])
    const [mergeName, setMergeName] = useState('')
    const [mergeStatus, setMergeStatus] = useState('')
    const [isMerging, setIsMerging] = useState(false)

    // Converter state
    const [convertFile, setConvertFile] = useState('')
    const [convertFormat, setConvertFormat] = useState('mp4')
    const [convertStatus, setConvertStatus] = useState('')
    const [isConverting, setIsConverting] = useState(false)

    // History
    const [history, setHistory] = useState<HistoryItem[]>(loadHistory)

    // Refs
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    // Listen for download progress
    useEffect(() => {
        const handler = (_event: any, data: any) => {
            setQueue(prev => prev.map(item =>
                item.url === data.url ? {
                    ...item,
                    progress: data.progress >= 0 ? data.progress : item.progress,
                    status: 'downloading',
                    speed: data.speed || item.speed,
                    eta: data.eta || item.eta,
                    totalSize: data.totalSize || item.totalSize,
                } : item
            ))
        }
        window.ipcRenderer.on('download-progress', handler)
        return () => window.ipcRenderer.off('download-progress', handler)
    }, [])

    // Listen for FFmpeg progress
    useEffect(() => {
        const handler = (_event: any, data: { type: string, status: string }) => {
            if (data.type === 'merge') setMergeStatus(data.status)
            if (data.type === 'convert') setConvertStatus(data.status)
        }
        window.ipcRenderer.on('ffmpeg-progress', handler)
        return () => window.ipcRenderer.off('ffmpeg-progress', handler)
    }, [])

    // Clipboard auto-detect
    useEffect(() => {
        const interval = setInterval(() => {
            try {
                const text = window.clipboardAPI?.readText()
                if (text && text !== lastClipboardRef.current && isVideoUrl(text)) {
                    const trimmed = text.trim()
                    if (!queue.some(item => item.url === trimmed)) {
                        lastClipboardRef.current = text
                        setClipboardToast(trimmed)
                        setTimeout(() => setClipboardToast(prev => prev === trimmed ? null : prev), 8000)
                    }
                }
            } catch { }
        }, 1500)
        return () => clearInterval(interval)
    }, [queue])

    // ─── Keyboard Shortcuts ──────────────────────────────────
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Ctrl+V when not focused on textarea → auto-paste
            if (e.ctrlKey && e.key === 'v' && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
                e.preventDefault()
                textareaRef.current?.focus()
                // Clipboard paste will be handled by the textarea
            }
            // Escape → close settings
            if (e.key === 'Escape' && showSettings) {
                setShowSettings(false)
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [showSettings])

    const tabs = [
        { id: 'download', name: 'Downloader', icon: Download },
        { id: 'process', name: 'Merger', icon: Scissors },
        { id: 'convert', name: 'Converter', icon: RefreshCw },
    ]

    // ─── Download Logic ──────────────────────────────────────
    const addUrlsToQueue = useCallback(async (urls: string[]) => {
        const validUrls = urls.map(u => u.trim()).filter(u => u !== '')
        if (validUrls.length === 0) return
        setGlobalStatus('Analyzing links...')

        for (const url of validUrls) {
            if (queue.some(item => item.url === url)) continue
            const tempId = Math.random().toString(36).slice(2, 9)
            setQueue(prev => [...prev, {
                id: tempId, url, title: 'Analyzing...', thumbnail: '', duration: '',
                uploader: '', customName: '', progress: 0, status: 'analyzing'
            }])

            try {
                const info = await window.ipcRenderer.invoke('get-video-info', url)
                const rawTitle = info.title || `download_${Date.now()}`
                const cleanTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '')
                const uniqueName = (rawTitle.toLowerCase() === 'video' || info.id === 'raw')
                    ? `${cleanTitle}_${Date.now()}` : cleanTitle

                setQueue(prev => prev.map(item =>
                    item.id === tempId ? {
                        ...item, title: info.title, thumbnail: info.thumbnail,
                        duration: info.duration_string, uploader: info.uploader,
                        customName: uniqueName, status: 'idle'
                    } : item
                ))
            } catch {
                setQueue(prev => prev.map(item =>
                    item.id === tempId ? { ...item, status: 'failed', title: 'Analysis failed' } : item
                ))
            }
        }
        setGlobalStatus('Ready')
    }, [queue])

    const handleAddLinks = async () => {
        const urls = inputUrls.split('\n').map(u => u.trim()).filter(u => u)
        if (urls.length === 0) return
        setInputUrls('')

        // Check for playlist URLs
        const playlistUrls = urls.filter(u => u.includes('list=') || u.includes('/playlist'))
        const regularUrls = urls.filter(u => !u.includes('list=') && !u.includes('/playlist'))

        // Add regular URLs directly
        if (regularUrls.length > 0) await addUrlsToQueue(regularUrls)

        // Expand playlists
        for (const pUrl of playlistUrls) {
            setGlobalStatus(`Expanding playlist...`)
            try {
                const entries = await window.ipcRenderer.invoke('get-playlist-info', pUrl)
                if (entries && entries.length > 0) {
                    setGlobalStatus(`Found ${entries.length} videos in playlist`)
                    const entryUrls = entries.map((e: any) => e.url)
                    await addUrlsToQueue(entryUrls)
                } else {
                    // Fallback: treat as single video
                    await addUrlsToQueue([pUrl])
                }
            } catch {
                await addUrlsToQueue([pUrl])
            }
        }
        setGlobalStatus('Ready')
    }

    const handleImportTxt = async () => {
        const urls = await window.ipcRenderer.invoke('import-txt')
        if (urls && urls.length > 0) {
            setGlobalStatus(`Imported ${urls.length} URLs`)
            await addUrlsToQueue(urls)
        }
    }

    const handleAddFromClipboard = () => {
        if (clipboardToast) { addUrlsToQueue([clipboardToast]); setClipboardToast(null) }
    }

    const startDownload = async (id: string) => {
        const item = queue.find(i => i.id === id)
        if (!item || item.status === 'downloading') return
        const keepProgress = item.status === 'paused'
        setQueue(prev => prev.map(i => i.id === id ? {
            ...i, status: 'queued', progress: keepProgress ? i.progress : 0,
            speed: '', eta: '', totalSize: '', error: ''
        } : i))

        try {
            const dir = downloadDir || undefined
            const result = await window.ipcRenderer.invoke('download-video', {
                videoUrl: item.url, customName: item.customName,
                format: selectedFormat, quality: selectedQuality,
                limitRate: settings.limitRate !== '0' ? settings.limitRate : '',
                downloadPath: dir
            })
            if (result.success) {
                setQueue(prev => prev.map(i => i.id === id ? { ...i, status: 'completed', progress: 100, outputDir: result.path } : i))
                const newEntry: HistoryItem = { name: item.customName || item.title, url: item.url, date: new Date().toLocaleString(), format: selectedFormat }
                setHistory(prev => { const h = [newEntry, ...prev].slice(0, 100); saveHistory(h); return h })
            }
        } catch (error: any) {
            const msg = error.message || 'Unknown error'
            const currentItem = queue.find(i => i.id === id)
            if (currentItem?.status === 'paused') return
            if (msg.includes('cancelled')) {
                setQueue(prev => prev.map(i => i.id === id && i.status !== 'paused' ? { ...i, status: 'cancelled', error: 'Cancelled' } : i))
            } else {
                setQueue(prev => prev.map(i => i.id === id && i.status !== 'paused' ? { ...i, status: 'failed', error: msg } : i))
            }
        }
    }

    const pauseDownload = async (id: string) => {
        const item = queue.find(i => i.id === id)
        if (!item) return
        setQueue(prev => prev.map(i => i.id === id ? { ...i, status: 'paused', speed: '', eta: '' } : i))
        await window.ipcRenderer.invoke('pause-download', item.url)
    }

    const cancelDownload = async (id: string) => {
        const item = queue.find(i => i.id === id)
        if (!item) return
        setQueue(prev => prev.map(i => i.id === id ? { ...i, status: 'cancelled', error: 'Cancelled', speed: '', eta: '' } : i))
        await window.ipcRenderer.invoke('cancel-download', item.url)
    }

    // ─── Batch Operations ────────────────────────────────────
    const pauseAll = () => {
        queue.filter(i => i.status === 'downloading' || i.status === 'queued').forEach(i => pauseDownload(i.id))
    }

    const cancelAll = () => {
        queue.filter(i => ['downloading', 'queued', 'paused'].includes(i.status)).forEach(i => cancelDownload(i.id))
    }

    const startAllDownloads = () => {
        const downloadable = queue.filter(i => ['idle', 'failed', 'cancelled', 'paused'].includes(i.status))
        const activeCount = queue.filter(i => i.status === 'downloading' || i.status === 'queued').length
        downloadable.slice(0, settings.maxConcurrent - activeCount).forEach(i => startDownload(i.id))
    }

    const openFolder = (dir: string) => {
        if (dir) window.ipcRenderer.invoke('open-path', dir)
    }

    useEffect(() => {
        const dl = queue.filter(i => i.status === 'downloading').length
        const done = queue.filter(i => i.status === 'completed').length
        const fail = queue.filter(i => i.status === 'failed').length
        const paused = queue.filter(i => i.status === 'paused').length
        if (dl > 0) setGlobalStatus(`Downloading ${dl} task${dl > 1 ? 's' : ''}...`)
        else if (paused > 0) setGlobalStatus(`${paused} paused`)
        else if (done > 0 && fail === 0 && queue.length > 0) setGlobalStatus('All downloads complete!')
        else if (fail > 0) setGlobalStatus(`${fail} failed`)
        else if (queue.length > 0) setGlobalStatus('Ready')
        else setGlobalStatus('')
    }, [queue])

    // ─── Merger Logic ────────────────────────────────────────
    const handleAddMergeFiles = async () => {
        const files = await window.ipcRenderer.invoke('select-files', { title: 'Select videos to merge' })
        if (files && files.length > 0) setMergeFiles(prev => [...prev, ...files])
    }
    const handleMerge = async () => {
        if (mergeFiles.length < 2) return
        setIsMerging(true); setMergeStatus('Starting merge...')
        try {
            await window.ipcRenderer.invoke('merge-videos', { files: mergeFiles, outputName: mergeName || `merged_${Date.now()}`, outputDir: downloadDir || undefined })
            setMergeStatus('✅ Merge complete! File saved.'); setMergeFiles([]); setMergeName('')
        } catch (e: any) { setMergeStatus(`❌ ${e.message}`) }
        setIsMerging(false)
    }

    // ─── Converter Logic ─────────────────────────────────────
    const handleSelectConvertFile = async () => {
        const files = await window.ipcRenderer.invoke('select-files', { title: 'Select video to convert' })
        if (files && files.length > 0) setConvertFile(files[0])
    }
    const handleConvert = async () => {
        if (!convertFile) return
        setIsConverting(true); setConvertStatus('Starting conversion...')
        try {
            await window.ipcRenderer.invoke('convert-video', { inputFile: convertFile, outputFormat: convertFormat, outputDir: downloadDir || undefined })
            setConvertStatus('✅ Conversion complete!'); setConvertFile('')
        } catch (e: any) { setConvertStatus(`❌ ${e.message}`) }
        setIsConverting(false)
    }

    const handleSelectFolder = async () => {
        const path = await window.ipcRenderer.invoke('select-folder')
        if (path) setDownloadDir(path)
    }

    // ─── Settings ────────────────────────────────────────────
    const updateSettings = (partial: Partial<AppSettings>) => {
        setSettings(prev => { const s = { ...prev, ...partial }; saveSettings(s); return s })
    }

    // Drag & Drop
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true) }
    const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false) }
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault(); setIsDragOver(false)
        const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list')
        if (text) { const urls = text.split('\n').filter(u => u.trim().startsWith('http')); if (urls.length > 0) addUrlsToQueue(urls) }
    }

    const getStatusDisplay = (item: DownloadItem) => {
        if (item.status === 'downloading') {
            const parts = [`${Math.round(item.progress)}%`]
            if (item.speed) parts.push(item.speed)
            if (item.eta) parts.push(`ETA ${item.eta}`)
            if (item.totalSize) parts.push(item.totalSize)
            return parts.join(' • ')
        }
        if (item.status === 'paused') return `PAUSED at ${Math.round(item.progress)}%`
        if (item.status === 'failed') return `FAILED: ${item.error || 'Unknown'}`
        if (item.status === 'cancelled') return 'CANCELLED'
        if (item.status === 'completed') return 'COMPLETED'
        if (item.status === 'analyzing') return 'ANALYZING...'
        if (item.status === 'queued') return 'QUEUED...'
        return 'READY'
    }

    const hasActive = queue.some(i => i.status === 'downloading' || i.status === 'queued')

    return (
        <div className="flex h-screen w-full flex-col overflow-hidden bg-black text-[#FAFAFA] font-['Poppins']"
            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>

            {/* Drag overlay */}
            <AnimatePresence>
                {isDragOver && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-center justify-center pointer-events-none">
                        <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="flex flex-col items-center gap-6">
                            <div className="w-32 h-32 rounded-full bg-white/10 flex items-center justify-center border-4 border-dashed border-white/30">
                                <Link className="h-16 w-16 text-white/60" />
                            </div>
                            <p className="text-2xl font-black font-['Righteous'] uppercase tracking-wider text-white/80">Drop Link Here</p>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Settings Modal */}
            <AnimatePresence>
                {showSettings && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-xl flex items-center justify-center"
                        onClick={() => setShowSettings(false)}>
                        <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                            className="bg-[#111] border border-white/10 rounded-3xl p-8 w-[480px] shadow-2xl space-y-6"
                            onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-black font-['Righteous'] uppercase tracking-tight">Settings</h2>
                                <button onClick={() => setShowSettings(false)} className="text-white/30 hover:text-white transition-all"><X className="h-5 w-5" /></button>
                            </div>

                            <div className="space-y-5">
                                {/* Max Concurrent */}
                                <div>
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-2">Max Parallel Downloads</label>
                                    <div className="flex gap-2">
                                        {[1, 2, 3, 4, 5].map(n => (
                                            <button key={n} onClick={() => updateSettings({ maxConcurrent: n })}
                                                className={cn("w-12 h-12 rounded-xl text-sm font-bold transition-all border",
                                                    settings.maxConcurrent === n ? "bg-white text-black border-white" : "bg-black/40 border-white/10 text-white/40 hover:border-white/30")}>
                                                {n}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Default Format */}
                                <div>
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-2">Default Format</label>
                                    <div className="flex gap-2">
                                        {['mp4', 'mkv', 'mp3'].map(fmt => (
                                            <button key={fmt} onClick={() => { updateSettings({ defaultFormat: fmt }); setSelectedFormat(fmt) }}
                                                className={cn("px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border",
                                                    settings.defaultFormat === fmt ? "bg-white text-black border-white" : "bg-black/40 border-white/10 text-white/40 hover:border-white/30")}>
                                                {fmt}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Default Quality */}
                                <div>
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-2">Default Quality</label>
                                    <div className="flex gap-2">
                                        {[{ v: 'best', l: 'Best' }, { v: '1080', l: '1080p' }, { v: '720', l: '720p' }, { v: '480', l: '480p' }].map(q => (
                                            <button key={q.v} onClick={() => { updateSettings({ defaultQuality: q.v }); setSelectedQuality(q.v) }}
                                                className={cn("px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border",
                                                    settings.defaultQuality === q.v ? "bg-white text-black border-white" : "bg-black/40 border-white/10 text-white/40 hover:border-white/30")}>
                                                {q.l}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Bandwidth Limit */}
                                <div>
                                    <label className="text-[10px] font-bold uppercase tracking-widest text-white/40 block mb-2">Bandwidth Limit</label>
                                    <div className="flex gap-2 flex-wrap">
                                        {[{ v: '0', l: 'Unlimited' }, { v: '1M', l: '1 MB/s' }, { v: '2M', l: '2 MB/s' }, { v: '5M', l: '5 MB/s' }, { v: '10M', l: '10 MB/s' }].map(r => (
                                            <button key={r.v} onClick={() => updateSettings({ limitRate: r.v })}
                                                className={cn("px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border",
                                                    settings.limitRate === r.v ? "bg-white text-black border-white" : "bg-black/40 border-white/10 text-white/40 hover:border-white/30")}>
                                                {r.l}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-white/5 text-center">
                                <p className="text-[10px] text-white/20 uppercase tracking-widest">Nova Video Studio • v1.0</p>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Header */}
            <header className="flex h-16 items-center justify-between border-b border-white/5 bg-white/5 px-6 backdrop-blur-xl z-50">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl overflow-hidden shadow-[0_0_20px_rgba(99,102,241,0.4)]">
                        <img src="/logo.svg" alt="Nova" className="w-full h-full" />
                    </div>
                    <h1 className="text-2xl font-bold tracking-tighter font-['Righteous'] text-white">NOVA VIDEO STUDIO</h1>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-xs font-mono text-white/40 bg-white/5 px-3 py-1 rounded-full uppercase tracking-widest">
                        {globalStatus || 'System Ready'}
                    </div>
                    <button onClick={() => setShowSettings(true)} className="rounded-full p-2 hover:bg-white/10 transition-all group">
                        <Settings className="h-5 w-5 text-white/40 group-hover:text-white transition-all" />
                    </button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <nav className="w-20 lg:w-64 border-r border-white/5 bg-black/40 flex flex-col p-4 gap-2">
                    {tabs.map((tab) => {
                        const Icon = tab.icon
                        return (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                                className={cn("flex items-center gap-4 rounded-xl px-4 py-4 transition-all duration-300 group",
                                    activeTab === tab.id ? "bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.15)]"
                                        : "text-white/40 hover:bg-white/5 hover:text-white")}>
                                <Icon className={cn("h-6 w-6 group-hover:scale-110 transition-transform", activeTab === tab.id ? "text-black" : "text-white/40")} />
                                <span className="font-bold uppercase tracking-widest text-xs hidden lg:block">{tab.name}</span>
                            </button>
                        )
                    })}
                    <div className="mt-auto p-4 hidden lg:block">
                        <div className="p-4 rounded-2xl bg-gradient-to-br from-white/10 to-transparent border border-white/10">
                            <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-1">FFmpeg + yt-dlp</p>
                            <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden mb-2">
                                <div className="h-full w-full bg-gradient-to-r from-blue-500 to-purple-500 animate-pulse" />
                            </div>
                            <p className="text-[10px] text-white/40 italic">Max {settings.maxConcurrent} parallel</p>
                        </div>
                    </div>
                </nav>

                {/* Main */}
                <main className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05),transparent)]">
                    <AnimatePresence mode="wait">
                        <motion.div key={activeTab}
                            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                            className="h-full p-8 lg:p-12 max-w-6xl mx-auto flex flex-col">

                            {/* ═══ DOWNLOADER ═══ */}
                            {activeTab === 'download' && (
                                <div className="space-y-8 flex-1 flex flex-col">
                                    {/* Header */}
                                    <div className="flex justify-between items-end">
                                        <div className="space-y-2">
                                            <h2 className="text-4xl font-black font-['Righteous'] uppercase italic tracking-tighter">Download Engine</h2>
                                            <p className="text-white/40 font-medium text-sm">Paste links, drag & drop, or auto-detect from clipboard.</p>
                                        </div>
                                        <div className="flex gap-2">
                                            {hasActive && (<>
                                                <button onClick={pauseAll} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-orange-500/20 text-orange-400 hover:bg-orange-500/10 transition-all text-[10px] font-bold uppercase tracking-widest">
                                                    <Pause className="h-3 w-3" /> Pause All
                                                </button>
                                                <button onClick={cancelAll} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all text-[10px] font-bold uppercase tracking-widest">
                                                    <StopCircle className="h-3 w-3" /> Stop All
                                                </button>
                                            </>)}
                                            {queue.length > 0 && (<>
                                                <button onClick={() => setQueue([])} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 transition-all text-[10px] font-bold uppercase tracking-widest">
                                                    <Trash2 className="h-3 w-3" /> Clear
                                                </button>
                                                <button onClick={startAllDownloads} className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-white text-black hover:bg-white/90 transition-all text-[10px] font-bold uppercase tracking-widest shadow-xl">
                                                    <Zap className="h-3 w-3" /> Start All
                                                </button>
                                            </>)}
                                        </div>
                                    </div>

                                    {/* Settings bar */}
                                    <div className="flex flex-wrap gap-3 items-center bg-white/5 border border-white/10 p-3 rounded-2xl">
                                        <div className="flex items-center gap-3 bg-black/40 border border-white/10 px-4 py-2 rounded-xl flex-1 group hover:border-white/30 transition-all cursor-pointer" onClick={handleSelectFolder}>
                                            <Folder className="h-4 w-4 text-white/40 group-hover:text-white" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Save to</p>
                                                <p className="text-xs text-white/60 truncate font-mono">{downloadDir || 'Default Downloads'}</p>
                                            </div>
                                        </div>
                                        <div className="relative">
                                            <select value={selectedFormat} onChange={(e) => setSelectedFormat(e.target.value)}
                                                className="appearance-none bg-black/40 border border-white/10 px-5 py-2.5 pr-9 rounded-xl text-[10px] font-bold uppercase tracking-widest outline-none focus:border-white/30 cursor-pointer">
                                                <option value="mp4">MP4</option><option value="mkv">MKV</option><option value="mp3">MP3</option>
                                            </select>
                                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3 w-3 text-white/40 pointer-events-none" />
                                        </div>
                                        <div className="relative">
                                            <select value={selectedQuality} onChange={(e) => setSelectedQuality(e.target.value)}
                                                className="appearance-none bg-black/40 border border-white/10 px-5 py-2.5 pr-9 rounded-xl text-[10px] font-bold uppercase tracking-widest outline-none focus:border-white/30 cursor-pointer">
                                                <option value="best">Best</option><option value="1080">1080p</option><option value="720">720p</option>
                                                <option value="480">480p</option><option value="360">360p</option>
                                            </select>
                                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3 w-3 text-white/40 pointer-events-none" />
                                        </div>
                                        {settings.limitRate !== '0' && (
                                            <div className="flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/20 px-3 py-2 rounded-xl">
                                                <Gauge className="h-3 w-3 text-orange-400" />
                                                <span className="text-[10px] font-bold text-orange-400 uppercase">{settings.limitRate}/s</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Input */}
                                    <div className="bg-white/5 rounded-2xl p-4 border border-white/10 flex gap-3">
                                        <textarea ref={textareaRef} placeholder="Paste video links or playlist URLs here (one per line)..." value={inputUrls} onChange={(e) => setInputUrls(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); handleAddLinks() } }}
                                            className="flex-1 bg-black/40 border border-white/10 rounded-xl p-3 min-h-[70px] outline-none focus:border-white/30 resize-none placeholder:text-white/20 text-sm" />
                                        <div className="flex flex-col gap-2">
                                            <button onClick={handleAddLinks}
                                                className="flex flex-col items-center justify-center gap-1 px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all group flex-1">
                                                <Plus className="h-4 w-4 text-white group-hover:scale-125 transition-transform" />
                                                <span className="text-[8px] font-bold uppercase tracking-widest">Add</span>
                                            </button>
                                            <button onClick={handleImportTxt}
                                                className="flex flex-col items-center justify-center gap-1 px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all group flex-1" title="Import URLs from .txt file">
                                                <Upload className="h-4 w-4 text-white/60 group-hover:text-white group-hover:scale-125 transition-all" />
                                                <span className="text-[8px] font-bold uppercase tracking-widest text-white/60 group-hover:text-white">.txt</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Queue */}
                                    <div className="flex-1 space-y-2">
                                        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white/40 px-2">Tasks ({queue.length})</h3>
                                        <AnimatePresence initial={false}>
                                            {queue.length === 0 ? (
                                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-14 text-white/20">
                                                    <FileText className="h-10 w-10 mb-3 opacity-10" />
                                                    <p className="text-sm font-bold uppercase tracking-widest">Queue is empty</p>
                                                    <p className="text-[10px] mt-1 text-white/10">Ctrl+V to paste • Drag & Drop supported</p>
                                                </motion.div>
                                            ) : queue.map((item) => (
                                                <motion.div key={item.id} layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -50 }}
                                                    className="bg-white/5 border border-white/10 rounded-2xl p-4 flex gap-5 group hover:border-white/20 transition-all">
                                                    {/* Thumbnail */}
                                                    <div className="w-32 aspect-video rounded-xl overflow-hidden bg-black/50 flex-shrink-0 relative border border-white/5">
                                                        {item.thumbnail ? <img src={item.thumbnail} alt="" className="w-full h-full object-cover" /> :
                                                            <div className="w-full h-full flex items-center justify-center"><div className="w-5 h-5 rounded-full border-2 border-white/20 border-t-white animate-spin" /></div>}
                                                        <div className="absolute bottom-1 right-1 bg-black/80 px-1.5 py-0.5 rounded text-[9px] font-bold">{item.duration || '--:--'}</div>
                                                    </div>
                                                    {/* Content */}
                                                    <div className="flex-1 flex flex-col justify-between min-w-0">
                                                        <div>
                                                            <div className="flex justify-between gap-3">
                                                                <input className="font-bold text-sm bg-transparent border-b border-transparent focus:border-white/20 outline-none w-full truncate"
                                                                    value={item.customName} onChange={(e) => setQueue(prev => prev.map(i => i.id === item.id ? { ...i, customName: e.target.value } : i))}
                                                                    placeholder="Filename..." />
                                                                <button onClick={() => setQueue(prev => prev.filter(i => i.id !== item.id))} className="text-white/20 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                                                            </div>
                                                            <p className="text-[10px] text-white/25 truncate mt-0.5">{item.uploader}{item.uploader ? ' • ' : ''}{item.url}</p>
                                                        </div>
                                                        <div className="flex items-center gap-3 mt-2">
                                                            <div className="flex-1">
                                                                <p className={cn("text-[10px] font-bold uppercase tracking-wider mb-1",
                                                                    item.status === 'completed' ? 'text-green-500' : item.status === 'failed' ? 'text-red-500' :
                                                                        item.status === 'cancelled' ? 'text-yellow-500' : item.status === 'paused' ? 'text-orange-400' :
                                                                            item.status === 'downloading' ? 'text-blue-400' : 'text-white/40')}>
                                                                    {getStatusDisplay(item)}
                                                                </p>
                                                                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                                                    <motion.div className={cn("h-full",
                                                                        item.status === 'completed' ? 'bg-green-500' : item.status === 'paused' ? 'bg-orange-400' :
                                                                            item.status === 'downloading' ? 'bg-gradient-to-r from-blue-500 to-purple-500' : 'bg-white')}
                                                                        initial={{ width: 0 }} animate={{ width: `${item.progress}%` }} />
                                                                </div>
                                                            </div>
                                                            {/* Actions */}
                                                            {['idle', 'failed', 'cancelled'].includes(item.status) ? (
                                                                <button onClick={() => startDownload(item.id)} className="bg-white/10 hover:bg-white text-white hover:text-black px-3.5 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all">Start</button>
                                                            ) : item.status === 'paused' ? (
                                                                <div className="flex gap-1.5">
                                                                    <button onClick={() => startDownload(item.id)} className="bg-green-500/10 hover:bg-green-500 text-green-500 hover:text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center gap-1">
                                                                        <RotateCcw className="h-3 w-3" /> Resume
                                                                    </button>
                                                                    <button onClick={() => cancelDownload(item.id)} className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white px-2 py-1.5 rounded-lg transition-all"><XCircle className="h-3 w-3" /></button>
                                                                </div>
                                                            ) : item.status === 'completed' ? (
                                                                <div className="flex items-center gap-1.5">
                                                                    <button onClick={() => openFolder(item.outputDir || downloadDir)} className="bg-white/5 hover:bg-white/10 text-white/40 hover:text-white px-2 py-1.5 rounded-lg transition-all" title="Open folder">
                                                                        <FolderOpen className="h-3.5 w-3.5" />
                                                                    </button>
                                                                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                                                                </div>
                                                            ) : (item.status === 'downloading' || item.status === 'queued') ? (
                                                                <div className="flex gap-1.5">
                                                                    <button onClick={() => pauseDownload(item.id)} className="bg-orange-500/10 hover:bg-orange-500 text-orange-400 hover:text-white px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center gap-1">
                                                                        <Pause className="h-3 w-3" /> Pause
                                                                    </button>
                                                                    <button onClick={() => cancelDownload(item.id)} className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white px-2 py-1.5 rounded-lg transition-all"><XCircle className="h-3 w-3" /></button>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            ))}
                                        </AnimatePresence>
                                    </div>

                                    {/* History */}
                                    {history.length > 0 && (
                                        <div className="space-y-2 border-t border-white/5 pt-5">
                                            <div className="flex items-center justify-between px-2">
                                                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white/40 flex items-center gap-2"><Clock className="h-3 w-3" /> History ({history.length})</h3>
                                                <button onClick={() => { setHistory([]); saveHistory([]) }} className="text-[10px] text-white/20 hover:text-white/50 uppercase tracking-widest">Clear</button>
                                            </div>
                                            <div className="space-y-0.5 max-h-32 overflow-y-auto">
                                                {history.slice(0, 20).map((h, i) => (
                                                    <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-all">
                                                        <CheckCircle2 className="h-3 w-3 text-green-500/50 flex-shrink-0" />
                                                        <span className="flex-1 text-xs text-white/40 truncate">{h.name}</span>
                                                        <span className="text-[9px] text-white/20 uppercase">{h.format}</span>
                                                        <span className="text-[9px] text-white/15">{h.date}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ═══ MERGER ═══ */}
                            {activeTab === 'process' && (
                                <div className="space-y-8 flex-1 flex flex-col">
                                    <div className="space-y-2">
                                        <h2 className="text-4xl font-black font-['Righteous'] uppercase italic tracking-tighter">Video Forge</h2>
                                        <p className="text-white/40 font-medium text-sm">Merge multiple videos into one. Stream copy (no re-encoding).</p>
                                    </div>
                                    <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">Files ({mergeFiles.length})</h3>
                                            <button onClick={handleAddMergeFiles} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest transition-all">
                                                <FilePlus className="h-4 w-4" /> Add Files
                                            </button>
                                        </div>
                                        {mergeFiles.length === 0 ? (
                                            <div className="py-10 text-center text-white/20">
                                                <FilePlus className="h-8 w-8 mx-auto mb-2 opacity-20" />
                                                <p className="text-sm font-bold uppercase tracking-widest">Add at least 2 files</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-1.5">
                                                {mergeFiles.map((file, idx) => (
                                                    <div key={idx} className="flex items-center gap-3 bg-black/30 border border-white/5 rounded-xl p-2.5">
                                                        <span className="text-white/30 font-bold text-xs w-5 text-center">{idx + 1}</span>
                                                        <span className="flex-1 text-xs text-white/50 truncate font-mono">{file.split('\\').pop()}</span>
                                                        <button onClick={() => setMergeFiles(prev => prev.filter((_, i) => i !== idx))} className="text-white/20 hover:text-red-500"><X className="h-3 w-3" /></button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-3 items-end">
                                        <div className="flex-1">
                                            <label className="text-[10px] font-bold uppercase tracking-widest text-white/30 block mb-1.5">Output Name</label>
                                            <input value={mergeName} onChange={(e) => setMergeName(e.target.value)} placeholder="merged_video"
                                                className="w-full bg-black/40 border border-white/10 rounded-xl p-3 outline-none text-sm focus:border-white/30" />
                                        </div>
                                        <button onClick={handleMerge} disabled={mergeFiles.length < 2 || isMerging}
                                            className={cn("px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2",
                                                mergeFiles.length < 2 || isMerging ? "bg-white/5 text-white/20 cursor-not-allowed" : "bg-white text-black hover:bg-white/90 shadow-xl")}>
                                            {isMerging ? <><div className="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin" /> Processing...</>
                                                : <><Scissors className="h-4 w-4" /> Merge</>}
                                        </button>
                                    </div>
                                    {mergeStatus && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white/60 font-mono">{mergeStatus}</motion.div>}
                                </div>
                            )}

                            {/* ═══ CONVERTER ═══ */}
                            {activeTab === 'convert' && (
                                <div className="space-y-8 flex-1 flex flex-col">
                                    <div className="space-y-2">
                                        <h2 className="text-4xl font-black font-['Righteous'] uppercase italic tracking-tighter">Studio Converter</h2>
                                        <p className="text-white/40 font-medium text-sm">Convert video/audio files between formats.</p>
                                    </div>
                                    <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-4">
                                        <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">Input File</h3>
                                        {convertFile ? (
                                            <div className="flex items-center gap-3 bg-black/30 border border-white/5 rounded-xl p-3">
                                                <FileText className="h-5 w-5 text-white/40" />
                                                <span className="flex-1 text-sm text-white/60 truncate font-mono">{convertFile.split('\\').pop()}</span>
                                                <button onClick={() => setConvertFile('')} className="text-white/20 hover:text-red-500"><X className="h-4 w-4" /></button>
                                            </div>
                                        ) : (
                                            <button onClick={handleSelectConvertFile}
                                                className="w-full py-10 border-2 border-dashed border-white/10 rounded-xl text-center hover:border-white/30 transition-all group">
                                                <FilePlus className="h-8 w-8 mx-auto mb-2 text-white/20 group-hover:text-white/40" />
                                                <p className="text-sm font-bold uppercase tracking-widest text-white/20 group-hover:text-white/40">Select file</p>
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex gap-3 items-end">
                                        <div className="flex-1">
                                            <label className="text-[10px] font-bold uppercase tracking-widest text-white/30 block mb-1.5">Output Format</label>
                                            <div className="flex gap-2">
                                                {['mp4', 'mkv', 'mp3', 'gif'].map(fmt => (
                                                    <button key={fmt} onClick={() => setConvertFormat(fmt)}
                                                        className={cn("px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border",
                                                            convertFormat === fmt ? "bg-white text-black border-white" : "bg-black/40 border-white/10 text-white/40 hover:border-white/30")}>
                                                        {fmt}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <button onClick={handleConvert} disabled={!convertFile || isConverting}
                                            className={cn("px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2",
                                                !convertFile || isConverting ? "bg-white/5 text-white/20 cursor-not-allowed" : "bg-white text-black hover:bg-white/90 shadow-xl")}>
                                            {isConverting ? <><div className="w-3 h-3 border-2 border-black/20 border-t-black rounded-full animate-spin" /> Converting...</>
                                                : <><RefreshCw className="h-4 w-4" /> Convert</>}
                                        </button>
                                    </div>
                                    {convertStatus && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white/60 font-mono">{convertStatus}</motion.div>}
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </main>
            </div>

            {/* Clipboard Toast */}
            <AnimatePresence>
                {clipboardToast && (
                    <motion.div initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 100 }}
                        className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white/10 border border-white/20 backdrop-blur-2xl p-3 px-5 rounded-2xl flex items-center gap-3 z-[100] max-w-lg">
                        <Clipboard className="h-4 w-4 text-blue-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-bold text-white uppercase tracking-widest">URL Detected</p>
                            <p className="text-[9px] text-white/40 truncate font-mono">{clipboardToast}</p>
                        </div>
                        <button onClick={handleAddFromClipboard} className="bg-white text-black px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase hover:bg-white/90 transition-all">Add</button>
                        <button onClick={() => setClipboardToast(null)} className="text-white/30 hover:text-white/60 transition-all">✕</button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Error Toast */}
            <AnimatePresence>
                {queue.some(i => i.status === 'failed') && !clipboardToast && (
                    <motion.div initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 100 }}
                        className="fixed bottom-6 right-6 bg-red-500/10 border border-red-500/20 backdrop-blur-xl p-3 rounded-xl flex items-center gap-3 z-[100]">
                        <AlertCircle className="h-5 w-5 text-red-500" />
                        <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Error in queue</p>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Noise */}
            <div className="pointer-events-none fixed inset-0 z-10 opacity-10 mix-blend-overlay">
                <svg viewBox="0 0 200 200"><filter id="noise"><feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" /></filter><rect width="100%" height="100%" filter="url(#noise)" /></svg>
            </div>
        </div>
    )
}
