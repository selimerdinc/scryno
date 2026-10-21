import { execFile } from 'child_process'
import { existsSync, statSync } from 'fs'
import { basename, delimiter, extname } from 'path'
import { promisify } from 'util'
import type {
  AndroidAppInfo,
  AndroidAppsResult,
  DeviceConnectionState,
  DeviceInfo,
  SendFilesResult
} from '../../shared/types'
import { getBinRoot, resolveBinary } from '../paths'

const execFileAsync = promisify(execFile)

function mapState(raw: string): DeviceConnectionState {
  switch (raw) {
    case 'device':
      return 'device'
    case 'unauthorized':
      return 'unauthorized'
    case 'offline':
      return 'offline'
    default:
      return 'unknown'
  }
}

function parseDevicesOutput(stdout: string): DeviceInfo[] {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const devices: DeviceInfo[] = []

  for (const line of lines) {
    if (line.startsWith('List of devices')) {
      continue
    }

    const parts = line.split(/\s+/)
    if (parts.length < 2) {
      continue
    }

    const id = parts[0]
    const state = mapState(parts[1])
    const props: Record<string, string> = {}

    for (let i = 2; i < parts.length; i++) {
      const token = parts[i]
      const eq = token.indexOf(':')
      if (eq > 0) {
        props[token.slice(0, eq)] = token.slice(eq + 1)
      }
    }

    const model = props['model']?.replace(/_/g, ' ')
    const product = props['product']
    const transport = props['transport_id']
    const name = model || product || id

    devices.push({
      id,
      platform: 'android',
      name,
      model,
      product,
      state,
      transport,
      wireless: id.includes(':')
    })
  }

  return devices
}

export async function listAndroidDevices(): Promise<{ devices: DeviceInfo[]; adbPath: string }> {
  const adbPath = resolveBinary('adb')

  try {
    const { stdout } = await execFileAsync(adbPath, ['devices', '-l'], {
      timeout: 15000,
      maxBuffer: 1024 * 1024
    })
    return {
      devices: parseDevicesOutput(stdout),
      adbPath
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string }
    if (err.code === 'ENOENT') {
      throw Object.assign(new Error(
        'ADB bulunamadı. `npm run fetch-binaries` çalıştırın veya sistem PATH\'ine adb ekleyin.'
      ), { code: 'ADB_NOT_FOUND' })
    }

    const detail = err.stderr?.trim() || err.message
    throw Object.assign(new Error(`ADB cihaz listesi alınamadı: ${detail}`), {
      code: 'ADB_LIST_FAILED'
    })
  }
}

function parseAppsOutput(output: string): AndroidAppInfo[] {
  const apps: AndroidAppInfo[] = []
  let pendingName = ''

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const complete = line.match(/^\s*[*-]\s+(.+?)\s{2,}([A-Za-z][\w.]*)\s*$/)
    if (complete) {
      apps.push({ name: complete[1].trim(), packageName: complete[2] })
      pendingName = ''
      continue
    }

    const nameOnly = line.match(/^\s*[*-]\s+(.+?)\s*$/)
    if (nameOnly) {
      pendingName = nameOnly[1].trim()
      continue
    }

    const packageOnly = line.match(/^\s+([A-Za-z][\w.]*)\s*$/)
    if (pendingName && packageOnly) {
      apps.push({ name: pendingName, packageName: packageOnly[1] })
      pendingName = ''
    }
  }

  return apps.sort((left, right) => left.name.localeCompare(right.name, 'tr'))
}

export async function listAndroidApps(deviceId: string): Promise<AndroidAppsResult> {
  if (!/^[\w.:-]+$/.test(deviceId)) {
    throw Object.assign(new Error('Geçersiz cihaz kimliği'), { code: 'INVALID_DEVICE' })
  }

  const binRoot = getBinRoot()
  try {
    const { stdout, stderr } = await execFileAsync(
      resolveBinary('scrcpy'),
      ['--serial', deviceId, '--list-apps'],
      {
        timeout: 45000,
        maxBuffer: 4 * 1024 * 1024,
        cwd: binRoot,
        env: {
          ...process.env,
          ADB: resolveBinary('adb'),
          PATH: `${binRoot}${delimiter}${process.env.PATH ?? ''}`
        }
      }
    )
    const apps = parseAppsOutput(`${stdout}\n${stderr}`)
    if (apps.length === 0) {
      throw Object.assign(new Error('Telefondaki uygulamalar okunamadı'), {
        code: 'APPS_EMPTY'
      })
    }
    return { ok: true, apps }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    const apps = parseAppsOutput(`${err.stdout ?? ''}\n${err.stderr ?? ''}`)
    if (apps.length > 0) {
      return { ok: true, apps }
    }
    throw Object.assign(new Error(`Uygulamalar alınamadı: ${adbDetail(error)}`), {
      code: 'APPS_LIST_FAILED'
    })
  }
}

function adbDetail(error: unknown): string {
  const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
  const detail = `${err.stderr ?? ''}\n${err.stdout ?? ''}`.trim()
  return detail || err.message || 'ADB komutu başarısız'
}

function remoteFileName(filePath: string): string {
  const name = basename(filePath).replace(/[\\/\0]/g, '_').trim()
  return name || 'scryno-dosya'
}

export async function sendFilesToAndroid(
  deviceId: string,
  filePaths: string[]
): Promise<SendFilesResult> {
  if (!/^[\w.:-]+$/.test(deviceId)) {
    throw Object.assign(new Error('Geçersiz cihaz kimliği'), { code: 'INVALID_DEVICE' })
  }
  if (!Array.isArray(filePaths) || filePaths.length === 0 || filePaths.length > 12) {
    throw Object.assign(new Error('En fazla 12 dosya bırakılabilir'), { code: 'INVALID_FILES' })
  }

  const adbPath = resolveBinary('adb')
  const done: string[] = []

  for (const filePath of filePaths) {
    if (typeof filePath !== 'string' || !filePath.startsWith('/') || filePath.includes('\0')) {
      throw Object.assign(new Error('Geçersiz dosya yolu'), { code: 'INVALID_FILES' })
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      throw Object.assign(new Error('Yalnızca dosya bırakılabilir, klasör değil'), {
        code: 'INVALID_FILES'
      })
    }

    const name = remoteFileName(filePath)
    const apk = extname(name).toLowerCase() === '.apk'

    try {
      if (apk) {
        await execFileAsync(adbPath, ['-s', deviceId, 'install', '-r', '-t', filePath], {
          timeout: 180000,
          maxBuffer: 4 * 1024 * 1024
        })
        done.push(`${name} kuruldu`)
      } else {
        await execFileAsync(
          adbPath,
          ['-s', deviceId, 'push', filePath, `/sdcard/Download/${name}`],
          { timeout: 180000, maxBuffer: 4 * 1024 * 1024 }
        )
        done.push(`${name} İndirilenler'e gitti`)
      }
    } catch (error) {
      const detail = adbDetail(error).split('\n').slice(-3).join(' ').slice(0, 280)
      throw Object.assign(new Error(`${name}: ${detail}`), { code: 'ADB_SEND_FAILED' })
    }
  }

  return { ok: true, message: done.join(' · ') }
}
