import { defineConfig } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react-swc'
import electron from 'vite-plugin-electron/simple'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        electron({
            main: {
                entry: 'electron/main.ts',
            },
            preload: {
                input: path.join(__dirname, 'electron/preload.ts'),
            },
            renderer: {},
        }),
    ],
    server: {
        watch: {
            // CRITICAL: Ignore ALL non-source files to prevent reload loops.
            // When yt-dlp downloads, it creates .part/.ytdl files. 
            // If these are in the project directory, Vite sees them as changes
            // and reloads the entire app, killing the download process.
            ignored: [
                '**/bin/**',
                '**/node_modules/**',
                '**/dist/**',
                '**/dist-electron/**',
                '**/*.mp4',
                '**/*.mkv',
                '**/*.webm',
                '**/*.mp3',
                '**/*.m4a',
                '**/*.ytdl',
                '**/*.part',
                '**/*.part-Frag*',
                '**/*.temp',
                '**/*.tmp',
                '**/*.aria2',
            ],
        },
    }
})
