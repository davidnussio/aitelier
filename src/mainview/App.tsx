import { useCallback, useEffect, useRef, useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { Settings, ThreadDetail, ThreadSummary } from "../shared/types";
import { call, onJobUpdate } from "./lib/rpc";
import { setAppInfo } from "./lib/media";
import { Sidebar } from "./components/Sidebar";
import { ThreadView } from "./components/ThreadView";
import { StylePanel } from "./components/StylePanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { NewThreadDialog } from "./components/NewThreadDialog";
import { Button, IconButton, Toaster, errorMessage, notify } from "./components/ui";

export function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const currentRef = useRef<string | null>(null);
  useEffect(() => {
    currentRef.current = currentId;
  }, [currentId]);

  const select = useCallback((id: string | null) => {
    setDetail(null);
    setCurrentId(id);
  }, []);

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await call("threadsList", {}));
    } catch (e) {
      notify(errorMessage(e));
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await call("settingsGet", {}));
    } catch (e) {
      notify(errorMessage(e));
    }
  }, []);

  const reloadThread = useCallback(async (id = currentRef.current) => {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      const next = await call("threadGet", { id });
      if (currentRef.current === id) setDetail(next);
    } catch (e) {
      notify(errorMessage(e));
    }
  }, []);

  // Avvio: informazioni dell'app, impostazioni, progetti. Senza chiave si apre subito Impostazioni.
  useEffect(() => {
    void (async () => {
      try {
        const info = await call("appInfo", {});
        setAppInfo(info);
        const [s, list] = await Promise.all([call("settingsGet", {}), call("threadsList", {})]);
        setSettings(s);
        setThreads(list);
        if (list[0]) select(list[0].id);
        if (!s.apiKey.set) setSettingsOpen(true);
      } catch (e) {
        notify(errorMessage(e));
      } finally {
        setReady(true);
      }
    })();
  }, [select]);

  useEffect(() => {
    void reloadThread(currentId);
  }, [currentId, reloadThread]);

  // Stato dei lavori in tempo reale dal processo principale.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return onJobUpdate((event) => {
      if (event.threadId === currentRef.current && !timer) {
        timer = setTimeout(() => {
          timer = null;
          void reloadThread();
        }, 120);
      }
      if (event.status === "done") {
        void refreshThreads();
        void refreshSettings();
      }
    });
  }, [reloadThread, refreshThreads, refreshSettings]);

  const createThread = async (title: string, contextNotes: string) => {
    try {
      const thread = await call("threadsCreate", { title, contextNotes });
      await refreshThreads();
      select(thread.id);
      setNewThreadOpen(false);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const deleteThread = async (id: string) => {
    try {
      await call("threadsDelete", { id });
      const list = await call("threadsList", {});
      setThreads(list);
      if (currentRef.current === id) select(list[0]?.id ?? null);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  if (!ready) return <div className="h-full bg-paper" />;

  const canGenerate = Boolean(settings?.apiKey.set);

  return (
    <div className="grid h-full grid-cols-[256px_minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)] overflow-hidden">
      <Sidebar
        threads={threads}
        currentId={currentId}
        settings={settings}
        onSelect={select}
        onNew={() => setNewThreadOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <main className="relative flex min-w-0 flex-col border-x border-line bg-paper">
        {detail ? (
          <ThreadView
            key={detail.thread.id}
            detail={detail}
            canGenerate={canGenerate}
            onChanged={() => {
              void reloadThread();
              void refreshThreads();
            }}
            onDelete={() => void deleteThread(detail.thread.id)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : currentId ? null : (
          <Welcome
            canGenerate={canGenerate}
            onNew={() => setNewThreadOpen(true)}
            onSettings={() => setSettingsOpen(true)}
          />
        )}
        {detail && (
          <IconButton
            label={panelOpen ? "Nascondi gli stili" : "Mostra gli stili"}
            className="absolute top-3 right-3"
            onClick={() => setPanelOpen((o) => !o)}
          >
            {panelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </IconButton>
        )}
      </main>

      {detail && panelOpen && (
        <StylePanel
          detail={detail}
          onChanged={() => {
            void reloadThread();
            void refreshThreads();
          }}
        />
      )}

      {settingsOpen && settings && (
        <SettingsDialog settings={settings} onClose={() => setSettingsOpen(false)} onChanged={setSettings} />
      )}
      {newThreadOpen && <NewThreadDialog onClose={() => setNewThreadOpen(false)} onCreate={createThread} />}
      <Toaster />
    </div>
  );
}

function Welcome({
  canGenerate,
  onNew,
  onSettings,
}: {
  canGenerate: boolean;
  onNew: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-md text-center">
        <p className="font-serif text-3xl">Benvenuti in bottega</p>
        <p className="mt-3 text-ink-2">
          Ogni progetto conserva fino a tre stili. Scegli lo stile, descrivi cosa vuoi, invia: le immagini di
          oggi e quelle del mese prossimo sembreranno della stessa mano.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          {canGenerate ? (
            <Button variant="primary" onClick={onNew}>
              Crea il primo progetto
            </Button>
          ) : (
            <Button variant="primary" onClick={onSettings}>
              Inserisci la chiave API
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
