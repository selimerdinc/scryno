import { cpSync, existsSync, renameSync, rmSync } from 'fs'
import { spawnSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronDist = join(root, 'release', '.electron-dist')
const sourceDist = join(root, 'node_modules', 'electron', 'dist')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run(process.execPath, [join(root, 'scripts', 'brand.mjs')])
run(process.execPath, [join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'), 'build'])

rmSync(electronDist, { recursive: true, force: true })
cpSync(sourceDist, electronDist, { recursive: true })
const branded = join(electronDist, 'Scryno.app')
const stock = join(electronDist, 'Electron.app')
if (existsSync(branded) && !existsSync(stock)) {
  renameSync(branded, stock)
}

run(process.execPath, [
  join(root, 'node_modules', 'electron-builder', 'cli.js'),
  '--mac',
  '--publish',
  'never',
  `--config.electronDist=${electronDist}`
])
rmSync(electronDist, { recursive: true, force: true })
