#!/usr/bin/env node
import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))

// GitHub Actions GITHUB_RUN_NUMBER ile eş değer sürümleme
const runNumber = process.env.GITHUB_RUN_NUMBER
const version = process.env.VERSION || (runNumber ? `1.0.${runNumber}` : pkg.version)
const tag = process.env.TAG || (runNumber ? `build-${runNumber}` : `build-${version.split('.').pop()}`)

const releaseDir = join(root, 'release')
let armSha = ''
let intelSha = ''

if (existsSync(releaseDir)) {
  const files = readdirSync(releaseDir)
  for (const file of files) {
    if (file.endsWith('.dmg')) {
      const fullPath = join(releaseDir, file)
      const buffer = readFileSync(fullPath)
      const sha = createHash('sha256').update(buffer).digest('hex')
      if (file.includes('arm64')) {
        armSha = sha
      } else {
        intelSha = sha
      }
    }
  }
}

armSha = armSha || '5f8599801130cbe931253a0aed96ebec5535e679c3d49f1aa47291a27e7f9175'
intelSha = intelSha || armSha

const caskContent = `cask "scryno" do
  version "${version}"
  sha256 "${armSha}"

  url "https://github.com/selimerdinc/scryno/releases/download/build-#{version.sub(/^1\\.0\\./, '')}/Scryno-#{version}-arm64.dmg"
  name "Scryno"
  desc "Android and iPhone mirroring & control desktop app"
  homepage "https://github.com/selimerdinc/scryno"

  livecheck do
    url :url
    regex(/build[._-](\\d+)/i)
    strategy :github_latest do |json, regex|
      match = json["tag_name"]&.match(regex)
      next if match.nil?

      "1.0.#{match[1]}"
    end
  end

  auto_updates true
  depends_on macos: ">= :sonoma"
  depends_on arch: :arm64

  app "Scryno.app"

  uninstall quit: "app.scryno.desktop"

  zap trash: [
    "~/Library/Application Support/Scryno",
    "~/Library/Logs/Scryno",
    "~/Library/Preferences/app.scryno.desktop.plist",
    "~/Library/Saved Application State/app.scryno.desktop.savedState",
  ]
end
`

const caskPath = join(root, 'Casks', 'scryno.rb')
writeFileSync(caskPath, caskContent, 'utf-8')
console.log(`✓ Casks/scryno.rb v${version} (${tag}) için güncellendi. SHA256: ${armSha}`)
