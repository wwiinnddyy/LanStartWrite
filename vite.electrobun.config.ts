import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import autoprefixer from 'autoprefixer'
import tailwindcss from 'tailwindcss'
import { defineConfig } from 'vite'

const rootDir = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8')) as { version?: unknown; lanstartCodename?: unknown }

export default defineConfig({
  root: resolve(rootDir, 'src/renderer'),
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
    __APP_CODENAME__: JSON.stringify(typeof pkg.lanstartCodename === 'string' ? pkg.lanstartCodename : 'Doctor')
  },
  css: {
    postcss: {
      plugins: [tailwindcss({ config: resolve(rootDir, 'src/Tailwind/tailwind.config.cjs') }), autoprefixer()]
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [resolve(rootDir, 'src')]
    }
  },
  build: {
    outDir: resolve(rootDir, 'dist'),
    emptyOutDir: true
  }
})
