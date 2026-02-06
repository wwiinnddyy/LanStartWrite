import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import autoprefixer from 'autoprefixer'
import tailwindcss from 'tailwindcss'
import { defineConfig } from 'electron-vite'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    define: {
      '__APP_VERSION__': JSON.stringify(pkg.version)
    },
    css: {
      postcss: {
        plugins: [
          tailwindcss({ config: resolve(__dirname, 'src/Tailwind/tailwind.config.cjs') }),
          autoprefixer()
        ]
      }
    },
    server: {
      fs: {
        allow: [resolve(__dirname, 'src')]
      }
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer')
    }
  }
})
