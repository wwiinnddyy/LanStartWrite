import { spawn } from 'node:child_process'
import type { ForegroundWindowSample, ProcessSample, TaskWatcherAdapter } from '../../task_windows_watcher/types'

function runCommand(cmd: string, args: string[], timeoutMs = 1400): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {}
      reject(new Error('command_timeout'))
    }, timeoutMs)
    proc.stdout.on('data', (c) => {
      stdout += String(c)
    })
    proc.stderr.on('data', (c) => {
      stderr += String(c)
    })
    proc.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !stdout.trim()) reject(new Error(stderr.trim() || `command_exit_${code ?? 'unknown'}`))
      resolve(stdout)
    })
  })
}

export async function getProcessesDarwin(): Promise<ProcessSample[]> {
  const out = await runCommand('ps', ['-axo', 'pid=,comm=,%cpu=,rss='], 1600)
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const res: ProcessSample[] = []
  for (const line of lines) {
    const parts = line.split(/\s+/)
    if (parts.length < 4) continue
    const pid = Number(parts[0])
    const name = parts[1] || ''
    const cpuPercent = Number(parts[2])
    const rssKb = Number(parts[3])
    if (!Number.isFinite(pid) || pid <= 0 || !name) continue
    res.push({
      pid,
      name,
      cpuPercent: Number.isFinite(cpuPercent) ? Math.max(0, cpuPercent) : undefined,
      memoryBytes: Number.isFinite(rssKb) ? Math.max(0, rssKb) * 1024 : undefined
    })
  }
  return res
}

export async function getForegroundWindowDarwin(): Promise<ForegroundWindowSample | undefined> {
  const script = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set pidValue to unix id of frontApp
  set winTitle to ""
  try
    set winTitle to name of front window of frontApp
  end try
  return pidValue & "\t" & appName & "\t" & winTitle
end tell
`
  const out = await runCommand('osascript', ['-e', script], 1400)
  const trimmed = out.trim()
  if (!trimmed) return undefined
  const [pidRaw, appNameRaw, winTitleRaw] = trimmed.split('\t')
  const pid = Number(pidRaw)
  const processName = appNameRaw ? String(appNameRaw) : undefined
  const title = winTitleRaw ? String(winTitleRaw) : processName ? processName : ''
  if (!title) return undefined
  return { pid: Number.isFinite(pid) ? pid : undefined, processName, title }
}

export function createDarwinAdapter(): TaskWatcherAdapter {
  return { getProcesses: getProcessesDarwin, getForegroundWindow: getForegroundWindowDarwin }
}

