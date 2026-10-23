cask "scryno" do
  arch arm: "-arm64", intel: ""

  version "1.0.6"
  sha256 arm:   "5f8599801130cbe931253a0aed96ebec5535e679c3d49f1aa47291a27e7f9175",
         intel: "5f8599801130cbe931253a0aed96ebec5535e679c3d49f1aa47291a27e7f9175"

  url "https://github.com/selimerdinc/scryno/releases/download/build-#{version.sub(/^1\.0\./, '')}/Scryno-#{version}#{arch}.dmg"
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
  depends_on macos: ">= :monterey"

  app "Scryno.app"

  uninstall quit: "app.scryno.desktop"

  zap trash: [
    "~/Library/Application Support/Scryno",
    "~/Library/Logs/Scryno",
    "~/Library/Preferences/app.scryno.desktop.plist",
    "~/Library/Saved Application State/app.scryno.desktop.savedState",
  ]
end
