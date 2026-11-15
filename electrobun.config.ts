import type { ElectrobunConfig } from "electrobun";
import pkg from "./package.json";

export default {
  app: {
    name: "Bottega",
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
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
