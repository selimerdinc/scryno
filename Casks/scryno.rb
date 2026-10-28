cask "scryno" do
  version "1.0.10"
  sha256 "6085b038dd15e41a37e373470a8f54c1de78bbbbbd0a2f0244c4775ce005d547"

  url "https://github.com/selimerdinc/scryno/releases/download/build-#{version.sub(/^1\.0\./, '')}/Scryno-#{version}-arm64.dmg"
  name "Scryno"
  desc "Android and iPhone mirroring & control desktop app"
  homepage "https://github.com/selimerdinc/scryno"

  livecheck do
    url :url
    regex(/build[._-](\d+)/i)
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
