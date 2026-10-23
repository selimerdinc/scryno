#!/usr/bin/env node
/**
 * Dev launcher: Cursor/other tools often set ELECTRON_RUN_AS_NODE=1 which makes
 * Electron abort at NSApplication init (SIGABRT). Clear it before electron-vite.
 */
import { execFileSync, spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete process.env.ELECTRON_RUN_AS_NODE

execFileSync(process.execPath, [join(root, 'scripts', 'brand.mjs'), '--dev'], { stdio: 'inherit' })

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['electron-vite', 'dev'],
  { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' }
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
