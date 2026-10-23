import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { resolveBinary } from '../paths'

export type ChromeAction = 'screenshot' | 'record' | 'folder' | 'close' | 'draw'

export interface NativeChromeOptions {
  needle: string
  label: string
  platform: 'android' | 'ios'
}

export interface ChromeStatus {
  recording: boolean
  message?: string
  kind?: 'ok' | 'error' | 'info'
}

type ActionHandler = (deviceId: string, action: ChromeAction) => void
type ReadyHandler = (deviceId: string) => void

const chromes = new Map<string, ChildProcessWithoutNullStreams>()
let actionHandler: ActionHandler | null = null
let readyHandler: ReadyHandler | null = null

export function setChromeReadyHandler(handler: ReadyHandler): void {
  readyHandler = handler
}

function helperPath(): string | null {
  if (process.platform !== 'darwin') {
    return null
  }
  const helper = resolveBinary('scryno-chrome')
  return helper === 'scryno-chrome' ? null : helper
}

export function isNativeChromeAvailable(): boolean {
  return helperPath() !== null
}

export function setChromeActionHandler(handler: ActionHandler): void {
  actionHandler = handler
}

export function openNativeChrome(deviceId: string, options: NativeChromeOptions): void {
  const helper = helperPath()
  if (!helper || chromes.has(deviceId)) {
    return
  }
  const child = spawn(
    helper,
    ['--needle', options.needle, '--label', options.label, '--platform', options.platform],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  )
  chromes.set(deviceId, child)

  let pending = ''
  child.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8')
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { event?: string; name?: ChromeAction }
        if (event.event === 'ready') {
          readyHandler?.(deviceId)
        } else if ((event.event === 'action') && event.name) {
          actionHandler?.(deviceId, event.name)
        }
      } catch {
        // Ignore partial or non-JSON output.
      }
    }
  })
  child.stderr.on('data', () => undefined)
  child.on('exit', () => {
    if (chromes.get(deviceId) === child) {
      chromes.delete(deviceId)
    }
  })
  child.on('error', () => {
    chromes.delete(deviceId)
  })
}

export function hasNativeChrome(deviceId: string): boolean {
  return chromes.has(deviceId)
}

export function sendNativeChromeStatus(deviceId: string, status: ChromeStatus): void {
  const child = chromes.get(deviceId)
  if (!child || !child.stdin.writable) {
    return
  }
  child.stdin.write(`${JSON.stringify(status)}\n`)
}

export function closeNativeChrome(deviceId: string): void {
  const child = chromes.get(deviceId)
  chromes.delete(deviceId)
  if (child && (child.exitCode === null)) {
    child.stdin.end()
    child.kill('SIGTERM')
  }
}

export function closeAllNativeChromes(): void {
  for (const deviceId of Array.from(chromes.keys())) {
    closeNativeChrome(deviceId)
  }
}
