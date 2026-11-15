# Bottega

Studio di immagini di famiglia: un'app desktop locale che funziona come una
chat, ma per le immagini. Ogni progetto conserva il suo contesto; gli stili
vivono in una libreria comune (voce «Stili» nella barra laterale), senza limite
di numero, e ogni progetto usa quelli che vuole. Ogni generazione riceve
l'àncora e la descrizione del suo stile, così le immagini di oggi e quelle del mese prossimo sembrano della
stessa mano. Le immagini le fanno i modelli GPT Image di OpenAI.

Specifica di prodotto: [docs/spec.md](docs/spec.md).

## Installazione

Scarica il file `.dmg` dall'ultima [release](https://github.com/davidnussio/bottega/releases/latest),
aprilo e trascina Bottega in Applicazioni. Al primo avvio servono una chiave
API di OpenAI e, per i modelli di immagini, un'organizzazione OpenAI
verificata.

L'app non è firmata con un certificato Apple: la prima volta macOS la blocca.
Apri Impostazioni di Sistema › Privacy e sicurezza e premi «Apri comunque»,
oppure dal Terminale:

```bash
xattr -dr com.apple.quarantine /Applications/Bottega.app
```

Gli aggiornamenti successivi arrivano da soli dalle release di questo repository.

## Sviluppo

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
`thumbs/` (WebP), `styles/<stile>/` (àncore ridotte a 1024 px), `logs/`,
`backups/`.

### Backup e registro

- Backup automatico una volta al giorno (restano gli ultimi 10), uno prima di
  ogni migrazione dello schema, uno manuale da Impostazioni › Backup. Ogni
  backup è `app.db` (copia coerente con `VACUUM INTO`) più le immagini
  collegate con hard link: costa pochi KB finché le immagini restano.
- Il ripristino si prenota da Impostazioni › Backup e avviene al riavvio,
  prima di aprire il database, dopo un backup di sicurezza dello stato attuale.
- Il backup sta nella cartella dati: per proteggersi da un guasto del disco
  va copiato altrove.
- Registro in `logs/bottega.log` (ruotato a 2 MB), visibile da Impostazioni ›
  Registro: generazioni con modello, token, costo e tempi, errori, backup.

### Coerenza di stile

Ogni chiamata invia le àncore dello stile (mai l'ultima immagine generata) e un
prompt in ordine fisso: ruolo delle immagini, descrizione dello stile in campi
fissi, note di contesto del progetto, richiesta dell'utente, vincoli. La
cronologia della chat non viene inviata. I modelli sono fissati nel progetto
alla sua creazione. Vedi `src/core/prompt.ts` e i test in `src/core/*.test.ts`.

### Scostamenti dalla specifica

- Stili senza limite e globali (schema 2): non più 3 slot per progetto, ma una
  libreria comune; un progetto usa gli stili tramite `thread_styles`. Lo stesso
  stile vale in tutti i progetti che lo usano (il blocco evita cambi per
  errore); «Duplica» crea una copia indipendente.

- Le immagini arrivano alla webview da un server HTTP su `127.0.0.1` (porta
  casuale, token di sessione), non da uno schema dell'app: Electrobun 2.0 non
  espone ancora schemi personalizzati per file dell'utente. Mai base64 nell'RPC.
- «Salva» copia l'immagine in `Immagini/Bottega` e la mostra nel Finder:
  Electrobun 2.0 non ha una finestra di salvataggio nativa.
- Il costo della descrizione degli stili (modello di testo) non è ancora
  conteggiato; quello delle immagini sì, stimato dai token di `usage`.

## Stato (fase 1 della specifica)

Fatto: impostazioni con chiave e verifica, progetti con note di contesto,
libreria degli stili senza limite (da descrizione con 3 prove, in chat o
nella pagina Stili; da immagine caricata; da immagine in chat; duplica, usa in
più progetti), descrizione automatica dello stile, blocco, generazione con àncore e
varianti 1/2/4, modifica di un'immagine (nuova versione), rigenera con gli
stessi criteri, errori in italiano, costo per immagine e del mese, backup
automatici e ripristino, registro consultabile.

Da fare: galleria filtrabile e ZIP, navigazione tra
versioni, tetto di spesa mensile, esportazione/importazione dei progetti,
icona e installer firmato.

Modelli predefiniti (impostabili): `gpt-image-2.6-flare` (veloce),
`gpt-image-2.6-sunburst` (preciso), `gpt-5-mini` per descrivere gli stili.
Identificativi letti dalla guida OpenAI il 15 novembre 2026; i prezzi in
`src/core/pricing.ts` sono quelli di GPT Image 2.5 riportati dalle fonti, da
riverificare.
