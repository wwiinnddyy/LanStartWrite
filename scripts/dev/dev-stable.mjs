import { getLanstartRuntimeEnv, printLanstartRuntimeEnv } from './runtime-env.mjs'

const cwd = process.cwd()
const bunBin = process.execPath && /(^|[\\/])bun(\.exe)?$/i.test(process.execPath) ? process.execPath : (Bun.which('bun') || 'bun')
const bunxBin = Bun.which('bunx') || 'bunx'

function runStep(name, cmd) {
  console.log(`[dev] ${name}: ${cmd.join(' ')}`)
  const result = Bun.spawnSync({
    cmd,
    cwd,
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit'
  })

  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : 1
  if (exitCode !== 0) process.exit(exitCode)
}

runStep('build:webview', [bunBin, 'run', 'build:webview'])
runStep('build:backend', [bunBin, 'run', 'build:backend'])

const runtimeEnv = getLanstartRuntimeEnv(process.env)
printLanstartRuntimeEnv(runtimeEnv)

const child = Bun.spawn({
  cmd: [bunxBin, 'electrobun', 'dev'],
  cwd,
  env: runtimeEnv,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit'
})

let stopping = false

async function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  try {
    child.kill()
  } catch {}
  await child.exited.catch(() => undefined)
  process.exit(exitCode)
}

process.on('SIGINT', () => {
  void stop(0)
})

process.on('SIGTERM', () => {
  void stop(0)
})

const code = await child.exited
process.exit(typeof code === 'number' ? code : 1)
