# Bottega: note per gli agenti

App desktop Electrobun 2 (processo principale Bun) + React/Vite nella webview.
Leggi `README.md` per struttura e stato, `docs/spec.md` per la specifica.

- Electrobun NON è Electron: vedi `llms.txt`. L'SDK 2.x sta in `.hutch/devkit`
  (generato da `electrobun prepare`, ignorato da git).
- La logica va in `src/core`, che non importa mai Electrobun. `src/bun` è un
  guscio sottile; i gestori RPC stanno in `src/bun/handlers.ts` e sono usati
  anche da `scripts/preview.ts`.
- La chiave API non deve mai: finire nel database, nei log, nelle risposte RPC
  verso la webview. La webview vede solo `sk-...abcd`.
- Gli stili sono globali (libreria) e collegati ai progetti da `thread_styles`.
  Una modifica allo schema è una nuova voce in `MIGRATIONS` (`src/core/db.ts`)
  con un test che parte dallo schema precedente; all'avvio l'app fa un backup
  prima di migrare.
- Testi dell'interfaccia e messaggi d'errore in italiano, con cosa fare dopo.
- Prima di dire che una modifica dell'interfaccia funziona: `bun run preview`
  e controllo nel browser integrato (dati demo, nessuna chiave).
- Vite usa la porta 5291 (la 5173 è spesso occupata da altri progetti) e il
  guscio la usa solo se risponde il Vite di Bottega.
- `bun run check` deve passare: typecheck, `oxlint --deny-warnings`, test.
  Formattazione con `oxfmt`.
- Commit in Conventional Commits, in italiano, senza trailer di attribuzione AI.
