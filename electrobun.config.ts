import type { ElectrobunConfig } from "electrobun";
import pkg from "./package.json";

// Firma Developer ID (dambox Sagl) e notarizzazione Apple: in CI le attiva
// release.yml con le variabili ELECTROBUN_DEVELOPER_ID, ELECTROBUN_APPLEAPIKEY,
// ELECTROBUN_APPLEAPIISSUER, ELECTROBUN_APPLEAPIKEYPATH. Senza
// ELECTROBUN_DEVELOPER_ID una build locale resta non firmata invece di fermarsi;
// con ELECTROBUN_SKIP_NOTARIZATION=1 firma senza notarizzare.
const sign = Boolean(process.env.ELECTROBUN_DEVELOPER_ID);

export default {
  app: {
    name: "AItelier",
    // Resta quello di Bottega (≤ 0.1.0): cartella dati, portachiavi e aggiornamenti dipendono da qui.
    identifier: "ch.dambox.bottega",
    version: pkg.version,
  },
  build: {
    // bun:sqlite, Bun.secrets e Bun.Image richiedono il runtime Bun vero (non Cottontail).
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    // Vite costruisce in dist/, da lì si copia nel pacchetto.
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
    },
    watchIgnore: ["dist/**"],
    // Icona macOS: icon.iconset (predefinito). Sorgente: assets/icon-source.webp.
    mac: { bundleCEF: false, codesign: sign, notarize: sign },
    linux: { bundleCEF: false, icon: "assets/icon.png" },
    win: { bundleCEF: false, icon: "assets/icon.ico" },
  },
  release: {
    // Il programma di aggiornamento legge da qui le release pubblicate.
    baseUrl: "https://github.com/davidnussio/aitelier/releases/latest/download",
    generatePatch: true,
  },
} satisfies ElectrobunConfig;
