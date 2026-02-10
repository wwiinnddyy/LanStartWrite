import { appendFileSync, readFileSync } from 'node:fs'

function setOutput(key, value) {
  const out = process.env.GITHUB_OUTPUT
  if (!out) throw new Error('GITHUB_OUTPUT is not set')
  appendFileSync(out, `${key}=${value}\n`)
}

function readPackageVersion() {
  const raw = readFileSync('package.json', 'utf-8')
  const pkg = JSON.parse(raw)
  return typeof pkg?.version === 'string' ? pkg.version : '0.0.0'
}

const messageRaw = String(process.env.RELEASE_MESSAGE ?? '').trim()
const tokens = messageRaw.split(/\s+/).filter(Boolean)

const versionToken =
  tokens.find((t) => /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(t)) ?? ''

const buildToken = tokens.find((t) => /^build:[a-zA-Z0-9_-]+$/.test(t)) ?? ''

const baseVersion = readPackageVersion()
const runNumber = String(process.env.GITHUB_RUN_NUMBER ?? '').trim() || '0'

const version = versionToken ? (versionToken.startsWith('v') ? versionToken.slice(1) : versionToken) : `${baseVersion}-dev.${runNumber}`
const buildScript = buildToken || 'build:win'

const buildKind = buildScript.replace(/^build:/, '')
const runWin = buildKind === 'win' || buildKind === 'all'
const runMac = buildKind === 'mac' || buildKind === 'all'
const runLinux = buildKind === 'linux' || buildKind === 'all'

setOutput('version', version)
setOutput('tag', '')
setOutput('build_script', buildScript)
setOutput('run_win', runWin ? 'true' : 'false')
setOutput('run_mac', runMac ? 'true' : 'false')
setOutput('run_linux', runLinux ? 'true' : 'false')
setOutput('run_unpack', 'false')

