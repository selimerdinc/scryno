import { ChildProcessWithoutNullStreams, spawn, execFile } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { resolveBinary } from '../paths'

const execFileAsync = promisify(execFile)

export interface IosTunnelInfo {
  address: string
  rsdPort: number
  userspaceTunPort: number
  udid: string
}

let tunnelProcess: ChildProcessWithoutNullStreams | null = null
let tunnelReady: Promise<void> | null = null

function goIosPath(): string {
  const bin = resolveBinary('go-ios')
  if (!existsSync(bin) && bin === 'go-ios') {
    throw Object.assign(
      new Error('go-ios yok. iOS yansıtma için resources/bin içindeki go-ios gerekir.'),
      { code: 'GO_IOS_NOT_FOUND' }
    )
  }
  return bin
}

// Only `tunnel start` may see ENABLE_GO_IOS_AGENT: other commands would spawn their own agent,
// which replaces the tunnel and silently stalls any running stream.
function goIosEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.ENABLE_GO_IOS_AGENT
  return env
}

function goIosTunnelEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ENABLE_GO_IOS_AGENT: process.env.ENABLE_GO_IOS_AGENT || 'user'
  }
}

function parseTunnels(stdout: string): IosTunnelInfo[] {
  const start = stdout.indexOf('[')
  const end = stdout.lastIndexOf(']')
  if (start < 0 || end <= start) {
    return []
  }
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as Array<{
    address?: string
    rsdPort?: number
    userspaceTunPort?: number
    udid?: string
  }>
  return parsed
    .filter((item) => item.address && item.rsdPort && item.userspaceTunPort && item.udid)
    .map((item) => ({
      address: item.address as string,
      rsdPort: item.rsdPort as number,
      userspaceTunPort: item.userspaceTunPort as number,
      udid: item.udid as string
    }))
}

export async function listIosTunnels(): Promise<IosTunnelInfo[]> {
  const bin = goIosPath()
  try {
    const { stdout } = await execFileAsync(bin, ['tunnel', 'ls'], {
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      env: goIosEnv()
    })
    return parseTunnels(stdout)
  } catch {
    return []
  }
}

export async function ensureIosTunnel(): Promise<void> {
  const existing = await listIosTunnels()
  if (existing.length > 0) {
    return
  }
  if (tunnelReady) {
    await tunnelReady
    return
  }

  tunnelReady = new Promise<void>((resolve, reject) => {
    const bin = goIosPath()
    const child = spawn(bin, ['tunnel', 'start', '--userspace'], {
      env: goIosTunnelEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    tunnelProcess = child

    let settled = false
    const finishOk = (): void => {
      if (settled) {
        return
      }
      settled = true
      resolve()
    }
    const finishErr = (message: string): void => {
      if (settled) {
        return
      }
      settled = true
      tunnelReady = null
      reject(Object.assign(new Error(message), { code: 'IOS_TUNNEL_FAILED' }))
    }

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      if (text.includes('negotiated') || text.includes('Tunnel server started')) {
        // Wait until tunnel ls can see it.
        void listIosTunnels().then((tunnels) => {
          if (tunnels.length > 0) {
            finishOk()
          }
        })
      }
      if (text.toLowerCase().includes('developer mode')) {
        finishErr('iPhone’da Developer Mode açık olmalı (Ayarlar → Gizlilik ve Güvenlik).')
      }
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (error) => finishErr(error.message))
    child.on('exit', (code) => {
      if (tunnelProcess === child) {
        tunnelProcess = null
      }
      if (!settled) {
        finishErr(`iOS tüneli kapandı (kod ${code ?? '?'})`)
      }
    })

    const poll = setInterval(() => {
      void listIosTunnels().then((tunnels) => {
        if (tunnels.length > 0) {
          clearInterval(poll)
          finishOk()
        }
      })
    }, 400)

    setTimeout(() => {
      clearInterval(poll)
      finishErr(
        'iOS tüneli açılamadı. USB, “Güven” ve Developer Mode kontrol et (iOS 17+ gerekir).'
      )
    }, 20000)
  })

  try {
    await tunnelReady
  } catch (error) {
    tunnelReady = null
    throw error
  }
}

export async function tunnelForDevice(udid: string): Promise<IosTunnelInfo> {
  await ensureIosTunnel()
  const tunnels = await listIosTunnels()
  const match = tunnels.find((item) => item.udid === udid) || tunnels[0]
  if (!match) {
    throw Object.assign(new Error('iOS tüneli bulunamadı'), { code: 'IOS_TUNNEL_MISSING' })
  }
  return match
}

export async function captureIosScreenshot(udid: string, outPath: string): Promise<void> {
  const tunnel = await tunnelForDevice(udid)
  const bin = goIosPath()
  await execFileAsync(
    bin,
    [
      '--udid',
      udid,
      '--address',
      tunnel.address,
      '--rsd-port',
      String(tunnel.rsdPort),
      '--userspace-port',
      String(tunnel.userspaceTunPort),
      'screenshot',
      `--output=${outPath}`
    ],
    {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: goIosEnv()
    }
  )
}

export function spawnIosStream(
  udid: string,
  tunnel: IosTunnelInfo,
  port: number
): ChildProcessWithoutNullStreams {
  const bin = goIosPath()
  return spawn(
    bin,
    [
      '--udid',
      udid,
      '--address',
      tunnel.address,
      '--rsd-port',
      String(tunnel.rsdPort),
      '--userspace-port',
      String(tunnel.userspaceTunPort),
      'screenshot',
      '--stream',
      `--port=${port}`
    ],
    {
      env: goIosEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
}

export function stopIosTunnel(): void {
  if (tunnelProcess && !tunnelProcess.killed) {
    tunnelProcess.kill('SIGTERM')
  }
  tunnelProcess = null
  tunnelReady = null
}
