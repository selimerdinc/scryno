const { execFileSync } = require('child_process')
const { lstatSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } = require('fs')
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

function signIdentity() {
  const name = process.env.SCRYNO_SIGN_IDENTITY
  return name && name !== '-' ? name : '-'
}

function sign(target, entitlements, identifier) {
  const args = ['--force', '--sign', signIdentity()]
  if (identifier) {
    args.push('--identifier', identifier)
  }
  if (entitlements) {
    args.push('--entitlements', entitlements)
  }
  execFileSync('codesign', [...args, target], { stdio: 'inherit' })
}

// Nested code must be signed before the bundle that contains it, or the outer seal breaks.
function signInsideOut(dir, binRoot) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    const stat = lstatSync(file)
    if (stat.isSymbolicLink()) {
      continue
    }
    if (stat.isDirectory()) {
      signInsideOut(file, binRoot)
      if (name.endsWith('.app') || name.endsWith('.framework')) {
        sign(file)
      }
      continue
    }
    if (stat.isFile() && isMachO(file)) {
      const identifier = file.startsWith(binRoot) ? basename(file) : undefined
      sign(file, undefined, identifier)
    }
  }
}

/** Signs the bundle. A stable identity keeps Screen Recording and Accessibility across versions. */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const identity = signIdentity()
  console.log(identity === '-' ? 'codesign: ad-hoc' : `codesign: ${identity}`)
  relativizeFrameworkSymlinks(join(appPath, 'Contents', 'Frameworks'))
  signInsideOut(join(appPath, 'Contents'), join(appPath, 'Contents', 'Resources', 'bin'))
  sign(appPath, join(context.packager.info.projectDir, 'build', 'entitlements.mac.plist'))
  execFileSync('codesign', ['--verify', '--strict', appPath], { stdio: 'inherit' })
}
