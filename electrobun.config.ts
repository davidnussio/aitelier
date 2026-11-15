import type { ElectrobunConfig } from "electrobun";
import pkg from "./package.json";

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
    mac: { bundleCEF: false },
    linux: { bundleCEF: false, icon: "assets/icon.png" },
    win: { bundleCEF: false, icon: "assets/icon.ico" },
  },
  release: {
    // Il programma di aggiornamento legge da qui le release pubblicate.
    baseUrl: "https://github.com/davidnussio/aitelier/releases/latest/download",
    generatePatch: true,
  },
} satisfies ElectrobunConfig;
