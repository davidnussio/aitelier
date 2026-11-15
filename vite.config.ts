import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import pkg from "./package.json";
// Proiettato da `electrobun prepare`: mappa gli import electrobun/* sul devkit.
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: [
      ...electrobunViteAliases(path.resolve(__dirname, ".hutch/devkit")),
      { find: "@", replacement: path.resolve(__dirname, "src/mainview") },
    ],
  },
  root: "src/mainview",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5291,
    strictPort: true,
  },
});
