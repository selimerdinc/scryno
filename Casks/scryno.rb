cask "scryno" do
  arch arm: "-arm64", intel: ""

  version "1.0.9"
  sha256 arm:   "020f1c74a002bbbb9e6170da25f6c75242263732712b89069213c5b9fbce96f5",
         intel: "020f1c74a002bbbb9e6170da25f6c75242263732712b89069213c5b9fbce96f5"

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
  depends_on macos: :monterey

  app "Scryno.app"

  uninstall quit: "app.scryno.desktop"

  zap trash: [
    "~/Library/Application Support/Scryno",
    "~/Library/Logs/Scryno",
    "~/Library/Preferences/app.scryno.desktop.plist",
    "~/Library/Saved Application State/app.scryno.desktop.savedState",
  ]
end
