import vue from '@vitejs/plugin-vue'
import { dirname, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'

const host = env.TAURI_DEV_HOST
const configDir = dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), UnoCSS()],
  resolve: {
    alias: {
      '@': resolve(configDir, 'src'),
    },
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}))
