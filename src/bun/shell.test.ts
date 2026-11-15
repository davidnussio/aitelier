import { afterAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startMediaServer } from "./media-server";
import { redact } from "./log";
import { maskKey } from "./secrets";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bottega-media-"));
fs.mkdirSync(path.join(dir, "images", "t1"), { recursive: true });
fs.writeFileSync(path.join(dir, "images", "t1", "a.png"), "png");
fs.mkdirSync(path.join(dir, "styles", "s1", "prove"), { recursive: true });
fs.writeFileSync(path.join(dir, "styles", "s1", "prove", "p1.webp"), "webp");
fs.writeFileSync(path.join(dir, "app.db"), "db");
fs.writeFileSync(path.join(dir, "secrets.json"), "{}");
const server = startMediaServer(dir);
afterAll(() => server.stop());

test("serve solo immagini della cartella dati e solo con il token", async () => {
  const ok = await fetch(`${server.url}/f/images/t1/a.png?t=${server.token}`);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("image/png");
  expect((await fetch(`${server.url}/f/styles/s1/prove/p1.webp?t=${server.token}`)).status).toBe(200);
  expect((await fetch(`${server.url}/f/images/t1/a.png?t=sbagliato`)).status).toBe(401);
  expect((await fetch(`${server.url}/f/app.db?t=${server.token}`)).status).toBe(404);
  expect((await fetch(`${server.url}/f/secrets.json?t=${server.token}`)).status).toBe(404);
  expect((await fetch(`${server.url}/f/images/..%2F..%2Fapp.db?t=${server.token}`)).status).toBe(404);
});

test("la chiave non finisce mai in chiaro nei log né nella webview", () => {
  expect(redact("errore con sk-proj-abcdefghijklmnop123")).toBe("errore con sk-***");
  expect(maskKey("sk-proj-abcdefghijklmnop1234")).toBe("sk-...1234");
});

test("finestra «Salva»: testo AppleScript sicuro, estensione e ripiego fuori da macOS", async () => {
  const { appleScriptString, chooseSavePath, saveDialogScript, withPngExtension } =
    await import("./save-dialog");
  expect(appleScriptString('Festa "di" Natale\\')).toBe('"Festa \\"di\\" Natale\\\\"');
  const script = saveDialogScript("Vulcani 2026-11-15 10.30.png", "/Users/x/Pictures");
  expect(script[1]).toContain('default name "Vulcani 2026-11-15 10.30.png"');
  expect(script[1]).toContain('POSIX file "/Users/x/Pictures"');
  expect(withPngExtension("/tmp/biglietto")).toBe("/tmp/biglietto.png");
  expect(withPngExtension("/tmp/biglietto.PNG")).toBe("/tmp/biglietto.PNG");
  const chosen = await chooseSavePath("a.png", "/start", {
    platform: "linux",
    chooseFolder: async (start) => `${start}/scelta`,
  });
  expect(chosen).toBe("/start/scelta/a.png");
  expect(
    await chooseSavePath("a.png", "/start", { platform: "win32", chooseFolder: async () => null }),
  ).toBeNull();
});
