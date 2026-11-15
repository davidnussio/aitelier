import { useState } from "react";
import { Library, Minus, Plus } from "lucide-react";
import type { Style, ThreadDetail } from "../../shared/types";
import { call } from "../lib/rpc";
import { mediaUrl } from "../lib/media";
import { CreateStyleDialog, StyleCard, nextColor } from "./StyleCard";
import { Button, Dialog, errorMessage, notify } from "./ui";

/** Pannello a destra: gli stili usati da questo progetto, senza limite di numero. */
export function StylePanel({
  detail,
  library,
  onChanged,
}: {
  detail: ThreadDetail;
  library: Style[];
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const threadId = detail.thread.id;
  const available = library.filter((s) => !detail.styles.some((d) => d.id === s.id));

  const detach = async (style: Style) => {
    try {
      await call("stylesDetach", { threadId, styleId: style.id });
      notify(`«${style.name}» tolto dal progetto. Resta nella libreria degli stili.`, "info");
      onChanged();
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  return (
    <aside aria-label="Stili del progetto" className="flex w-[340px] min-h-0 flex-col bg-paper-2/60">
      <div className="px-4 pt-4 pb-2">
        <h2 className="font-serif text-lg">Stili del progetto</h2>
        <p className="text-xs text-ink-3">
          Ogni immagine riceve l'àncora e la descrizione del suo stile. Gli stili vivono nella libreria e si
          possono usare in più progetti.
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        {detail.styles.length === 0 && (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line-2 px-3 py-4 text-[13px] text-ink-2">
            Questo progetto non ha ancora stili. Creane uno nuovo oppure prendine uno dalla libreria.
          </p>
        )}
        {detail.styles.map((style) => (
          <StyleCard
            key={style.id}
            style={style}
            onChanged={onChanged}
            defaultOpen={style.refs.length === 0}
            actions={
              <Button size="sm" variant="ghost" onClick={() => void detach(style)}>
                <Minus size={14} /> Togli dal progetto
              </Button>
            }
          />
        ))}
      </div>
      <div className="flex gap-2 border-t border-line px-3 py-3">
        <Button className="flex-1" onClick={() => setCreating(true)}>
          <Plus size={15} /> Nuovo stile
        </Button>
        <Button className="flex-1" disabled={available.length === 0} onClick={() => setPicking(true)}>
          <Library size={15} /> Dalla libreria
        </Button>
      </div>

      {creating && (
        <CreateStyleDialog
          threadId={threadId}
          defaultColor={nextColor(detail.styles.map((s) => s.color))}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            onChanged();
          }}
        />
      )}
      {picking && (
        <LibraryPicker
          styles={available}
          onClose={() => setPicking(false)}
          onPick={async (style) => {
            try {
              await call("stylesAttach", { threadId, styleId: style.id });
              setPicking(false);
              onChanged();
            } catch (e) {
              notify(errorMessage(e));
            }
          }}
        />
      )}
    </aside>
  );
}

function LibraryPicker({
  styles,
  onClose,
  onPick,
}: {
  styles: Style[];
  onClose: () => void;
  onPick: (style: Style) => void;
}) {
  return (
    <Dialog open onClose={onClose} title="Aggiungi uno stile della libreria" width={640}>
      <p className="mb-4 text-[13px] text-ink-2">
        Lo stile resta uno solo: se lo modifichi, cambia in tutti i progetti che lo usano. Per variarlo solo
        qui, duplicalo prima dalla voce «Stili».
      </p>
      <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto">
        {styles.map((style) => (
          <button
            key={style.id}
            type="button"
            onClick={() => onPick(style)}
            className="flex items-center gap-3 rounded-xl border border-line bg-paper p-2 text-left hover:border-ink-3"
          >
            <span className="flex gap-1">
              {style.refs.slice(0, 2).map((ref) => (
                <img
                  key={ref.id}
                  src={mediaUrl(ref.path)}
                  alt=""
                  className="size-12 rounded-md object-cover"
                />
              ))}
              {style.refs.length === 0 && (
                <span className="size-12 rounded-md" style={{ background: style.color }} />
              )}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: style.color }} />
                <span className="truncate">{style.name}</span>
              </span>
              <span className="text-xs text-ink-3">
                {style.projectCount === 0 ? "Non usato" : `In ${style.projectCount} progetti`}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={onClose}>Chiudi</Button>
      </div>
    </Dialog>
  );
}
