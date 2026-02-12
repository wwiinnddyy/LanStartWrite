import { spawn } from 'node:child_process'
import type { ForegroundWindowSample, ProcessSample, TaskWatcherAdapter } from '../../task_windows_watcher/types'

function runPowerShellJson(script: string, timeoutMs = 1400): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {}
      reject(new Error('powershell_timeout'))
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
      if (code !== 0 && !stdout.trim()) reject(new Error(stderr.trim() || `powershell_exit_${code ?? 'unknown'}`))
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : undefined)
      } catch (e) {
        reject(new Error(`powershell_bad_json:${String(e)}`))
      }
    })
  })
}

function runPowerShell(script: string, timeoutMs = 1400): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })

    let stderr = ''

    const timer = setTimeout(() => {
      try {
        proc.kill()
      } catch {}
      reject(new Error('powershell_timeout'))
    }, timeoutMs)

    proc.stderr.on('data', (c) => {
      stderr += String(c)
    })
    proc.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(stderr.trim() || `powershell_exit_${code ?? 'unknown'}`))
      else resolve()
    })
  })
}

export async function getProcessesWindows(): Promise<ProcessSample[]> {
  const script =
    'Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Depth 3 -Compress'
  const data = await runPowerShellJson(script, 1800)
  const rows = Array.isArray(data) ? data : data ? [data] : []
  const out: ProcessSample[] = []
  for (const row of rows as any[]) {
    const pid = Number(row?.Id)
    const name = typeof row?.ProcessName === 'string' ? row.ProcessName : ''
    const cpuSeconds = Number(row?.CPU)
    const workingSet = Number(row?.WorkingSet64)
    if (!Number.isFinite(pid) || pid <= 0 || !name) continue
    out.push({
      pid,
      name,
      cpuTimeMs: Number.isFinite(cpuSeconds) ? Math.max(0, cpuSeconds) * 1000 : undefined,
      memoryBytes: Number.isFinite(workingSet) ? Math.max(0, workingSet) : undefined
    })
  }
  return out
}

export async function getForegroundWindowWindows(): Promise<ForegroundWindowSample | undefined> {
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class LanStartWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
$hwnd = [LanStartWin32]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { return }
$sb = New-Object System.Text.StringBuilder 1024
[LanStartWin32]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
$pid = 0
[LanStartWin32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
$rect = New-Object LanStartWin32+RECT
[LanStartWin32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$pname = ""
try { $pname = (Get-Process -Id $pid -ErrorAction Stop).ProcessName } catch { $pname = "" }
[pscustomobject]@{
  pid = $pid
  processName = $pname
  title = $sb.ToString()
  handle = "$($hwnd.ToInt64())"
  bounds = @{
    x = $rect.Left
    y = $rect.Top
    width = ($rect.Right - $rect.Left)
    height = ($rect.Bottom - $rect.Top)
  }
} | ConvertTo-Json -Compress
`
  const data = await runPowerShellJson(script, 1400)
  if (!data || typeof data !== 'object') return undefined
  const title = typeof (data as any).title === 'string' ? (data as any).title : ''
  const boundsRaw = (data as any).bounds
  const bounds =
    boundsRaw && Number.isFinite(boundsRaw.x) && Number.isFinite(boundsRaw.y) && Number.isFinite(boundsRaw.width) && Number.isFinite(boundsRaw.height)
      ? { x: Number(boundsRaw.x), y: Number(boundsRaw.y), width: Number(boundsRaw.width), height: Number(boundsRaw.height) }
      : undefined
  return {
    pid: Number.isFinite((data as any).pid) ? Number((data as any).pid) : undefined,
    processName: typeof (data as any).processName === 'string' ? (data as any).processName : undefined,
    title,
    handle: typeof (data as any).handle === 'string' ? (data as any).handle : undefined,
    bounds
  }
}

export function createWindowsAdapter(): TaskWatcherAdapter {
  return { getProcesses: getProcessesWindows, getForegroundWindow: getForegroundWindowWindows }
}

export async function forceTopmostWindowsWindows(hwnds: bigint[]): Promise<void> {
  const uniq: bigint[] = []
  const seen = new Set<string>()
  for (const h of hwnds) {
    if (typeof h !== 'bigint') continue
    if (h <= 0n) continue
    const k = h.toString()
    if (seen.has(k)) continue
    seen.add(k)
    uniq.push(h)
  }
  if (uniq.length === 0) return

  const list = uniq.map((h) => h.toString()).join(',')
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class LanStartWin32Z {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
$SWP_NOSIZE = 0x0001
$SWP_NOMOVE = 0x0002
$SWP_NOACTIVATE = 0x0010
$HWND_TOPMOST = [IntPtr](-1)
$flags = $SWP_NOSIZE -bor $SWP_NOMOVE -bor $SWP_NOACTIVATE
$hwnds = @(${list})
foreach ($h in $hwnds) {
  try {
    $ptr = [IntPtr]::new([Int64]$h)
    [LanStartWin32Z]::SetWindowPos($ptr, $HWND_TOPMOST, 0, 0, 0, 0, $flags) | Out-Null
    [LanStartWin32Z]::BringWindowToTop($ptr) | Out-Null
  } catch {}
}
`
  await runPowerShell(script, 1200).catch(() => undefined)
}
