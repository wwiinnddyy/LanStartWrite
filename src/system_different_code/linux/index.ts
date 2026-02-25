import type { ForegroundWindowSample, ProcessSample, TaskWatcherAdapter } from '../../task_windows_watcher/types'

async function runCommand(cmd: string[], timeoutMs = 1400): Promise<{ stdout: string; code: number }> {
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

  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
  clearTimeout(timeout)
  return { stdout, code: Number.isFinite(exitCode) ? Number(exitCode) : 1 }
}

export async function getProcessesLinux(): Promise<ProcessSample[]> {
  const res = await runCommand(['ps', '-eo', 'pid=,comm=,%cpu=,rss='], 1600)
  const lines = res.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const out: ProcessSample[] = []
  for (const line of lines) {
    const parts = line.split(/\s+/)
    if (parts.length < 4) continue
    const pid = Number(parts[0])
    const name = String(parts[1] ?? '')
    const cpuPercent = Number(parts[2])
    const rssKb = Number(parts[3])
    if (!Number.isFinite(pid) || pid <= 0 || !name) continue
    out.push({
      pid,
      name,
      cpuPercent: Number.isFinite(cpuPercent) ? Math.max(0, cpuPercent) : undefined,
      memoryBytes: Number.isFinite(rssKb) ? Math.max(0, rssKb) * 1024 : undefined
    })
  }

  return out
}

function parseXpropValue(text: string): string {
  const idx = text.indexOf('=')
  if (idx < 0) return ''
  return text.slice(idx + 1).trim()
}

export async function getForegroundWindowLinux(): Promise<ForegroundWindowSample | undefined> {
  const active = await runCommand(['xprop', '-root', '_NET_ACTIVE_WINDOW'], 900).catch(() => undefined)
  if (!active || active.code !== 0) return undefined
  const raw = parseXpropValue(active.stdout)
  const match = raw.match(/0x[0-9a-fA-F]+/)
  const winId = match?.[0]
  if (!winId) return undefined

  const nameRes = await runCommand(['xprop', '-id', winId, '_NET_WM_NAME'], 900).catch(() => undefined)
  const pidRes = await runCommand(['xprop', '-id', winId, '_NET_WM_PID'], 900).catch(() => undefined)

  const titleLine = nameRes?.stdout ?? ''
  const titleMatch = titleLine.match(/=\s*(?:"([^"]*)"|(.+))$/)
  const title = (titleMatch?.[1] ?? titleMatch?.[2] ?? '').trim()
  if (!title) return undefined

  let pid: number | undefined
  if (pidRes?.stdout) {
    const pidMatch = pidRes.stdout.match(/=\s*(\d+)/)
    const value = pidMatch ? Number(pidMatch[1]) : NaN
    pid = Number.isFinite(value) ? value : undefined
  }

  return { pid, title, handle: winId }
}

export function createLinuxAdapter(): TaskWatcherAdapter {
  return {
    getProcesses: getProcessesLinux,
    getForegroundWindow: getForegroundWindowLinux
  }
}

export async function forceTopmostWindowsLinux(_hwnds: bigint[]): Promise<void> {
  return
}
