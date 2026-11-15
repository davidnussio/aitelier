import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import type { GeneratedImage, ThreadDetail } from "../../shared/types";
import { call } from "../lib/rpc";
import { Composer } from "./Composer";
import { MessageItem } from "./MessageItem";
import { Lightbox } from "./Lightbox";
import { Button, Dialog, IconButton, Menu, MenuItem, errorMessage, notify } from "./ui";

export function ThreadView({
  detail,
  canGenerate,
  onChanged,
  onDelete,
  onOpenSettings,
}: {
  detail: ThreadDetail;
  canGenerate: boolean;
  onChanged: () => void;
  onDelete: () => void;
  onOpenSettings: () => void;
}) {
  const { thread, messages, styles } = detail;
  const [replyTo, setReplyTo] = useState<GeneratedImage | null>(null);
  const [zoom, setZoom] = useState<GeneratedImage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  // Scende in fondo quando arriva un messaggio nuovo.
  useEffect(() => {
    if (messages.length !== lastCount.current) {
      // All'apertura salta in fondo; dopo, per i messaggi nuovi, scorre.
      const behavior = lastCount.current === 0 ? "auto" : "smooth";
      lastCount.current = messages.length;
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior });
    }
  }, [messages.length]);

  const allImages = new Map(messages.flatMap((m) => m.images).map((i) => [i.id, i]));

  return (
    <>
      <header className="flex items-start gap-3 border-b border-line px-6 pt-4 pb-3 pr-14">
        <div className="min-w-0 flex-1">
          <EditableText
            value={thread.title}
            className="font-serif text-2xl leading-tight"
            label="Titolo del progetto"
            onSave={(title) => call("threadsUpdate", { id: thread.id, title }).then(onChanged)}
          />
          <EditableText
            value={thread.contextNotes}
            placeholder="Aggiungi due righe di contesto (soggetto, personaggi, lingua dei testi)…"
            className="mt-1 text-[13px] text-ink-2"
            label="Note di contesto"
            multiline
            onSave={(contextNotes) => call("threadsUpdate", { id: thread.id, contextNotes }).then(onChanged)}
          />
        </div>
        <Menu
          align="right"
          trigger={(p) => (
            <IconButton label="Altre azioni" {...p}>
              <MoreHorizontal size={18} />
            </IconButton>
          )}
        >
          {(close) => (
            <MenuItem
              onClick={() => {
                close();
                setConfirmDelete(true);
              }}
            >
              <Trash2 size={15} className="text-danger" /> Elimina il progetto…
            </MenuItem>
          )}
        </Menu>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <EmptyThread hasStyles={styles.length > 0} />
        ) : (
          <div className="mx-auto flex max-w-[900px] flex-col gap-8">
            {messages.map((m) => (
              <MessageItem
                key={m.id}
                message={m}
                styles={styles}
                parent={m.parentImageId ? (allImages.get(m.parentImageId) ?? null) : null}
                onReply={setReplyTo}
                onZoom={setZoom}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
      </div>

      <Composer
        thread={thread}
        styles={styles}
        replyTo={replyTo}
        canGenerate={canGenerate}
        onCancelReply={() => setReplyTo(null)}
        onSent={() => {
          setReplyTo(null);
          onChanged();
        }}
        onOpenSettings={onOpenSettings}
      />

      {zoom && <Lightbox image={zoom} onClose={() => setZoom(null)} />}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Eliminare il progetto?">
        <p className="text-ink-2">
          «{thread.title}» verrà eliminato con stili e immagini. Le immagini salvate nella cartella Immagini
          restano. Non si può annullare.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(false)}>Annulla</Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmDelete(false);
              onDelete();
            }}
          >
            Elimina
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function EmptyThread({ hasStyles }: { hasStyles: boolean }) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center text-ink-2">
      <p className="font-serif text-xl text-ink">
        {hasStyles ? "Pronti a disegnare" : "Prima di tutto, uno stile"}
      </p>
      <p className="mt-2 text-[13.5px]">
        {hasStyles
          ? "Scegli lo stile qui sotto, descrivi l'immagine che vuoi e premi Invio."
          : "Nel pannello a destra crea lo stile A: descrivilo a parole oppure parti da un'immagine che ti piace. Puoi anche generare subito senza stile."}
      </p>
    </div>
  );
}

function EditableText({
  value,
  onSave,
  className,
  placeholder,
  label,
  multiline,
}: {
  value: string;
  onSave: (value: string) => Promise<unknown>;
  className?: string;
  placeholder?: string;
  label: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = async () => {
    setEditing(false);
    if (draft.trim() === value.trim()) return;
    try {
      await onSave(draft);
    } catch (e) {
      notify(errorMessage(e));
      setDraft(value);
    }
  };

  if (editing) {
    const common = {
      "aria-label": label,
      autoFocus: true,
      value: draft,
      onBlur: () => void commit(),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
        if (e.key === "Enter" && (!multiline || e.metaKey)) {
          e.preventDefault();
          void commit();
        }
      },
      className: `w-full rounded-md border border-line-2 bg-card px-2 py-1 outline-none ${className ?? ""}`,
    };
    return multiline ? (
      <textarea rows={2} {...common} onChange={(e) => setDraft(e.target.value)} />
    ) : (
      <input {...common} onChange={(e) => setDraft(e.target.value)} />
    );
  }
  return (
    <button
      type="button"
      title={`Modifica: ${label.toLowerCase()}`}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={`block w-full rounded-md px-2 py-1 -mx-2 text-left hover:bg-paper-2 ${className ?? ""} ${value ? "" : "italic text-ink-3"}`}
    >
      {value || placeholder}
    </button>
  );
}
