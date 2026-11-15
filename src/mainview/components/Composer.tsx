import { useEffect, useRef, useState } from "react";
import { ArrowUp, CornerDownRight, X } from "lucide-react";
import {
  FORMAT_LABEL,
  SLOT_LETTER,
  SLOTS,
  type Format,
  type GeneratedImage,
  type Slot,
  type Style,
  type Thread,
} from "../../shared/types";
import { call } from "../lib/rpc";
import { mediaUrl } from "../lib/media";
import { cx, errorMessage, notify } from "./ui";

const VARIANTS = [1, 2, 4] as const;

export function Composer({
  thread,
  styles,
  replyTo,
  canGenerate,
  onCancelReply,
  onSent,
  onOpenSettings,
}: {
  thread: Thread;
  styles: Style[];
  replyTo: GeneratedImage | null;
  canGenerate: boolean;
  onCancelReply: () => void;
  onSent: () => void;
  onOpenSettings: () => void;
}) {
  const bySlot = new Map(styles.map((s) => [s.slot, s]));
  const initialSlot = (): Slot | null => {
    if (thread.lastSlot && bySlot.has(thread.lastSlot)) return thread.lastSlot;
    return styles[0]?.slot ?? null;
  };
  const [slot, setSlot] = useState<Slot | null>(initialSlot);
  const [text, setText] = useState("");
  const [format, setFormat] = useState<Format | null>(null);
  const [variants, setVariants] = useState<1 | 2 | 4>(1);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  // Il primo stile creato diventa quello attivo; uno stile svuotato non resta selezionato.
  const styleSlots = styles.map((s) => s.slot).join(",");
  useEffect(() => {
    setSlot((current) => {
      if (current && bySlot.has(current)) return current;
      return styles[0]?.slot ?? null;
    });
    // eslint-disable-next-line react/exhaustive-deps
  }, [styleSlots]);

  // Rispondendo a un'immagine si propone il suo stile.
  useEffect(() => {
    if (!replyTo) return;
    const style = styles.find((s) => s.id === replyTo.styleId);
    if (style) setSlot(style.slot);
    input.current?.focus();
    // eslint-disable-next-line react/exhaustive-deps
  }, [replyTo]);

  const active = slot ? bySlot.get(slot) : undefined;
  const color = active?.color ?? "#d3c7b7";
  const defaultFormat = active?.params.format ?? "landscape";

  const send = async () => {
    if (!text.trim() || sending) return;
    if (!canGenerate) {
      onOpenSettings();
      return;
    }
    setSending(true);
    try {
      await call("messagesSend", {
        threadId: thread.id,
        text,
        slot: active ? slot : null,
        format,
        variants,
        parentImageId: replyTo?.id ?? null,
      });
      setText("");
      onSent();
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };

  return (
    <div className="border-t border-line bg-paper px-6 pt-3 pb-4">
      <div className="mx-auto max-w-[900px]">
        <div role="radiogroup" aria-label="Stile" className="mb-2 flex flex-wrap items-center gap-1.5">
          {SLOTS.map((s) => {
            const style = bySlot.get(s);
            const selected = slot === s && Boolean(style);
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!style}
                onClick={() => setSlot(s)}
                title={style ? `Stile ${SLOT_LETTER[s]}: ${style.name}` : `Slot ${SLOT_LETTER[s]} vuoto`}
                className={cx(
                  "flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-all",
                  !style && "border-dashed border-line-2 text-ink-3",
                  style && !selected && "border-line-2 bg-card text-ink-2 hover:border-current",
                  selected && "text-white shadow-card",
                )}
                style={
                  style
                    ? selected
                      ? { background: style.color, borderColor: style.color }
                      : { color: style.color }
                    : undefined
                }
              >
                <span className="font-semibold">{SLOT_LETTER[s]}</span>
                {style && (
                  <span className={cx("max-w-36 truncate", !selected && "text-ink-2")}>{style.name}</span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={slot === null || !active}
            onClick={() => setSlot(null)}
            className={cx(
              "flex h-8 items-center rounded-full border px-3 text-[13px] transition-colors",
              !active
                ? "border-ink bg-ink text-paper"
                : "border-line-2 bg-card text-ink-2 hover:border-ink-3",
            )}
          >
            Nessuno stile
          </button>
          {active && active.refs.length === 0 && !active.description && (
            <span className="ml-1 text-xs text-ink-3">
              Questo stile non ha ancora un'àncora: scegli una prova in chat.
            </span>
          )}
        </div>

        <div
          className="rounded-2xl border-2 bg-card shadow-card transition-colors"
          style={{ borderColor: color }}
        >
          {replyTo && (
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px] text-ink-2">
              <CornerDownRight size={15} />
              <img src={mediaUrl(replyTo.thumbPath)} alt="" className="size-8 rounded object-cover" />
              <span className="flex-1">
                Modifica di questa immagine: nasce una nuova versione, l'originale resta.
              </span>
              <button
                type="button"
                aria-label="Annulla la modifica"
                onClick={onCancelReply}
                className="rounded p-1 hover:bg-paper-2"
              >
                <X size={15} />
              </button>
            </div>
          )}
          <textarea
            ref={input}
            aria-label="Descrivi l'immagine che vuoi"
            placeholder={
              replyTo ? "Cosa vuoi cambiare? Es. «rendi il cielo più scuro»" : "Descrivi l'immagine che vuoi"
            }
            value={text}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            className="block max-h-48 min-h-14 w-full resize-none bg-transparent px-4 pt-3 text-[15px] outline-none placeholder:text-ink-3"
          />
          <div className="flex items-center gap-3 px-3 pb-2.5">
            <label className="flex items-center gap-1.5 text-xs text-ink-3">
              Formato
              <select
                value={format ?? ""}
                onChange={(e) => setFormat((e.target.value || null) as Format | null)}
                className="rounded-md border border-line bg-paper px-1.5 py-1 text-xs text-ink-2 outline-none"
              >
                <option value="">
                  {active ? `Dello stile (${FORMAT_LABEL[defaultFormat].toLowerCase()})` : "Orizzontale"}
                </option>
                {(Object.keys(FORMAT_LABEL) as Format[]).map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABEL[f]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-1.5 text-xs text-ink-3">
              Varianti
              <div
                role="radiogroup"
                aria-label="Varianti"
                className="flex overflow-hidden rounded-md border border-line"
              >
                {VARIANTS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={variants === v}
                    onClick={() => setVariants(v)}
                    className={cx(
                      "w-7 py-1 text-xs",
                      variants === v ? "bg-ink text-paper" : "bg-paper text-ink-2 hover:bg-paper-2",
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1" />
            {!canGenerate && (
              <button type="button" onClick={onOpenSettings} className="text-xs text-accent underline">
                Manca la chiave API
              </button>
            )}
            <button
              type="button"
              aria-label="Invia"
              disabled={!text.trim() || sending}
              onClick={() => void send()}
              className="flex size-9 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-35"
              style={{ background: active?.color ?? "#2b2420" }}
            >
              <ArrowUp size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
