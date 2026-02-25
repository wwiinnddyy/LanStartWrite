import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ElectrobunConfig } from 'electrobun'

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
  version?: unknown
}

export default {
  app: {
    name: 'LanStartWrite',
    identifier: 'com.lanstart.write',
    version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    urlSchemes: ['lanstartwrite']
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts'
    },
    ...({
      watchIgnore: ['dist/**', 'out/**', 'build/**']
    } as any),
    copy: {
      dist: 'views/mainview',
      out: 'out'
    },
    mac: {
      bundleCEF: true,
      defaultRenderer: 'cef'
    },
    win: {
      bundleCEF: true,
      defaultRenderer: 'cef',
      icon: 'iconpack/LanStartWrite_old.ico'
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: 'cef',
      icon: 'iconpack/LanStartWrite.png'
    }
  },
  runtime: {
    exitOnLastWindowClosed: true
  }
} satisfies ElectrobunConfig
