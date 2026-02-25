import type { ForegroundWindowSample, ProcessSample, TaskWatcherAdapter } from '../../task_windows_watcher/types'

async function runCommand(cmd: string[], timeoutMs = 1400): Promise<string> {
  const proc = Bun.spawn({
    cmd,
    stdout: 'pipe',
    stderr: 'pipe'
  })

  const timeout = setTimeout(() => {
    try {
      proc.kill()
    } catch {}
  }, timeoutMs)

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])

  clearTimeout(timeout)
  if (exitCode !== 0 && !stdout.trim()) throw new Error(stderr.trim() || `command_exit_${exitCode}`)
  return stdout
}

export async function getProcessesDarwin(): Promise<ProcessSample[]> {
  const out = await runCommand(['ps', '-axo', 'pid=,comm=,%cpu=,rss='], 1600)
  const lines = out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const result: ProcessSample[] = []
  for (const line of lines) {
    const parts = line.split(/\s+/)
    if (parts.length < 4) continue
    const pid = Number(parts[0])
    const name = String(parts[1] ?? '')
    const cpuPercent = Number(parts[2])
    const rssKb = Number(parts[3])
    if (!Number.isFinite(pid) || pid <= 0 || !name) continue
    result.push({
      pid,
      name,
      cpuPercent: Number.isFinite(cpuPercent) ? Math.max(0, cpuPercent) : undefined,
      memoryBytes: Number.isFinite(rssKb) ? Math.max(0, rssKb) * 1024 : undefined
    })
  }

  return result
}

export async function getForegroundWindowDarwin(): Promise<ForegroundWindowSample | undefined> {
  const script = [
    'tell application "System Events"',
    '  set frontApp to first application process whose frontmost is true',
    '  set appName to name of frontApp',
    '  set pidValue to unix id of frontApp',
    '  set winTitle to ""',
    '  try',
    '    set winTitle to name of front window of frontApp',
    '  end try',
    '  return pidValue & "\\t" & appName & "\\t" & winTitle',
    'end tell'
  ].join('\n')

  const out = await runCommand(['osascript', '-e', script], 1400)
  const trimmed = out.trim()
  if (!trimmed) return undefined

  const [pidRaw, appNameRaw, winTitleRaw] = trimmed.split('\t')
  const pid = Number(pidRaw)
  const processName = appNameRaw ? String(appNameRaw) : undefined
  const title = winTitleRaw ? String(winTitleRaw) : processName ? processName : ''
  if (!title) return undefined

  return {
    pid: Number.isFinite(pid) ? pid : undefined,
    processName,
    title
  }
}

export function createDarwinAdapter(): TaskWatcherAdapter {
  return {
    getProcesses: getProcessesDarwin,
    getForegroundWindow: getForegroundWindowDarwin
  }
}

export async function forceTopmostWindowsDarwin(_hwnds: bigint[]): Promise<void> {
  return
}
