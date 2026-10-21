const { execFileSync } = require('child_process')
const { lstatSync, readdirSync, readlinkSync, statSync, symlinkSync, unlinkSync } = require('fs')
const { basename, join } = require('path')

function isMachO(file) {
  try {
    return execFileSync('file', ['-b', file], { encoding: 'utf8' }).includes('Mach-O')
  } catch {
    return false
  }
}

function relativizeFrameworkSymlinks(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    const stat = lstatSync(file)
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(file)
      if (!target.startsWith('/') || !target.includes('/Versions/A')) {
        continue
      }
      const relative = basename(file) === 'Current' ? 'A' : `Versions/Current/${basename(file)}`
      unlinkSync(file)
      symlinkSync(relative, file)
      continue
    }
    if (stat.isDirectory()) {
      relativizeFrameworkSymlinks(file)
    }
  }
}

/** Ad-hoc signs bundled helpers so macOS allows adb, scrcpy and the Swift tools to run. */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }
  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )
  relativizeFrameworkSymlinks(join(appPath, 'Contents', 'Frameworks'))
  const binDir = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'bin'
  )
  for (const name of readdirSync(binDir)) {
    const file = join(binDir, name)
    if (!statSync(file).isFile() || !isMachO(file)) {
      continue
    }
    execFileSync('codesign', ['--force', '--sign', '-', file], { stdio: 'inherit' })
  }
}
