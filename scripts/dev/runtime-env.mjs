import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(scriptDir, '..', '..')

function resolveFirstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {}
  }
  return undefined
}

function resolveBackendEntry() {
  const candidates = [
    join(repoRoot, 'src', 'elysia', 'index.ts'),
    join(repoRoot, 'out', 'elysia', 'index.js')
  ]
  return resolveFirstExisting(candidates)
}

function resolveCapabilityWorkerEntry() {
  const candidates = [
    join(repoRoot, 'src', 'system', 'capabilities', 'winapi', 'winapi.worker.ts'),
    join(repoRoot, 'out', 'system', 'capabilities', 'winapi', 'winapi.worker.js')
  ]
  return resolveFirstExisting(candidates)
}

export function getLanstartRuntimeEnv(baseEnv = process.env) {
  const env = {
    ...baseEnv,
    LANSTART_BACKEND_CWD: repoRoot
  }

  const backendEntry = resolveBackendEntry()
  if (backendEntry) env.LANSTART_BACKEND_ENTRY = backendEntry

  const capabilityWorkerEntry = resolveCapabilityWorkerEntry()
  if (capabilityWorkerEntry) env.LANSTART_CAPABILITY_WORKER_ENTRY = capabilityWorkerEntry

  return env
}

export function printLanstartRuntimeEnv(env = getLanstartRuntimeEnv()) {
  console.log('[dev:runtime-env]', {
    LANSTART_BACKEND_CWD: env.LANSTART_BACKEND_CWD,
    LANSTART_BACKEND_ENTRY: env.LANSTART_BACKEND_ENTRY,
    LANSTART_CAPABILITY_WORKER_ENTRY: env.LANSTART_CAPABILITY_WORKER_ENTRY
  })
}

if (import.meta.main) {
  printLanstartRuntimeEnv()
}
