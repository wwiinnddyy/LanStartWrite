import { readFileSync, writeFileSync } from 'node:fs'

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v)
}

const rawArg = String(process.argv[2] ?? '').trim()
if (!rawArg) {
  process.stderr.write('Usage: node scripts/ci/apply-version.mjs <version>\n')
  process.exit(1)
}

const version = rawArg.startsWith('v') ? rawArg.slice(1) : rawArg
if (!isValidSemver(version)) {
  process.stderr.write(`Invalid version: ${version}\n`)
  process.exit(1)
}

const pkgText = readFileSync('package.json', 'utf-8')
const pkg = JSON.parse(pkgText)
pkg.version = version

writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8')

