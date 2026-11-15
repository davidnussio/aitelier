import { type ReactNode, useState } from "react";
import { Anchor, ChevronDown, ImagePlus, Lock, LockOpen, RotateCw, Sparkles, X } from "lucide-react";
import {
  DESCRIPTION_FIELDS,
  FORMAT_LABEL,
  QUALITY_LABEL,
  STYLE_COLORS,
  type Format,
  type Quality,
  type Style,
  type StyleDescription,
  type StyleKind,
  type StyleParams,
} from "../../shared/types";
import { call } from "../lib/rpc";
import { mediaUrl } from "../lib/media";
import { MAX_REFS } from "../lib/limits";
import { Button, Dialog, IconButton, Spinner, cx, errorMessage, notify } from "./ui";

/** Il primo colore non ancora usato, per distinguere gli stili a colpo d'occhio. */
export function nextColor(used: string[]): string {
  return STYLE_COLORS.find((c) => !used.includes(c)) ?? STYLE_COLORS[used.length % STYLE_COLORS.length]!;
}

export function CreateStyleDialog({
  threadId,
  defaultColor,
  onClose,
  onCreated,
}: {
  /** null = dalla libreria: solo da immagine, le prove servono un progetto. */
  threadId: string | null;
  defaultColor: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"brief" | "file">("brief");
  const [name, setName] = useState("");
  const [color, setColor] = useState(defaultColor);
  const [kind, setKind] = useState<StyleKind>("illustrazione");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);

  const input = {
    name: name.trim() || (kind === "infografica" ? "Infografiche" : ""),
    color,
    kind,
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "brief") {
        await call("stylesCreateFromBrief", { threadId, input, brief });
        notify(
          threadId
            ? "Sto preparando 3 prove: scegli in chat quella che diventa l'àncora."
            : "Sto preparando 3 prove: compaiono nella scheda dello stile, lì scegli l'àncora.",
          "info",
        );
        onCreated();
      } else {
        const style = await call("stylesCreateFromFile", { threadId, input });
        if (style) {
          notify("Stile creato. Sto ricavando la descrizione dall'immagine…", "info");
          onCreated();
        }
      }
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Nuovo stile">
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <label className="block text-[13px]">
            <span className="mb-1 block text-ink-2">Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "infografica" ? "Infografiche" : "Es. Sezioni"}
              className="h-9 w-full rounded-lg border border-line-2 bg-paper px-3 outline-none focus:border-ink-3"
            />
          </label>
          <div className="text-[13px]">
            <span className="mb-1 block text-ink-2">Colore</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>

        <div className="text-[13px]">
          <span className="mb-1 block text-ink-2">Per</span>
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: "illustrazione", label: "Illustrazioni" },
              { value: "infografica", label: "Infografiche" },
            ]}
          />
          {kind === "infografica" && (
            <p className="mt-1 text-xs text-ink-3">
              Qualità alta e modello preciso: il testo leggibile ne dipende.
            </p>
          )}
        </div>

        <div className="text-[13px]">
          <span className="mb-1 block text-ink-2">Parti da</span>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "brief", label: "Una descrizione" },
              { value: "file", label: "Un'immagine che ho" },
            ]}
          />
        </div>

        {mode === "brief" ? (
          <label className="block text-[13px]">
            <span className="mb-1 block text-ink-2">Come deve essere lo stile?</span>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={3}
              placeholder="Es. acquerello morbido, colori pastello, contorni a matita"
              className="w-full rounded-lg border border-line-2 bg-paper px-3 py-2 outline-none focus:border-ink-3"
            />
            <span className="mt-1 block text-xs text-ink-3">
              {threadId
                ? "Creo 3 prove veloci; in chat scegli quella che diventa l'àncora dello stile."
                : "Creo 3 prove veloci; nella scheda dello stile scegli quella che diventa l'àncora."}
            </span>
          </label>
        ) : (
          <p className="rounded-lg bg-paper px-3 py-2 text-xs text-ink-2">
            Scegli un'immagine dal computer: diventa l'àncora e ne ricavo la descrizione dello stile. Puoi
            anche usare un'immagine già in chat dal menu ••• › Usa come stile.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Annulla</Button>
          <Button
            variant="primary"
            disabled={busy || (mode === "brief" && !brief.trim())}
            onClick={() => void submit()}
          >
            {busy && <Spinner />}
            {mode === "brief" ? "Genera 3 prove" : "Scegli immagine…"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// --- Stile esistente ---

/**
 * Scheda di uno stile: intestazione e àncore sempre visibili, il resto
 * (parametri, descrizione, azioni) si apre con un clic.
 */
export function StyleCard({
  style,
  onChanged,
  actions,
  defaultOpen = false,
}: {
  style: Style;
  onChanged: () => void;
  /** Azioni in fondo alla scheda aperta (togli dal progetto, duplica, elimina…). */
  actions?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showDescription, setShowDescription] = useState(false);
  const locked = style.locked;

  const run = async (fn: () => Promise<unknown>, after?: string) => {
    try {
      await fn();
      if (after) notify(after, "info");
      onChanged();
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const update = (patch: Parameters<typeof call<"stylesUpdate">>[1]["patch"]) =>
    run(() => call("stylesUpdate", { styleId: style.id, patch }));

  const setParam = <K extends keyof StyleParams>(key: K, value: StyleParams[K]) =>
    update({ params: { ...style.params, [key]: value } });

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-card shadow-card">
      <div className="h-1.5" style={{ background: style.color }} />
      <div className="p-3">
        <div className="flex items-center gap-1">
          <IconButton
            label={open ? "Chiudi i dettagli" : "Apri i dettagli"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="size-7"
          >
            <ChevronDown size={16} className={cx("transition-transform", !open && "-rotate-90")} />
          </IconButton>
          <span className="size-3 shrink-0 rounded-full" style={{ background: style.color }} />
          <InlineName
            key={style.name}
            value={style.name}
            disabled={locked}
            onSave={(name) => update({ name })}
          />
          <IconButton
            label={locked ? "Sblocca lo stile" : "Blocca lo stile"}
            onClick={() => void update({ locked: !locked })}
            className={locked ? "text-ink" : ""}
          >
            {locked ? <Lock size={16} /> : <LockOpen size={16} />}
          </IconButton>
        </div>

        <div className="mt-2 flex gap-2">
          {style.refs.map((ref) => (
            <div
              key={ref.id}
              className="group relative size-16 overflow-hidden rounded-lg border border-line"
            >
              <img
                src={mediaUrl(ref.path)}
                alt="Immagine di riferimento"
                className="size-full object-cover"
              />
              {!locked && open && (
                <button
                  type="button"
                  aria-label="Togli questo riferimento"
                  onClick={() => void run(() => call("stylesRemoveRef", { refId: ref.id }))}
                  className="absolute top-1 right-1 hidden rounded-full bg-ink/70 p-0.5 text-white group-hover:block"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          {!locked && open && style.refs.length < MAX_REFS && (
            <button
              type="button"
              onClick={() => void run(() => call("stylesAddRefFromFile", { styleId: style.id }))}
              className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-2 text-[11px] text-ink-3 hover:border-ink-3 hover:text-ink-2"
            >
              <ImagePlus size={16} />
              Aggiungi
            </button>
          )}
        </div>

        <StyleStatus style={style} />

        {style.trials.length > 0 && <TrialsSection style={style} run={run} />}

        {open && (
          <>
            {locked && (
              <p className="mt-2 text-xs text-ink-3">
                Bloccato: non cambia per errore. Sbloccalo per modificarlo.
              </p>
            )}
            <p className="mt-2 text-xs text-ink-3">
              {style.projectCount === 0
                ? "Non è usato in nessun progetto."
                : style.projectCount === 1
                  ? "Usato in 1 progetto."
                  : `Usato in ${style.projectCount} progetti: le modifiche valgono per tutti.`}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <SmallSelect
                label="Formato"
                value={style.params.format}
                disabled={locked}
                options={Object.entries(FORMAT_LABEL) as [Format, string][]}
                onChange={(v) => void setParam("format", v)}
              />
              <SmallSelect
                label="Qualità"
                value={style.params.quality}
                disabled={locked}
                options={Object.entries(QUALITY_LABEL) as [Quality, string][]}
                onChange={(v) => void setParam("quality", v)}
              />
              <SmallSelect
                label="Modello"
                value={style.params.model}
                disabled={locked}
                options={[
                  ["veloce", "Veloce"],
                  ["preciso", "Preciso"],
                ]}
                onChange={(v) => void setParam("model", v)}
              />
              <label className="flex items-end gap-2 pb-1.5 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={style.params.transparent}
                  disabled={locked}
                  onChange={(e) => void setParam("transparent", e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                Sfondo trasparente
              </label>
            </div>

            <button
              type="button"
              onClick={() => setShowDescription((s) => !s)}
              className="mt-3 flex w-full items-center gap-1 text-left text-[13px] font-medium text-ink-2 hover:text-ink"
              aria-expanded={showDescription}
            >
              <ChevronDown
                size={15}
                className={cx("transition-transform", !showDescription && "-rotate-90")}
              />
              Descrizione dello stile
            </button>
            {showDescription && (
              <DescriptionEditor
                key={JSON.stringify(style.description)}
                style={style}
                onSave={(description) => update({ description })}
                onRedescribe={() =>
                  void run(
                    () => call("stylesRedescribe", { styleId: style.id }),
                    "Sto rigenerando la descrizione…",
                  )
                }
              />
            )}

            {actions && (
              <div className="mt-3 flex flex-wrap justify-end gap-1 border-t border-line pt-2">{actions}</div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function StyleStatus({ style }: { style: Style }) {
  if (style.describing) {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-ink-2">
        <Spinner className="size-3" /> Sto studiando lo stile per descriverlo…
      </p>
    );
  }
  if (style.describeError) {
    return (
      <p className="mt-2 text-xs text-danger">
        {style.describeError.title}. {style.describeError.action}
      </p>
    );
  }
  if (style.refs.length === 0) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-2">
        <Sparkles size={13} />
        {style.trials.length > 0
          ? "Nessuna àncora: scegli una delle prove qui sotto."
          : "Nessuna àncora: scegli una prova in chat con «Usa come àncora»."}
      </p>
    );
  }
  return null;
}

/** Prove generate dalla descrizione nella libreria: si sceglie l'àncora qui. */
function TrialsSection({
  style,
  run,
}: {
  style: Style;
  run: (fn: () => Promise<unknown>, after?: string) => Promise<void>;
}) {
  const busy = style.trials.some((t) => t.status === "queued" || t.status === "running");
  const canAnchor = !style.locked && style.refs.length < MAX_REFS;
  return (
    <div className="mt-3 rounded-lg bg-paper p-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Prove</span>
        {!style.locked && style.brief && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => call("stylesGenerateTrials", { styleId: style.id }))}
          >
            <RotateCw size={13} /> Altre 3 prove
          </Button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {style.trials.map((trial) => {
          const [w, h] = trial.size.split("x").map(Number) as [number, number];
          if (trial.status === "queued" || trial.status === "running") {
            return (
              <div
                key={trial.id}
                className="shimmer flex items-center justify-center rounded-md border border-line"
                style={{ aspectRatio: `${w} / ${h}` }}
              >
                <Spinner className="size-3 text-ink-3" />
              </div>
            );
          }
          if (trial.status === "failed") {
            return (
              <div
                key={trial.id}
                title={trial.error ? `${trial.error.detail} ${trial.error.action}` : undefined}
                className="group relative flex flex-col items-center justify-center gap-1 rounded-md border border-danger/25 bg-card p-1 text-center text-[10.5px] text-danger"
                style={{ aspectRatio: `${w} / ${h}` }}
              >
                {trial.error?.title ?? "Non riuscita"}
                <TrialDelete trialId={trial.id} run={run} />
              </div>
            );
          }
          return (
            <div key={trial.id} className="group relative overflow-hidden rounded-md border border-line">
              <img
                src={mediaUrl(trial.thumbPath)}
                alt="Prova dello stile"
                className="w-full object-cover"
                style={{ aspectRatio: `${w} / ${h}` }}
              />
              {canAnchor && (
                <button
                  type="button"
                  title="Usa questa prova come àncora dello stile"
                  onClick={() =>
                    void run(
                      () => call("stylesUseTrial", { trialId: trial.id }),
                      `Àncora aggiunta a «${style.name}». Sto ricavando la descrizione dello stile…`,
                    )
                  }
                  className="absolute inset-x-1 bottom-1 hidden items-center justify-center gap-1 rounded-md bg-accent px-1 py-1 text-[11px] font-medium text-white group-hover:flex focus-visible:flex"
                >
                  <Anchor size={12} /> Àncora
                </button>
              )}
              <TrialDelete trialId={trial.id} run={run} />
            </div>
          );
        })}
      </div>
      {canAnchor && style.refs.length === 0 && (
        <p className="mt-2 text-xs text-ink-3">
          Passa sopra una prova e premi «Àncora» per usarla come riferimento dello stile.
        </p>
      )}
    </div>
  );
}

function TrialDelete({
  trialId,
  run,
}: {
  trialId: string;
  run: (fn: () => Promise<unknown>, after?: string) => Promise<void>;
}) {
  return (
    <button
      type="button"
      aria-label="Elimina questa prova"
      onClick={() => void run(() => call("stylesDeleteTrial", { trialId }))}
      className="absolute top-1 right-1 hidden rounded-full bg-ink/70 p-0.5 text-white group-hover:block focus-visible:block"
    >
      <X size={12} />
    </button>
  );
}

function DescriptionEditor({
  style,
  onSave,
  onRedescribe,
}: {
  style: Style;
  onSave: (d: StyleDescription) => Promise<unknown>;
  onRedescribe: () => void;
}) {
  const empty: StyleDescription = {
    tecnica: style.brief,
    palette: "",
    tratto: "",
    luce: "",
    composizione: "",
    tipografia: "",
    impaginazione: "",
    daEvitare: "",
  };
  const [draft, setDraft] = useState<StyleDescription>(style.description ?? empty);
  const dirty = JSON.stringify(draft) !== JSON.stringify(style.description ?? empty);
  const fields = DESCRIPTION_FIELDS.filter(
    (f) => f.key !== "impaginazione" || style.params.kind === "infografica",
  );

  return (
    <div className="mt-2 space-y-2">
      {fields.map(({ key: field, label }) => (
        <label key={field} className="block">
          <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</span>
          <textarea
            value={draft[field]}
            disabled={style.locked}
            rows={field === "palette" ? 3 : 2}
            onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
            className="mt-0.5 w-full resize-y rounded-md border border-line bg-paper px-2 py-1 text-xs leading-relaxed outline-none focus:border-ink-3 disabled:opacity-70"
          />
        </label>
      ))}
      {!style.locked && (
        <div className="flex gap-2">
          <Button size="sm" variant="primary" disabled={!dirty} onClick={() => void onSave(draft)}>
            Salva descrizione
          </Button>
          <Button size="sm" disabled={style.refs.length === 0 || style.describing} onClick={onRedescribe}>
            <RotateCw size={13} /> Rigenera dall'àncora
          </Button>
        </div>
      )}
    </div>
  );
}

// --- Piccoli controlli ---

function InlineName({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled: boolean;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      aria-label="Nome dello stile"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onSave(draft)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 font-medium outline-none hover:bg-paper-2 focus:bg-paper disabled:hover:bg-transparent"
    />
  );
}

function SmallSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-xs text-ink-3">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-0.5 block w-full rounded-md border border-line bg-paper px-1.5 py-1 text-xs text-ink outline-none disabled:opacity-70"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div role="radiogroup" className="inline-flex rounded-lg border border-line-2 bg-paper p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md px-3 py-1 text-[13px]",
            value === o.value ? "bg-card font-medium text-ink shadow-card" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Colore" className="flex h-9 items-center gap-1">
      {STYLE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cx(
            "size-5 rounded-full",
            value === c && "ring-2 ring-ink ring-offset-2 ring-offset-card",
          )}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}
