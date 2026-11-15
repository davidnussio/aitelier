import { useState } from "react";
import { ChevronDown, ImagePlus, Lock, LockOpen, Plus, RotateCw, Sparkles, Trash2, X } from "lucide-react";
import {
  DESCRIPTION_FIELDS,
  FORMAT_LABEL,
  QUALITY_LABEL,
  SLOT_LETTER,
  SLOTS,
  STYLE_COLORS,
  type Format,
  type Quality,
  type Slot,
  type Style,
  type StyleDescription,
  type StyleKind,
  type StyleParams,
  type ThreadDetail,
} from "../../shared/types";
import { call } from "../lib/rpc";
import { mediaUrl } from "../lib/media";
import { MAX_REFS } from "../lib/limits";
import { Button, Dialog, IconButton, Spinner, cx, errorMessage, notify } from "./ui";

export function StylePanel({ detail, onChanged }: { detail: ThreadDetail; onChanged: () => void }) {
  const bySlot = new Map(detail.styles.map((s) => [s.slot, s]));
  const full = detail.styles.length === 3;
  return (
    <aside aria-label="Stili del progetto" className="flex w-[340px] min-h-0 flex-col bg-paper-2/60">
      <div className="px-4 pt-4 pb-2">
        <h2 className="font-serif text-lg">Stili del progetto</h2>
        <p className="text-xs text-ink-3">
          Fino a tre. Ogni immagine riceve l'àncora e la descrizione del suo stile.
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4">
        {SLOTS.map((slot) => {
          const style = bySlot.get(slot);
          return style ? (
            <StyleCard key={style.id} style={style} onChanged={onChanged} />
          ) : (
            <EmptySlot
              key={slot}
              threadId={detail.thread.id}
              slot={slot}
              usedColors={detail.styles.map((s) => s.color)}
              onChanged={onChanged}
            />
          );
        })}
        {full && (
          <p className="px-1 text-xs text-ink-3">
            I tre slot sono pieni. Per uno stile nuovo svuotane uno (se non è bloccato) oppure apri un nuovo
            progetto.
          </p>
        )}
      </div>
    </aside>
  );
}

// --- Slot vuoto: creazione di uno stile ---

function EmptySlot({
  threadId,
  slot,
  usedColors,
  onChanged,
}: {
  threadId: string;
  slot: Slot;
  usedColors: string[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-2 p-3">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full border border-dashed border-line-2 text-[13px] font-semibold text-ink-3">
          {SLOT_LETTER[slot]}
        </span>
        <span className="flex-1 text-[13px] text-ink-3">Slot vuoto</span>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus size={14} /> Crea stile
        </Button>
      </div>
      {open && (
        <CreateStyleDialog
          threadId={threadId}
          slot={slot}
          defaultColor={STYLE_COLORS.find((c) => !usedColors.includes(c)) ?? STYLE_COLORS[slot - 1]!}
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function CreateStyleDialog({
  threadId,
  slot,
  defaultColor,
  onClose,
  onCreated,
}: {
  threadId: string;
  slot: Slot;
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
    name: name.trim() || (kind === "infografica" ? "Infografiche" : `Stile ${SLOT_LETTER[slot]}`),
    color,
    kind,
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === "brief") {
        await call("stylesCreateFromBrief", { threadId, slot, input, brief });
        notify("Sto preparando 3 prove: scegli in chat quella che diventa l'àncora.", "info");
        onCreated();
      } else {
        const style = await call("stylesCreateFromFile", { threadId, slot, input });
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
    <Dialog open onClose={onClose} title={`Nuovo stile ${SLOT_LETTER[slot]}`}>
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
              Creo 3 prove veloci; in chat scegli quella che diventa l'àncora dello stile.
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

function StyleCard({ style, onChanged }: { style: Style; onChanged: () => void }) {
  const [showDescription, setShowDescription] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
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
        <div className="flex items-center gap-2">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
            style={{ background: style.color }}
          >
            {SLOT_LETTER[style.slot]}
          </span>
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
        {locked && (
          <p className="mt-1 text-xs text-ink-3">
            Bloccato: non cambia per errore. Sbloccalo per modificarlo.
          </p>
        )}

        <div className="mt-3 flex gap-2">
          {style.refs.map((ref) => (
            <div
              key={ref.id}
              className="group relative size-[72px] overflow-hidden rounded-lg border border-line"
            >
              <img
                src={mediaUrl(ref.path)}
                alt="Immagine di riferimento"
                className="size-full object-cover"
              />
              {!locked && (
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
          {!locked && style.refs.length < MAX_REFS && (
            <button
              type="button"
              onClick={() => void run(() => call("stylesAddRefFromFile", { styleId: style.id }))}
              className="flex size-[72px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-2 text-[11px] text-ink-3 hover:border-ink-3 hover:text-ink-2"
            >
              <ImagePlus size={18} />
              Aggiungi
            </button>
          )}
        </div>

        <StyleStatus style={style} />

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
          <ChevronDown size={15} className={cx("transition-transform", !showDescription && "-rotate-90")} />
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

        {!locked && (
          <div className="mt-3 flex justify-end border-t border-line pt-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
              <Trash2 size={14} /> Svuota slot
            </Button>
          </div>
        )}
      </div>

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={`Svuotare lo slot ${SLOT_LETTER[style.slot]}?`}
      >
        <p className="text-ink-2">
          Lo stile «{style.name}» e le sue immagini di riferimento verranno tolti. Le immagini già generate
          restano in chat con la loro etichetta.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => setConfirmClear(false)}>Annulla</Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmClear(false);
              void run(() => call("stylesClear", { styleId: style.id }));
            }}
          >
            Svuota
          </Button>
        </div>
      </Dialog>
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
        <Sparkles size={13} /> Nessuna àncora: scegli una prova in chat con «Usa come àncora».
      </p>
    );
  }
  return null;
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
