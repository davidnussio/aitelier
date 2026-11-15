/**
 * Guscio desktop Electrobun: finestra, menu, RPC. Possiede database, file,
 * chiave e chiamate a OpenAI; la webview non ha accesso a rete, disco o chiave.
 */
import Electrobun, { ApplicationMenu, BrowserView, BrowserWindow, Updater, Utils } from "electrobun/main";
import fs from "node:fs";
import path from "node:path";
import { Backups } from "../core/backup";
import { Db, SCHEMA_VERSION } from "../core/db";
import { FakeProvider } from "../core/fake-provider";
import { Files } from "../core/files";
import { OpenAIProvider } from "../core/openai";
import { Studio } from "../core/studio";
import type { BottegaRPC } from "../shared/rpc";
import type { JobEvent } from "../shared/types";
import { createHandlers } from "./handlers";
import { chooseSavePath } from "./save-dialog";
import { createLogger } from "./log";
import { startMediaServer } from "./media-server";
import { SecretStore } from "./secrets";
import pkg from "../../package.json";

/** Porta dedicata: la 5173 è spesso occupata dal Vite di altri progetti. */
const DEV_SERVER_URL = "http://localhost:5291";
const RPC_TIMEOUT_MS = 60_000;

const dataDir = process.env.BOTTEGA_HOME || Utils.paths.userData;
fs.mkdirSync(dataDir, { recursive: true });
const log = createLogger(path.join(dataDir, "logs"));
process.on("uncaughtException", (error) => log.error("Eccezione non gestita", error));
process.on("unhandledRejection", (reason) => log.error("Promise rifiutata non gestita", reason));

const demo = process.env.BOTTEGA_FAKE_OPENAI === "1";
const secrets = new SecretStore({
  service: process.env.BOTTEGA_SECRETS_SERVICE || "ch.dambox.bottega",
  dataDir,
  log: (m, e) => log.warn(m, e),
});
const provider = demo ? new FakeProvider() : new OpenAIProvider({ getApiKey: () => secrets.get() });

// Prima di aprire il database: ripristino prenotato, poi backup se lo schema
// sta per essere aggiornato da una migrazione.
const backups = new Backups(dataDir);
try {
  const restored = backups.applyPendingRestore();
  if (restored) log.info(`Ripristinato il backup ${restored.name}`);
} catch (error) {
  log.error("Ripristino non riuscito", error);
}
const dbPath = path.join(dataDir, "app.db");
const schemaVersion = Db.versionOf(dbPath);
if (schemaVersion > 0 && schemaVersion < SCHEMA_VERSION) {
  const info = backups.create("prima-della-migrazione");
  log.info(`Schema ${schemaVersion} → ${SCHEMA_VERSION}: backup ${info.name}`);
}
const db = new Db(dbPath);
const files = new Files(dataDir);
/** Collegato alla finestra appena esiste. */
let sendJobUpdate: (event: JobEvent) => void = () => {};

const studio = new Studio({
  db,
  files,
  provider,
  emit: (event) => sendJobUpdate(event),
  log: (m, e) => log.warn(m, e),
  info: (m) => log.info(m),
});
studio.recoverInterrupted();

const media = startMediaServer(dataDir);

async function pickImage(): Promise<Uint8Array | null> {
  const [file] = await Utils.openFileDialog({
    startingFolder: Utils.paths.pictures,
    allowedFileTypes: "png,jpg,jpeg,webp,heic",
    canChooseFiles: true,
    canChooseDirectory: false,
    allowsMultipleSelection: false,
  });
  if (!file) return null;
  return new Uint8Array(await Bun.file(file).arrayBuffer());
}

const rpc = BrowserView.defineRPC<BottegaRPC>({
  maxRequestTime: RPC_TIMEOUT_MS,
  handlers: {
    requests: createHandlers({
      studio,
      files,
      provider,
      secrets,
      backups,
      demo,
      info: () => ({ version: pkg.version, mediaBase: media.url, mediaToken: media.token, demo, dataDir }),
      picturesDir: Utils.paths.pictures,
      chooseSavePath: (name, dir) =>
        chooseSavePath(name, dir, {
          platform: process.platform,
          chooseFolder: async (startingFolder) => {
            const [folder] = await Utils.openFileDialog({
              startingFolder,
              canChooseFiles: false,
              canChooseDirectory: true,
              allowsMultipleSelection: false,
            });
            return folder ?? null;
          },
        }),
      pickImage,
      showItemInFolder: (p) => Utils.showItemInFolder(p),
      openExternal: (url) => Utils.openExternal(url),
      log,
    }),
    messages: {
      webviewLog: ({ level, message }) => log[level](`[webview] ${message}`),
    },
  },
});

ApplicationMenu.setApplicationMenu([
  {
    label: "Bottega",
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide", accelerator: "CmdOrCtrl+H" },
      { role: "hideOthers", accelerator: "CmdOrCtrl+Alt+H" },
      { role: "showAll" },
      { type: "separator" },
      { role: "quit", accelerator: "CmdOrCtrl+Q" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  {
    label: "Window",
    submenu: [
      { role: "minimize", accelerator: "CmdOrCtrl+M" },
      { role: "zoom" },
      { role: "toggleFullScreen", accelerator: "Ctrl+CmdOrCtrl+F" },
      { type: "separator" },
      { role: "close", accelerator: "CmdOrCtrl+W" },
    ],
  },
]);

const channel = await Updater.localInfo.channel();

async function mainViewUrl(): Promise<string> {
  if (channel === "dev") {
    try {
      const res = await fetch(DEV_SERVER_URL, { signal: AbortSignal.timeout(800) });
      // Solo se è davvero il Vite di Bottega.
      if (!(await res.text()).includes("<title>Bottega</title>")) throw new Error("altro server");
      log.info(`HMR attivo: ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      // Vite non è in esecuzione: si usa la build.
    }
  }
  return "views://mainview/index.html";
}

const mainWindow = new BrowserWindow({
  title: "Bottega",
  url: await mainViewUrl(),
  frame: { width: 1360, height: 860, x: 80, y: 60 },
  rpc,
});
sendJobUpdate = (event) => mainWindow.webview.rpc?.send.jobUpdate(event);

// Backup automatico giornaliero, lontano dall'avvio.
setTimeout(() => {
  try {
    const info = backups.autoIfDue();
    if (info) log.info(`Backup automatico: ${info.name}`);
  } catch (error) {
    log.error("Backup automatico non riuscito", error);
  }
}, 10_000);

Electrobun.events.on("before-quit", () => {
  log.info("Chiusura");
  media.stop();
  db.close();
});

log.info(`Bottega ${pkg.version} (${channel}${demo ? ", demo" : ""}) avviata. Dati: ${dataDir}`);
