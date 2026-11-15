import { useState } from "react";
import { CheckCircle2, ChevronDown, KeyRound } from "lucide-react";
import type { EditableSettings, Settings, VerifyResult } from "../../shared/types";
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
    <Dialog open onClose={onClose} title="Impostazioni" width={560}>
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
              Incollala qui. Resta su questo computer, nel portachiavi del sistema, e serve solo a parlare con
              OpenAI.
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
              . Per i modelli di immagini OpenAI può chiedere una verifica dell'organizzazione, da fare una
              volta.
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
            <code className="flex-1 rounded-lg bg-paper px-3 py-2 text-[13px]">{settings.apiKey.masked}</code>
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
            Il portachiavi non è disponibile: la chiave è in un file protetto nella cartella dati dell'app.
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
          <ChevronDown size={15} className={cx("transition-transform", !advanced && "-rotate-90")} /> Avanzate
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
