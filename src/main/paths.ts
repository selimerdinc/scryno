import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

export type HostArch = 'arm64' | 'x64'

export function getHostArch(): HostArch {
  if (process.arch === 'arm64') {
    return 'arm64'
  }
  return 'x64'
}

/** electron-builder `${os}` values: mac | win | linux */
export function getBuilderOs(): 'mac' | 'win' | 'linux' {
  if (process.platform === 'darwin') {
    return 'mac'
  }
  if (process.platform === 'win32') {
    return 'win'
  }
  return 'linux'
}

export function getBinRoot(): string {
  if (app?.isPackaged) {
    return join(process.resourcesPath, 'bin')
  }

  const folder = `${getBuilderOs()}-${getHostArch()}`
  // Compiled main lives in out/main → ../../resources/bin/{os}-{arch}
  return join(__dirname, '../../resources/bin', folder)
}

export function resolveBinary(name: string): string {
  const isWin = process.platform === 'win32'
  const fileName = isWin ? `${name}.exe` : name
  const candidate = join(getBinRoot(), fileName)

  if (existsSync(candidate)) {
    return candidate
  }

  // Dev fallback: system PATH (useful before fetch-binaries runs).
  return name
}
