import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

function runPowerShell(command) {
  return Bun.spawnSync({
    cmd: ['powershell', '-NoProfile', '-Command', command],
    stdout: 'pipe',
    stderr: 'pipe'
  })
}

if (process.platform === 'win32') {
  const killScript = [
    "$names = @('bun.exe','bun Helper.exe','bunx.exe','electrobun.exe','launcher.exe','node.exe','esbuild.exe')",
    "$self = $PID",
    "Get-CimInstance Win32_Process | Where-Object {",
    "  $cmd = [string]$_.CommandLine",
    "  ($names -contains $_.Name) -and ($_.ProcessId -ne $self) -and ($cmd -match 'LanStartWrite|LanStartWrite-dev|vite\\.electrobun\\.config|run dev|electrobun|build\\\\dev-win-x64') -and ($cmd -notmatch 'dev:clean-runtime|scripts/dev/clean-runtime.mjs')",
    "} | ForEach-Object {",
    "  try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}",
    "}"
  ].join('; ')

  const result = runPowerShell(killScript)
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr ?? new Uint8Array()).trim()
    if (stderr) console.error(`[dev:clean-runtime] process cleanup warning: ${stderr}`)
  }
} else {
  console.log('[dev:clean-runtime] non-win32 platform, skip process cleanup')
}

const cefDir = join(process.env.LOCALAPPDATA ?? '', 'com.lanstart.write', 'dev', 'CEF')
if (existsSync(cefDir)) {
  let removed = false
  try {
    rmSync(cefDir, { recursive: true, force: true })
    removed = !existsSync(cefDir)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`[dev:clean-runtime] fs cleanup warning: ${detail}`)
  }

  if (!removed && process.platform === 'win32') {
    const escaped = cefDir.replace(/\\/g, '\\\\')
    const removeScript = `if (Test-Path '${escaped}') { Remove-Item '${escaped}' -Recurse -Force -ErrorAction SilentlyContinue }`
    runPowerShell(removeScript)
    removed = !existsSync(cefDir)
  }

  if (removed) console.log(`[dev:clean-runtime] removed ${cefDir}`)
  else console.error(`[dev:clean-runtime] warning: unable to remove ${cefDir}`)
} else {
  console.log(`[dev:clean-runtime] skip missing ${cefDir}`)
}

console.log('[dev:clean-runtime] done')
