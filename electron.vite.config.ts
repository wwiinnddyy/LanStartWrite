import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import autoprefixer from 'autoprefixer'
import tailwindcss from 'tailwindcss'
import { defineConfig } from 'electron-vite'

const rootDir = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8')) as { version?: unknown }

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(rootDir, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(rootDir, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(rootDir, 'src/renderer'),
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0')
    },
    css: {
      postcss: {
        plugins: [tailwindcss({ config: resolve(rootDir, 'src/Tailwind/tailwind.config.cjs') }), autoprefixer()]
      }
    },
    server: {
      fs: {
        allow: [resolve(rootDir, 'src')]
      }
    },
    build: {
      outDir: resolve(rootDir, 'out/renderer')
    }
  }
})
