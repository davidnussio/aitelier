#!/usr/bin/env bash
# Esporta l'identità Developer ID dal portachiavi login e la carica nel secret
# MACOS_CERT_P12 di davidnussio/aitelier, poi cancella il file esportato.
#
# Usa la stessa password del .p12 salvata nel secret MACOS_CERT_PASSWORD (se ne
# scegli una nuova, poi esegui `gh secret set MACOS_CERT_PASSWORD`).
# Da rifare a ogni rinnovo del certificato.
set -euo pipefail

REPO="davidnussio/aitelier"
P12="$(mktemp -d)/developer-id.p12"
trap 'rm -f "$P12"' EXIT

echo "Esporto l'identità Developer ID (macOS chiede la password del .p12, poi quella del portachiavi)..."
security export -k login.keychain-db -t identities -f pkcs12 -o "$P12"

if [[ ! -s "$P12" ]]; then
	echo "Esportazione fallita: $P12 manca o è vuoto, secret non modificato." >&2
	exit 1
fi

base64 -i "$P12" | gh secret set MACOS_CERT_P12 --repo "$REPO"
echo "Fatto: MACOS_CERT_P12 aggiornato, file esportato cancellato. Controlla con: gh secret list --repo $REPO"
