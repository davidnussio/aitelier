# Bottega

Studio di immagini di famiglia: un'app desktop locale che funziona come una
chat, ma per le immagini. Ogni progetto conserva il suo contesto e fino a tre
stili (A, B, C); ogni generazione riceve l'àncora e la descrizione del suo
stile, così le immagini di oggi e quelle del mese prossimo sembrano della
stessa mano. Le immagini le fanno i modelli GPT Image di OpenAI.

Specifica di prodotto: [docs/spec.md](docs/spec.md).

## Avvio

```bash
bun install
bun run start          # app desktop (Electrobun), dati veri, serve la chiave OpenAI
bun run demo           # app desktop con il fornitore dimostrativo: niente rete, niente costi
bun run preview        # interfaccia nel browser su http://localhost:5292, dati demo
bun run check          # typecheck + oxlint + test
bun run build          # pacchetto per la distribuzione (canale stable)
```

Senza chiave l'app apre le Impostazioni: incolla la chiave, premi «Verifica»,
poi «Salva». La chiave va nel portachiavi del sistema (`Bun.secrets`), con
ripiego su `secrets.json` (permessi 600) nella cartella dati; mai nel database,
nei log o verso la webview.

## Com'è fatto

| Cartella | Contenuto |
| --- | --- |
| `src/core` | Tutta la logica, senza import di Electrobun: database (`bun:sqlite`, WAL, migrazioni numerate), composizione del prompt, fornitore OpenAI dietro `ImageProvider`, coda dei lavori (2 in parallelo, 2 nuovi tentativi solo sugli errori temporanei), file. |
| `src/bun` | Guscio desktop: finestra, menu, RPC tipizzato, portachiavi, log, server locale delle immagini. `handlers.ts` traduce le richieste RPC in chiamate al core. |
| `src/mainview` | Interfaccia React + Tailwind 4 nella webview. Non ha accesso a rete, disco o chiave. |
| `src/shared` | Tipi di dominio e schema RPC condivisi. |
| `scripts/preview.ts` | Anteprima nel browser con lo stesso core e il fornitore dimostrativo. |

Cartella dati: `~/Library/Application Support/ch.dambox.bottega/<canale>/`
(`BOTTEGA_HOME` per sceglierne un'altra): `app.db`, `images/<thread>/<id>.png`,
`thumbs/` (WebP), `styles/<stile>/` (àncore ridotte a 1024 px), `logs/`.
Il backup è una copia della cartella.

### Coerenza di stile

Ogni chiamata invia le àncore dello stile (mai l'ultima immagine generata) e un
prompt in ordine fisso: ruolo delle immagini, descrizione dello stile in campi
fissi, note di contesto del progetto, richiesta dell'utente, vincoli. La
cronologia della chat non viene inviata. I modelli sono fissati nel progetto
alla sua creazione. Vedi `src/core/prompt.ts` e i test in `src/core/*.test.ts`.

### Scostamenti dalla specifica

- Le immagini arrivano alla webview da un server HTTP su `127.0.0.1` (porta
  casuale, token di sessione), non da uno schema dell'app: Electrobun 2.0 non
  espone ancora schemi personalizzati per file dell'utente. Mai base64 nell'RPC.
- «Salva» copia l'immagine in `Immagini/Bottega` e la mostra nel Finder:
  Electrobun 2.0 non ha una finestra di salvataggio nativa.
- Il costo della descrizione degli stili (modello di testo) non è ancora
  conteggiato; quello delle immagini sì, stimato dai token di `usage`.

## Stato (fase 1 della specifica)

Fatto: impostazioni con chiave e verifica, progetti con note di contesto,
3 slot di stile (da descrizione con 3 prove, da immagine caricata, da immagine
in chat), descrizione automatica dello stile, blocco, generazione con àncore e
varianti 1/2/4, modifica di un'immagine (nuova versione), rigenera con gli
stessi criteri, errori in italiano, costo per immagine e del mese.

Da fare: galleria filtrabile e ZIP, libreria degli stili, navigazione tra
versioni, tetto di spesa mensile, esportazione/importazione dei progetti,
icona e installer firmato.

Modelli predefiniti (impostabili): `gpt-image-2.6-flare` (veloce),
`gpt-image-2.6-sunburst` (preciso), `gpt-5-mini` per descrivere gli stili.
Identificativi letti dalla guida OpenAI il 15 novembre 2026; i prezzi in
`src/core/pricing.ts` sono quelli di GPT Image 2.5 riportati dalle fonti, da
riverificare.
