#!/usr/bin/env bash
# Esporta l'identità Developer ID dal portachiavi login e la carica su
# davidnussio/aitelier come MACOS_CERT_P12, insieme alla sua password come
# MACOS_CERT_PASSWORD, poi cancella il file esportato. I due secret nascono
# dalla stessa password, quindi non possono divergere. Da rifare a ogni
# rinnovo del certificato.
set -euo pipefail

REPO="davidnussio/aitelier"

read -r -s -p "Password del .p12 (nuova, usata solo per questa esportazione): " P12_PASSWORD
echo
read -r -s -p "Ripeti la password: " P12_PASSWORD_CHECK
echo
if [[ -z "$P12_PASSWORD" || "$P12_PASSWORD" != "$P12_PASSWORD_CHECK" ]]; then
	echo "Password vuota o diversa, non ho cambiato nulla." >&2
	exit 1
fi
export P12_PASSWORD

P12="$(mktemp -d)/developer-id.p12"
trap 'rm -f "$P12"' EXIT

echo "Esporto l'identità Developer ID (macOS può chiedere la password del portachiavi)..."
security export -k login.keychain-db -t identities -f pkcs12 -P "$P12_PASSWORD" -o "$P12"

if [[ ! -s "$P12" ]]; then
	echo "Esportazione fallita: il file manca o è vuoto, secret non modificati." >&2
	exit 1
fi
# Lo stesso controllo dell'import in CI: la password deve aprire il file.
if ! /usr/bin/openssl pkcs12 -in "$P12" -noout -passin env:P12_PASSWORD 2>/dev/null; then
	echo "La password non apre il .p12 esportato, secret non modificati." >&2
	exit 1
fi

base64 -i "$P12" | gh secret set MACOS_CERT_P12 --repo "$REPO"
printf '%s' "$P12_PASSWORD" | gh secret set MACOS_CERT_PASSWORD --repo "$REPO"
echo "Fatto: MACOS_CERT_P12 e MACOS_CERT_PASSWORD aggiornati, file esportato cancellato."
echo "Controlla le date con: gh secret list --repo $REPO"
