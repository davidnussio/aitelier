import { useState } from "react";
import { Copy, FolderPlus, Plus, Trash2 } from "lucide-react";
import type { Style, ThreadSummary } from "../../shared/types";
import { call } from "../lib/rpc";
import { CreateStyleDialog, StyleCard, nextColor } from "./StyleCard";
import { Button, Dialog, Menu, MenuItem, errorMessage, notify } from "./ui";

/** La voce «Stili» della barra laterale: tutti gli stili, usabili in ogni progetto. */
export function StyleLibrary({
  styles,
  threads,
  onChanged,
  onOpenThread,
}: {
  styles: Style[];
  threads: ThreadSummary[];
  onChanged: () => void;
  onOpenThread: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Style | null>(null);

  const run = async (fn: () => Promise<unknown>, after?: string) => {
    try {
      await fn();
      if (after) notify(after, "info");
      onChanged();
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  return (
    <>
      <header className="flex items-start gap-4 border-b border-line px-6 pt-4 pb-3 pr-14">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-2xl leading-tight">Stili</h1>
          <p className="mt-1 text-[13px] text-ink-2">
            Tutti gli stili della famiglia. Uno stile si usa in quanti progetti vuoi; bloccalo quando è
            riuscito, così non cambia per errore.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={15} /> Nuovo stile
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {styles.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md text-center text-ink-2">
            <p className="font-serif text-xl text-ink">La libreria è vuota</p>
            <p className="mt-2 text-[13.5px]">
              Crea uno stile dentro un progetto (pannello a destra) oppure parti da un'immagine che ti piace.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-4">
            {styles.map((style) => (
              <StyleCard
                key={style.id}
                style={style}
                onChanged={onChanged}
                defaultOpen={style.refs.length === 0}
                actions={
                  <>
                    <Menu
                      trigger={(p) => (
                        <Button size="sm" variant="ghost" disabled={threads.length === 0} {...p}>
                          <FolderPlus size={14} /> Usa in un progetto
                        </Button>
                      )}
                    >
                      {(close) =>
                        threads.map((t) => (
                          <MenuItem
                            key={t.id}
                            onClick={() => {
                              close();
                              void run(() =>
                                call("stylesAttach", { threadId: t.id, styleId: style.id }),
                              ).then(() => onOpenThread(t.id));
                            }}
                          >
                            {t.title}
                          </MenuItem>
                        ))
                      }
                    </Menu>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void run(
                          () => call("stylesDuplicate", { styleId: style.id }),
                          `Copia di «${style.name}» creata: modificarla non tocca l'originale.`,
                        )
                      }
                    >
                      <Copy size={14} /> Duplica
                    </Button>
                    {!style.locked && (
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(style)}>
                        <Trash2 size={14} /> Elimina…
                      </Button>
                    )}
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>

      {creating && (
        <CreateStyleDialog
          threadId={null}
          defaultColor={nextColor(styles.map((s) => s.color))}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            onChanged();
          }}
        />
      )}

      {deleting && (
        <Dialog open onClose={() => setDeleting(null)} title="Eliminare lo stile?">
          <p className="text-ink-2">
            «{deleting.name}» sparisce dalla libreria
            {deleting.projectCount > 0
              ? ` e dai ${deleting.projectCount === 1 ? "progetto che lo usa" : `${deleting.projectCount} progetti che lo usano`}`
              : ""}
            . Le immagini già fatte restano, con la loro etichetta. Non si può annullare.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button onClick={() => setDeleting(null)}>Annulla</Button>
            <Button
              variant="danger"
              onClick={() => {
                const target = deleting;
                setDeleting(null);
                void run(() => call("stylesDelete", { styleId: target.id }));
              }}
            >
              Elimina
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
