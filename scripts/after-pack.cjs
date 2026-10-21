const { execFileSync } = require('child_process')
const { readdirSync, statSync } = require('fs')
const { join } = require('path')

function isMachO(file) {
  try {
    return execFileSync('file', ['-b', file], { encoding: 'utf8' }).includes('Mach-O')
  } catch {
    return false
  }
}

/** Ad-hoc signs bundled helpers so macOS allows adb, scrcpy and the Swift tools to run. */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }
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
