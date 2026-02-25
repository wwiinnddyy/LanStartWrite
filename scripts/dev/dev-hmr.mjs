import { getLanstartRuntimeEnv, printLanstartRuntimeEnv } from './runtime-env.mjs'

const cwd = process.cwd()
const bunx = Bun.which('bunx') || 'bunx'
const children = []
let stopping = false

function spawnManaged(name, cmd, env = process.env) {
  const child = Bun.spawn({
    cmd,
    cwd,
    env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit'
  })
  children.push(child)
  console.log(`[dev:hmr] started ${name} pid=${child.pid}`)
  return child
}

async function stopAll(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    try {
      child.kill()
    } catch {}
  }
  await Promise.allSettled(children.map((child) => child.exited))
  process.exit(exitCode)
}

process.on('SIGINT', () => {
  void stopAll(0)
})

process.on('SIGTERM', () => {
  void stopAll(0)
})

const vite = spawnManaged('vite', [bunx, 'vite', '--config', 'vite.electrobun.config.ts', '--port', '5173', '--strictPort'])
await Bun.sleep(1_200)
const runtimeEnv = {
  ...getLanstartRuntimeEnv(process.env),
  LANSTART_WEBVIEW_DEV_URL: 'http://localhost:5173/'
}
printLanstartRuntimeEnv(runtimeEnv)
const electrobun = spawnManaged('electrobun', [bunx, 'electrobun', 'dev', '--watch'], runtimeEnv)

const first = await Promise.race([
  vite.exited.then((code) => ({ from: 'vite', code })),
  electrobun.exited.then((code) => ({ from: 'electrobun', code }))
])

const code = typeof first.code === 'number' ? first.code : 1
console.log(`[dev:hmr] ${first.from} exited with code ${code}, shutting down`)
await stopAll(code)
