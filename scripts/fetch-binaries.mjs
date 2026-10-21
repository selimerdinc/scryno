#!/usr/bin/env node
/**
 * Downloads pinned scrcpy (+ bundled adb) builds into resources/bin/{os}-{arch}.
 * Folder names match electron-builder macros: mac|win + arch.
 */
import { createWriteStream, existsSync, mkdirSync, chmodSync, rmSync, copyFileSync } from 'fs'
import { pipeline } from 'stream/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Pin versions for reproducible builds.
const SCRCPY_VERSION = '3.2'
const PLATFORM_TOOLS_VERSION = '36.0.0'

const targets = [
  {
    id: 'mac-arm64',
    scrcpyUrl: `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-macos-aarch64-v${SCRCPY_VERSION}.tar.gz`,
    platformToolsUrl: `https://dl.google.com/android/repository/platform-tools_r${PLATFORM_TOOLS_VERSION}-darwin.zip`,
    scrcpyName: 'scrcpy',
    adbName: 'adb'
  },
  {
    id: 'mac-x64',
    scrcpyUrl: `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-macos-x86_64-v${SCRCPY_VERSION}.tar.gz`,
    platformToolsUrl: `https://dl.google.com/android/repository/platform-tools_r${PLATFORM_TOOLS_VERSION}-darwin.zip`,
    scrcpyName: 'scrcpy',
    adbName: 'adb'
  },
  {
    id: 'win-x64',
    // Official scrcpy Windows zip already ships adb.exe.
    scrcpyUrl: `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-win64-v${SCRCPY_VERSION}.zip`,
    platformToolsUrl: null,
    scrcpyName: 'scrcpy.exe',
    adbName: 'adb.exe'
  }
]

const only = process.argv[2] // e.g. mac-arm64

function workDir() {
  return join(tmpdir(), `scryno-bin-${randomBytes(6).toString('hex')}`)
}

async function download(url, dest) {
  console.log(`  download ${url}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }
  await pipeline(response.body, createWriteStream(dest))
}

function extractArchive(archivePath, outDir) {
  mkdirSync(outDir, { recursive: true })
  if (archivePath.endsWith('.zip')) {
    execFileSync('unzip', ['-qo', archivePath, '-d', outDir], { stdio: 'inherit' })
    return
  }
  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    execFileSync('tar', ['-xzf', archivePath, '-C', outDir], { stdio: 'inherit' })
    return
  }
  throw new Error(`Unsupported archive: ${archivePath}`)
}

function findFile(rootDir, fileName) {
  const result = execFileSync('find', [rootDir, '-type', 'f', '-name', fileName], {
    encoding: 'utf8'
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (result.length === 0) {
    throw new Error(`Could not find ${fileName} under ${rootDir}`)
  }
  return result[0]
}

function copyTreeExtras(scrcpyExtractRoot, destDir, scrcpyBinaryName) {
  // Copy scrcpy server jar / dylib neighbors sitting next to the binary.
  const binaryPath = findFile(scrcpyExtractRoot, scrcpyBinaryName)
  const binaryDir = dirname(binaryPath)
  execFileSync('bash', [
    '-lc',
    `cp -R "${binaryDir}/"* "${destDir}/"`
  ], { stdio: 'inherit' })
}

async function fetchTarget(target) {
  console.log(`\n==> ${target.id}`)
  const destDir = join(root, 'resources', 'bin', target.id)
  mkdirSync(destDir, { recursive: true })

  const tmp = workDir()
  mkdirSync(tmp, { recursive: true })

  try {
    const scrcpyExt = target.scrcpyUrl.includes('.zip') ? '.zip' : '.tar.gz'
    const scrcpyArchive = join(tmp, `scrcpy-archive${scrcpyExt}`)
    const scrcpyOut = join(tmp, 'scrcpy')
    const toolsOut = join(tmp, 'tools')

    await download(target.scrcpyUrl, scrcpyArchive)
    extractArchive(scrcpyArchive, scrcpyOut)

    if (target.platformToolsUrl) {
      const toolsArchive = join(tmp, 'platform-tools.zip')
      await download(target.platformToolsUrl, toolsArchive)
      extractArchive(toolsArchive, toolsOut)
    }

    // Fresh dest
    rmSync(destDir, { recursive: true, force: true })
    mkdirSync(destDir, { recursive: true })

    copyTreeExtras(scrcpyOut, destDir, target.scrcpyName)

    if (target.platformToolsUrl) {
      const adbSrc = findFile(toolsOut, target.adbName)
      copyFileSync(adbSrc, join(destDir, target.adbName))
    } else if (!existsSync(join(destDir, target.adbName))) {
      // Ensure adb exists when scrcpy zip layout nests it.
      const adbSrc = findFile(scrcpyOut, target.adbName)
      copyFileSync(adbSrc, join(destDir, target.adbName))
    }

    if (!target.adbName.endsWith('.exe')) {
      chmodSync(join(destDir, target.scrcpyName), 0o755)
      chmodSync(join(destDir, target.adbName), 0o755)
      try {
        execFileSync(
          'bash',
          [
            '-lc',
            `chmod -R u+w "${destDir}" && find "${destDir}" -type f -perm -111 -exec chmod 755 {} +`
          ],
          { stdio: 'inherit' }
        )
      } catch {
        // best-effort
      }
    }

    if (target.id.startsWith('mac-')) {
      compileWinbounds(destDir)
    }

    console.log(`  ready: ${destDir}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function compileWinbounds(destDir) {
  for (const name of ['scryno-winbounds', 'scryno-wincapture', 'scryno-ioscapture', 'scryno-chrome']) {
    const source = join(root, 'scripts', `${name}.swift`)
    if (!existsSync(source)) {
      console.warn(`  skip ${name} (source missing)`)
      continue
    }
    if (process.platform !== 'darwin') {
      console.warn(`  skip ${name} (not on macOS)`)
      continue
    }
    const out = join(destDir, name)
    console.log(`  compile ${name}`)
    execFileSync('swiftc', ['-O', '-o', out, source], { stdio: 'inherit' })
    chmodSync(out, 0o755)
  }
}

const selected = only ? targets.filter((t) => t.id === only) : targets.filter((t) => {
  // Default: current host + win-x64 for packaging convenience on mac CI-ish local builds
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return t.id === 'mac-arm64' || t.id === 'win-x64'
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return t.id === 'mac-x64' || t.id === 'win-x64'
  }
  if (process.platform === 'win32') {
    return t.id === 'win-x64'
  }
  return t.id === 'mac-arm64'
})

if (selected.length === 0) {
  console.error(`Unknown target: ${only}`)
  console.error(`Known: ${targets.map((t) => t.id).join(', ')}`)
  process.exit(1)
}

for (const target of selected) {
  await fetchTarget(target)
}

console.log('\nDone.')
