import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, FolderOpen, KeyRound, RefreshCw, RotateCcw, Save } from "lucide-react";
import {
  BACKUP_REASON_LABEL,
  type BackupState,
  type EditableSettings,
  type Settings,
  type VerifyResult,
} from "../../shared/types";
import { call } from "../lib/rpc";
import { formatUsd } from "../lib/format";
import { Button, Dialog, Spinner, cx, errorMessage, notify } from "./ui";

export function SettingsDialog({
  settings,
  onClose,
  onChanged,
}: {
  settings: Settings;
  onClose: () => void;
  onChanged: (s: Settings) => void;
}) {
  const [replacing, setReplacing] = useState(!settings.apiKey.set);
  const [key, setKey] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [tab, setTab] = useState<"general" | "backup" | "log">("general");
  const [draft, setDraft] = useState<EditableSettings>(() => ({
    imageModel: settings.imageModel,
    preciseModel: settings.preciseModel,
    describeModel: settings.describeModel,
    textLanguage: settings.textLanguage,
  }));

  const verify = async (candidate?: string) => {
    setVerifying(true);
    setResult(null);
    try {
      setResult(await call("apiKeyVerify", { apiKey: candidate }));
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setVerifying(false);
    }
  };

  const save = async () => {
    try {
      onChanged(await call("apiKeySet", { apiKey: key }));
      setKey("");
      setReplacing(false);
      notify("Chiave salvata nel portachiavi del computer.", "info");
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const remove = async () => {
    try {
      onChanged(await call("apiKeyRemove", {}));
      setResult(null);
      setReplacing(true);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const saveAdvanced = async () => {
    try {
      onChanged(await call("settingsSet", draft));
      notify("Impostazioni salvate. Valgono per i nuovi progetti.", "info");
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const verifiedOk = result?.ok === true;

  return (
    <Dialog open onClose={onClose} title="Impostazioni" width={620}>
      <div role="tablist" className="-mt-1 mb-5 flex gap-1 border-b border-line">
        {(
          [
            ["general", "Generale"],
            ["backup", "Backup"],
            ["log", "Registro"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx(
              "-mb-px border-b-2 px-3 pb-2 text-[13.5px]",
              tab === id
                ? "border-accent font-medium text-ink"
                : "border-transparent text-ink-2 hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "backup" && <BackupTab />}
      {tab === "log" && <LogTab />}
      {tab === "general" && (
        <>
          <section>
            <h3 className="mb-1 flex items-center gap-2 font-medium">
              <KeyRound size={16} /> Chiave API OpenAI
            </h3>
            {settings.demo ? (
              <p className="text-[13px] text-ink-2">
                Modalità dimostrativa: le immagini sono disegnate in locale, senza OpenAI e senza costi.
              </p>
            ) : replacing ? (
              <>
                <p className="mb-2 text-[13px] text-ink-2">
                  Incollala qui. Resta su questo computer, nel portachiavi del sistema, e serve solo a parlare
                  con OpenAI.
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Chiave API OpenAI"
                    placeholder="sk-…"
                    value={key}
                    onChange={(e) => {
                      setKey(e.target.value);
                      setResult(null);
                    }}
                    className="h-9 flex-1 rounded-lg border border-line-2 bg-paper px-3 font-mono text-[13px] outline-none focus:border-ink-3"
                  />
                  <Button disabled={!key.trim() || verifying} onClick={() => void verify(key)}>
                    {verifying && <Spinner />} Verifica
                  </Button>
                  <Button variant="primary" disabled={!key.trim() || !verifiedOk} onClick={() => void save()}>
                    Salva
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-ink-3">
                  Non ce l'hai?{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void call("openExternal", { url: "https://platform.openai.com/api-keys" })}
                  >
                    Creala su platform.openai.com
                  </button>
                  . Per i modelli di immagini OpenAI può chiedere una verifica dell'organizzazione, da fare
                  una volta.
                </p>
                {settings.apiKey.set && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-ink-3 underline"
                    onClick={() => setReplacing(false)}
                  >
                    Annulla, tieni quella salvata
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-paper px-3 py-2 text-[13px]">
                  {settings.apiKey.masked}
                </code>
                <Button disabled={verifying} onClick={() => void verify()}>
                  {verifying && <Spinner />} Verifica
                </Button>
                <Button onClick={() => setReplacing(true)}>Sostituisci</Button>
                <Button variant="danger" onClick={() => void remove()}>
                  Rimuovi
                </Button>
              </div>
            )}
            {!settings.demo && settings.apiKey.storage === "file" && !replacing && (
              <p className="mt-1 text-xs text-ink-3">
                Il portachiavi non è disponibile: la chiave è in un file protetto nella cartella dati
                dell'app.
              </p>
            )}

            {result && (
              <div
                className={cx(
                  "mt-3 rounded-lg px-3 py-2 text-[13px]",
                  result.ok ? "bg-ok/10 text-ink" : "bg-danger/8 text-ink",
                )}
              >
                {result.ok ? (
                  <>
                    <p className="flex items-center gap-1.5 font-medium text-ok">
                      <CheckCircle2 size={15} /> La chiave funziona.
                    </p>
                    <p className="mt-1 text-xs text-ink-2">
                      Modelli di immagini disponibili: {result.imageModels.join(", ") || "nessuno"}
                    </p>
                    {result.imageModels.length > 0 && !result.imageModels.includes(draft.imageModel) && (
                      <p className="mt-1 text-xs text-danger">
                        Il modello predefinito «{draft.imageModel}» non è nell'elenco: sceglilo in Avanzate.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-medium text-danger">{result.error?.title}</p>
                    <p className="text-ink-2">{result.error?.detail}</p>
                    <p>{result.error?.action}</p>
                  </>
                )}
              </div>
            )}
          </section>

          <section className="mt-6 border-t border-line pt-4">
            <h3 className="mb-1 font-medium">Spesa</h3>
            <p className="text-[13px] text-ink-2">
              Questo mese: <b>{formatUsd(settings.monthCostUsd)}</b> (stima dai token di ogni immagine).
            </p>
          </section>

          <section className="mt-6 border-t border-line pt-4">
            <button
              type="button"
              aria-expanded={advanced}
              onClick={() => setAdvanced((a) => !a)}
              className="flex items-center gap-1 font-medium"
            >
              <ChevronDown size={15} className={cx("transition-transform", !advanced && "-rotate-90")} />{" "}
              Avanzate
            </button>
            {advanced && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-ink-3">
                  I modelli vengono fissati in ogni progetto alla sua creazione: cambiarli qui vale solo per i
                  progetti nuovi.
                </p>
                <ModelField
                  label="Modello veloce (immagini e prove)"
                  value={draft.imageModel}
                  options={result?.imageModels}
                  onChange={(imageModel) => setDraft({ ...draft, imageModel })}
                />
                <ModelField
                  label="Modello preciso (modifiche e infografiche)"
                  value={draft.preciseModel}
                  options={result?.imageModels}
                  onChange={(preciseModel) => setDraft({ ...draft, preciseModel })}
                />
                <ModelField
                  label="Modello che descrive gli stili"
                  value={draft.describeModel}
                  options={result?.textModels}
                  onChange={(describeModel) => setDraft({ ...draft, describeModel })}
                />
                <ModelField
                  label="Lingua dei testi nelle immagini"
                  value={draft.textLanguage}
                  options={["italiano", "inglese", "tedesco", "francese"]}
                  onChange={(textLanguage) => setDraft({ ...draft, textLanguage })}
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void saveAdvanced()}>
                    Salva avanzate
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
      <div className="mt-6 flex justify-end">
        <Button onClick={onClose}>Chiudi</Button>
      </div>
    </Dialog>
  );
}

function ModelField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options?: string[];
  onChange: (v: string) => void;
}) {
  const id = `list-${label.replace(/\W+/g, "-")}`;
  return (
    <label className="block text-[13px]">
      <span className="mb-1 block text-ink-2">{label}</span>
      <input
        aria-label={label}
        list={options ? id : undefined}
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-line-2 bg-paper px-3 font-mono text-[13px] outline-none focus:border-ink-3"
      />
      {options && (
        <datalist id={id}>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </datalist>
      )}
    </label>
  );
}

function BackupTab() {
  const [state, setState] = useState<BackupState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    call("backupsGet", {}).then(setState, (e) => notify(errorMessage(e)));
  }, []);

  const act = async (fn: () => Promise<BackupState>, after?: string) => {
    setBusy(true);
    try {
      setState(await fn());
      if (after) notify(after, "info");
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <Spinner />;
  const pending = state.backups.find((b) => b.name === state.pendingRestore);

  return (
    <section>
      <p className="text-[13px] text-ink-2">
        Bottega fa da sé un backup al giorno (tiene gli ultimi 10) e uno prima di ogni aggiornamento del
        database. Il backup contiene progetti, stili e immagini. Sta nella cartella dell'app: per proteggerti
        anche da un guasto del disco, copia ogni tanto la cartella su un disco esterno o nel cloud.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => void act(() => call("backupsCreate", {}), "Backup fatto.")}
        >
          {busy ? <Spinner /> : <Save size={15} />} Fai un backup ora
        </Button>
        <Button onClick={() => void call("backupsReveal", {}).catch((e) => notify(errorMessage(e)))}>
          <FolderOpen size={15} /> Apri la cartella
        </Button>
      </div>

      {pending && (
        <div className="mt-4 rounded-lg bg-accent/10 px-3 py-2 text-[13px]">
          <p className="font-medium">Ripristino pronto: {formatDate(pending.createdAt)}</p>
          <p className="text-ink-2">
            Chiudi Bottega (⌘Q) e riaprila: al riavvio torna tutto com'era in quel momento. Lo stato attuale
            viene salvato prima in un backup di sicurezza.
          </p>
          <button
            type="button"
            className="mt-1 text-xs text-accent underline"
            onClick={() => void act(() => call("backupsCancelRestore", {}), "Ripristino annullato.")}
          >
            Annulla il ripristino
          </button>
        </div>
      )}

      <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-line">
        {state.backups.length === 0 ? (
          <p className="px-3 py-4 text-[13px] text-ink-3">Nessun backup per ora.</p>
        ) : (
          <table className="w-full text-[13px]">
            <tbody>
              {state.backups.map((b) => (
                <tr key={b.name} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{formatDate(b.createdAt)}</div>
                    <div className="text-xs text-ink-3">{BACKUP_REASON_LABEL[b.reason]}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-2">
                    {b.threads} progetti · {b.styles} stili · {b.images} immagini
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(b.name)}>
                      <RotateCcw size={13} /> Ripristina…
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirm && (
        <Dialog open onClose={() => setConfirm(null)} title="Ripristinare questo backup?">
          <p className="text-ink-2">
            Progetti, stili e immagini torneranno com'erano il{" "}
            {formatDate(state.backups.find((b) => b.name === confirm)!.createdAt)}. Quello che hai fatto dopo
            non sparisce del tutto: prima del ripristino Bottega salva lo stato attuale in un backup di
            sicurezza. Il ripristino avviene alla prossima apertura dell'app.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button onClick={() => setConfirm(null)}>Annulla</Button>
            <Button
              variant="primary"
              onClick={() => {
                const name = confirm;
                setConfirm(null);
                void act(() => call("backupsRestore", { name }));
              }}
            >
              Ripristina al riavvio
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function LogTab() {
  const [log, setLog] = useState<{ file: string; text: string } | null>(null);
  const load = useCallback(() => call("logsRead", {}).then(setLog, (e) => notify(errorMessage(e))), []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <p className="text-[13px] text-ink-2">
        Il registro annota cosa fa l'app: generazioni, errori, backup. Serve se qualcosa non va. Le chiavi API
        non ci finiscono mai.
      </p>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => void load()}>
          <RefreshCw size={15} /> Aggiorna
        </Button>
        <Button onClick={() => void call("logsReveal", {}).catch((e) => notify(errorMessage(e)))}>
          <FolderOpen size={15} /> Mostra il file
        </Button>
      </div>
      <pre
        data-selectable
        className="mt-3 max-h-80 overflow-auto rounded-lg border border-line bg-paper px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2"
      >
        {log === null ? "…" : log.text || "Il registro è vuoto."}
      </pre>
    </section>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("it-CH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
