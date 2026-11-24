#!/usr/bin/env bash
# Writes AItelier's Homebrew cask for a published version, with the SHA-256 of
# both DMGs (Apple Silicon and Intel). .github/workflows/homebrew.yml uses it
# to update davidnussio/homebrew-tap.
#
#   scripts/homebrew-cask.sh <version> <sha256 arm64 DMG> <sha256 intel DMG> > Casks/aitelier.rb
set -euo pipefail

VERSION="$1"
SHA_ARM="$2"
SHA_INTEL="$3"

cat <<EOF
cask "aitelier" do
  arch arm: "arm64", intel: "intel"

  version "$VERSION"
  sha256 arm:   "$SHA_ARM",
         intel: "$SHA_INTEL"

  url "https://github.com/davidnussio/aitelier/releases/download/v#{version}/AItelier-#{version}-macOS-#{arch}.dmg"
  name "AItelier"
  desc "Family image studio with consistent styles (GPT Image)"
  homepage "https://github.com/davidnussio/aitelier"

  livecheck do
    url :url
    strategy :github_latest
  end

  # the app updates itself (Electrobun updater)
  auto_updates true

  # signed with Developer ID and notarized: Gatekeeper opens it without extra steps
  app "AItelier.app"

  # the identifier stays the one from Bottega (<= 0.1.0)
  zap trash: [
    "~/Library/Application Support/ch.dambox.bottega",
    "~/Library/Caches/ch.dambox.bottega",
    "~/Library/HTTPStorages/ch.dambox.bottega",
    "~/Library/Preferences/ch.dambox.bottega.plist",
    "~/Library/Saved Application State/ch.dambox.bottega.savedState",
    "~/Library/WebKit/ch.dambox.bottega",
  ]
end
EOF
