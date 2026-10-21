import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolveBinary } from '../paths'

const execFileAsync = promisify(execFile)

function normalizeEndpoint(raw: string): string {
  const value = raw.trim()
  if (!value) {
    throw Object.assign(new Error('Host:port boş olamaz'), { code: 'INVALID_ENDPOINT' })
  }

  // Accept "192.168.1.10" → default classic port 5555
  if (!value.includes(':')) {
    return `${value}:5555`
  }

  const host = value.slice(0, value.lastIndexOf(':'))
  const port = value.slice(value.lastIndexOf(':') + 1)
  if (!host || !/^\d{1,5}$/.test(port)) {
    throw Object.assign(new Error('Geçersiz endpoint. Örnek: 192.168.1.10:5555'), {
      code: 'INVALID_ENDPOINT'
    })
  }

  const portNumber = Number(port)
  if (portNumber < 1 || portNumber > 65535) {
    throw Object.assign(new Error('Port 1–65535 arasında olmalı'), { code: 'INVALID_ENDPOINT' })
  }

  return value
}

async function runAdb(args: string[]): Promise<string> {
  const adbPath = resolveBinary('adb')
  try {
    const { stdout, stderr } = await execFileAsync(adbPath, args, {
      timeout: 20000,
      maxBuffer: 1024 * 1024
    })
    return `${stdout}\n${stderr}`.trim()
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    if (err.code === 'ENOENT') {
      throw Object.assign(
        new Error(
          'ADB bulunamadı. `npm run fetch-binaries` çalıştırın veya sistem PATH\'ine adb ekleyin.'
        ),
        { code: 'ADB_NOT_FOUND' }
      )
    }

    const detail = (err.stderr || err.stdout || err.message || '').trim()
    throw Object.assign(new Error(detail || 'ADB komutu başarısız'), {
      code: 'ADB_COMMAND_FAILED'
    })
  }
}

function assertAdbSuccess(output: string, failureHint: string): void {
  const lower = output.toLowerCase()
  if (
    lower.includes('failed') ||
    lower.includes('error:') ||
    lower.includes('unable to') ||
    lower.includes('cannot') ||
    lower.includes('refused') ||
    lower.includes('no pairing code') ||
    lower.includes('wrong password')
  ) {
    throw Object.assign(new Error(output || failureHint), { code: 'ADB_COMMAND_FAILED' })
  }
}

export async function connectWireless(endpoint: string): Promise<{ endpoint: string; message: string }> {
  const target = normalizeEndpoint(endpoint)
  const output = await runAdb(['connect', target])
  assertAdbSuccess(output, `Bağlantı başarısız: ${target}`)

  if (!/connected to|already connected/i.test(output)) {
    throw Object.assign(new Error(output || `Bağlantı başarısız: ${target}`), {
      code: 'ADB_CONNECT_FAILED'
    })
  }

  return { endpoint: target, message: output }
}

export async function pairWireless(
  endpoint: string,
  pairingCode: string
): Promise<{ endpoint: string; message: string }> {
  const target = normalizeEndpoint(endpoint)
  const code = pairingCode.trim()
  if (!/^\d{6}$/.test(code)) {
    throw Object.assign(new Error('Eşleştirme kodu 6 haneli olmalı'), {
      code: 'INVALID_PAIRING_CODE'
    })
  }

  const output = await runAdb(['pair', target, code])
  assertAdbSuccess(output, `Eşleştirme başarısız: ${target}`)

  if (!/successfully paired/i.test(output)) {
    throw Object.assign(new Error(output || `Eşleştirme başarısız: ${target}`), {
      code: 'ADB_PAIR_FAILED'
    })
  }

  return { endpoint: target, message: output }
}

export async function disconnectWireless(
  endpoint?: string
): Promise<{ endpoint: string | null; message: string }> {
  if (!endpoint || !endpoint.trim()) {
    const output = await runAdb(['disconnect'])
    return { endpoint: null, message: output || 'Tüm kablosuz bağlantılar kesildi' }
  }

  const target = normalizeEndpoint(endpoint)
  const output = await runAdb(['disconnect', target])
  return { endpoint: target, message: output || `Kesildi: ${target}` }
}

/**
 * USB bağlı cihazı klasik kablosuz moda alır (adb tcpip 5555).
 * Sonra aynı ağdaki host:5555 ile connectWireless kullanılabilir.
 */
export async function enableTcpip(
  deviceId: string,
  port = 5555
): Promise<{ deviceId: string; port: number; message: string }> {
  if (!deviceId || typeof deviceId !== 'string') {
    throw Object.assign(new Error('Geçersiz cihaz kimliği'), { code: 'INVALID_DEVICE' })
  }
  if (port < 1 || port > 65535) {
    throw Object.assign(new Error('Port 1–65535 arasında olmalı'), { code: 'INVALID_ENDPOINT' })
  }

  const output = await runAdb(['-s', deviceId, 'tcpip', String(port)])
  assertAdbSuccess(output, `tcpip ${port} başarısız`)

  return {
    deviceId,
    port,
    message:
      output ||
      `Cihaz ${deviceId} port ${port} üzerinde dinliyor. USB'yi çıkarıp IP:${port} ile bağlanın.`
  }
}
