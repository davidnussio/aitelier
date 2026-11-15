import { defineConfig, mergeConfig } from "vite";
import path from "node:path";
import base from "./vite.config";

/** Build per l'anteprima nel browser: il ponte RPC passa da HTTP (scripts/preview.ts). */
export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: [
        {
          find: /^\.{1,2}\/lib\/rpc$/,
          replacement: path.resolve(__dirname, "src/mainview/lib/rpc.preview.ts"),
        },
      ],
    },
    build: { outDir: "../../dist-preview", emptyOutDir: true },
  }),
);
