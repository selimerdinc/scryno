#!/usr/bin/env node
/**
 * Builds Scryno's icon assets (build/icon.icns, renderer logo) from scripts/make-icon.swift and,
 * in dev, rebrands node_modules' Electron.app so the Dock and menu bar say "Scryno".
 */
import { execFileSync } from 'child_process'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
const iconSource = join(root, 'scripts', 'make-icon.swift')
const iconPng = join(buildDir, 'icon.png')
const iconIcns = join(buildDir, 'icon.icns')
const rendererLogo = join(root, 'src', 'renderer', 'src', 'assets', 'logo.png')

function isStale(target, source) {
  return !existsSync(target) || statSync(target).mtimeMs < statSync(source).mtimeMs
}

function buildIcons() {
  mkdirSync(buildDir, { recursive: true })
  if (isStale(iconPng, iconSource)) {
    execFileSync('swift', [iconSource, iconPng, '1024'], { stdio: 'inherit' })
  }

  if (isStale(iconIcns, iconPng)) {
    const iconset = join(buildDir, 'icon.iconset')
    rmSync(iconset, { recursive: true, force: true })
    mkdirSync(iconset)
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const pixels = size * scale
        const name = scale === 1 ? `icon_${size}x${size}.png` : `icon_${size}x${size}@2x.png`
        execFileSync('sips', ['-z', String(pixels), String(pixels), iconPng, '--out', join(iconset, name)], {
          stdio: 'ignore'
        })
      }
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', iconIcns])
    rmSync(iconset, { recursive: true, force: true })
  }

  if (isStale(rendererLogo, iconPng)) {
    mkdirSync(dirname(rendererLogo), { recursive: true })
    execFileSync('sips', ['-z', '256', '256', iconPng, '--out', rendererLogo], { stdio: 'ignore' })
  }
}

function plistSet(plist, key, value) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], { stdio: 'ignore' })
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist], {
      stdio: 'ignore'
    })
  }
}

function brandDevElectron() {
  const dist = join(root, 'node_modules', 'electron', 'dist')
  const stock = join(dist, 'Electron.app')
  const named = join(dist, 'Scryno.app')

  // The Dock label comes from the .app bundle name, not CFBundleDisplayName.
  if (existsSync(stock)) {
    rmSync(named, { recursive: true, force: true })
    renameSync(stock, named)
  }

  const app = existsSync(named) ? named : stock
  const plist = join(app, 'Contents', 'Info.plist')
  if (!existsSync(plist)) {
    return
  }

  plistSet(plist, 'CFBundleName', 'Scryno')
  plistSet(plist, 'CFBundleDisplayName', 'Scryno')
  const bundleName = app.endsWith('Scryno.app') ? 'Scryno.app' : 'Electron.app'
  writeFileSync(
    join(root, 'node_modules', 'electron', 'path.txt'),
    `${bundleName}/Contents/MacOS/Electron`
  )

  const bundledIcon = join(app, 'Contents', 'Resources', 'electron.icns')
  if (isStale(bundledIcon, iconIcns)) {
    copyFileSync(iconIcns, bundledIcon)
  }
  execFileSync('touch', [app])
  execFileSync(
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    ['-f', app],
    { stdio: 'ignore' }
  )
}

if (process.platform === 'darwin') {
  buildIcons()
  if (process.argv.includes('--dev')) {
    brandDevElectron()
  }
}
