#!/usr/bin/env bash
# Prepara un runner macOS di GitHub Actions per la firma Developer ID e la
# notarizzazione Apple (stessi passi di Ingombro).
#
# Legge dall'ambiente (secret di GitHub):
#   MACOS_CERT_P12       base64 del .p12 esportato ("Developer ID Application")
#   MACOS_CERT_PASSWORD  password del .p12
#   APPLE_API_KEY_P8     base64 della chiave API di App Store Connect (.p8)
#
# Scrive in $GITHUB_ENV:
#   SIGNING_KEYCHAIN            portachiavi temporaneo con il certificato
#   ELECTROBUN_APPLEAPIKEYPATH  percorso del .p8 decodificato, letto da Electrobun
#
# Pulizia con scripts/ci/macos-signing-cleanup.sh (con `if: always()`).
set -euo pipefail

: "${MACOS_CERT_P12:?manca il secret MACOS_CERT_P12}"
: "${MACOS_CERT_PASSWORD:?manca il secret MACOS_CERT_PASSWORD}"
: "${APPLE_API_KEY_P8:?manca il secret APPLE_API_KEY_P8}"

KEYCHAIN="$RUNNER_TEMP/signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -base64 24)"
CERT_PATH="$RUNNER_TEMP/developer-id.p12"
API_KEY_PATH="$RUNNER_TEMP/AuthKey.p8"

echo "$MACOS_CERT_P12" | base64 --decode > "$CERT_PATH"
echo "$APPLE_API_KEY_P8" | base64 --decode > "$API_KEY_PATH"
chmod 600 "$CERT_PATH" "$API_KEY_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$CERT_PATH" -P "$MACOS_CERT_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" > /dev/null
# Il portachiavi temporaneo va primo nella lista di ricerca, tenendo gli altri.
security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')
rm -f "$CERT_PATH"

security find-identity -v -p codesigning "$KEYCHAIN"

{
	echo "SIGNING_KEYCHAIN=$KEYCHAIN"
	echo "ELECTROBUN_APPLEAPIKEYPATH=$API_KEY_PATH"
} >> "$GITHUB_ENV"
