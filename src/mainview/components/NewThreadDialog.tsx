import { useState } from "react";
import { Button, Dialog } from "./ui";

export function NewThreadDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string, contextNotes: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Dialog open onClose={onClose} title="Nuovo progetto">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) onCreate(title, notes);
        }}
        className="space-y-4"
      >
        <label className="block text-[13px]">
          <span className="mb-1 block text-ink-2">Titolo</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Es. Ricerca di scuola sui vulcani"
            className="h-10 w-full rounded-lg border border-line-2 bg-paper px-3 text-[15px] outline-none focus:border-ink-3"
          />
        </label>
        <label className="block text-[13px]">
          <span className="mb-1 block text-ink-2">Contesto (facoltativo)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Es. ricerca di terza media sui vulcani, testi in italiano"
            className="w-full rounded-lg border border-line-2 bg-paper px-3 py-2 outline-none focus:border-ink-3"
          />
          <span className="mt-1 block text-xs text-ink-3">
            Entra in ogni immagine del progetto. Puoi cambiarlo quando vuoi.
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Annulla</Button>
          <button
            type="submit"
            disabled={!title.trim()}
            className="h-9 rounded-lg bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-2 disabled:opacity-45"
          >
            Crea progetto
          </button>
        </div>
      </form>
    </Dialog>
  );
}
