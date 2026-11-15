# Studio Immagini di Famiglia: specifica di prodotto

15 novembre 2026 · David Nussio

## Sintesi

Un'app desktop locale per la famiglia che funziona come una chat, ma per le immagini: ogni thread conserva il contesto del progetto e fino a tre stili riutilizzabili, così le immagini generate oggi e tra un mese restano visivamente coerenti. Le immagini sono prodotte dai modelli GPT Image di OpenAI con una sola chiave API, incollata una volta nelle impostazioni dell'app.

Esempio guida: un thread "Ricerca di scuola sui vulcani" con lo stile A per le immagini di sezione, lo stile B per le infografiche e lo stile C libero. Chi scrive sceglie lo stile con un clic e descrive solo il contenuto.

**Obiettivi**

- Generare un'immagine in tre gesti: scegli lo stile, scrivi cosa vuoi, invia.
- Stile stabile nel tempo: la decima immagine di uno stile è riconoscibile come sorella della prima.
- Usabile da chi non sa cosa sia un prompt: interfaccia in italiano, valori predefiniti sensati, errori comprensibili.
- Tutto in locale: immagini, thread e chiave API restano sul computer, in un database SQLite e una cartella di file. Esce solo la chiamata a OpenAI.

**Fuori dal perimetro (v1)**

- Server web, accesso da browser o telefono, account, sincronizzazione tra computer.
- Editor grafico (livelli, maschere disegnate a mano, ritaglio).
- Altri fornitori di modelli. L'integrazione resta però isolata dietro un'interfaccia, per aggiungerli dopo.
- Video e animazioni.

## Concetti

Il prodotto ha cinque oggetti. Il thread è il contenitore, lo stile è ciò che garantisce la coerenza.

| Oggetto | Cos'è | Regole |
| --- | --- | --- |
| Thread | Un progetto: titolo, note di contesto, cronologia, fino a 3 stili | Le note di contesto (soggetto, personaggi, lingua dei testi) entrano in ogni generazione del thread |
| Stile | Uno slot (A, B, C) con nome, colore, descrizione dello stile, 1-3 immagini di riferimento e parametri predefiniti | Massimo 3 per thread. Ogni richiesta usa un solo stile, oppure "nessuno stile" |
| Messaggio | La richiesta scritta dall'utente, con lo stile scelto | Mostra sempre l'etichetta colorata dello stile usato |
| Immagine | Il risultato di una generazione | Conserva prompt finale, parametri, modello e costo, per poterla rigenerare identica nei criteri |
| Versione | Una modifica di un'immagine esistente ("togli lo sfondo", "cambia il titolo") | Resta collegata all'immagine madre, si naviga avanti e indietro |

**Cosa contiene uno stile**

- **Nome e colore**: per esempio "Sezioni" in blu, "Infografiche" in arancio.
- **Descrizione dello stile**: testo strutturato (tecnica, palette, tratto, luce, composizione, tipografia, cosa evitare). Lo scrive l'app, l'utente può correggerlo.
- **Immagini di riferimento**: da 1 a 3 immagini "àncora" inviate al modello a ogni generazione.
- **Parametri predefiniti**: formato (quadrato, orizzontale, verticale), qualità, sfondo trasparente sì o no, modello.
- **Blocco**: uno stile bloccato non cambia più per errore. Per modificarlo bisogna sbloccarlo in modo esplicito.

Uno stile riuscito si può salvare nella libreria e copiare in un altro thread. È una copia: modificarla non tocca l'originale.

## Esperienza d'uso

Una sola schermata, tre zone: elenco dei thread a sinistra, conversazione al centro, pannello degli stili a destra (richiudibile).

**Primo avvio**

Senza chiave l'app apre direttamente le Impostazioni: un campo "Chiave API OpenAI" in cui incollarla, un pulsante "Verifica" che fa una chiamata di prova e mostra esito e modelli disponibili, poi "Salva". Da lì in poi la chiave appare mascherata (`sk-...abcd`) con i pulsanti "Sostituisci" e "Rimuovi". Le Impostazioni restano raggiungibili dall'icona a ingranaggio.

**Barra di scrittura**

- Tre pulsanti stile colorati (A, B, C) più "nessuno". L'ultimo stile usato resta selezionato.
- Campo di testo: "Descrivi l'immagine che vuoi".
- Opzioni rapide: formato e numero di varianti (1, 2 o 4). Il resto arriva dallo stile.
- Invio. Durante la generazione compare un segnaposto con lo stato, e si può continuare a scrivere.

**Flussi principali**

1. **Nuovo thread**: titolo e, facoltative, due righe di contesto ("ricerca di terza media sui vulcani, testi in italiano").
2. **Creare uno stile**, in tre modi:
    - da descrizione: "acquerello morbido, colori pastello". L'app genera 2-4 prove, l'utente sceglie l'àncora;
    - da immagine caricata: l'app ne ricava la descrizione dello stile;
    - da un'immagine già in chat: menu "Usa come stile" e scelta dello slot.
3. **Generare**: scelta dello stile, testo, invio. Il risultato appare in chat con l'etichetta dello stile.
4. **Modificare**: risposta a un'immagine ("rendi il cielo più scuro"). Nasce una nuova versione, l'originale resta.
5. **Rigenerare**: stessa richiesta e stesso stile, nuovo tentativo.
6. **Raccogliere**: vista galleria del thread filtrabile per stile, download singolo o ZIP.

**Regole di semplicità**

- Nessun termine tecnico in vista: modello, qualità e token stanno in un pannello "Avanzate".
- Errori in linguaggio comune: richiesta rifiutata dai filtri di OpenAI, credito esaurito, rete assente. Sempre con cosa fare dopo.
- Lo stile attivo si vede sempre: colore sul bordo della barra di scrittura e sull'immagine prodotta.
- Quando i tre slot sono pieni, l'app propone di sostituirne uno o di aprire un nuovo thread.

## Coerenza di stile

La coerenza non viene dalla memoria della chat ma da due àncore inviate a ogni chiamata: le immagini di riferimento dello stile e la sua descrizione testuale. È il punto tecnico centrale del prodotto.

**Come si compone ogni richiesta**

1. Immagini di riferimento dello stile scelto, passate come immagini di input.
2. Prompt costruito da un modello fisso, in quest'ordine:
    - ruolo delle immagini: "Le immagini 1-N sono solo riferimenti di stile. Copia tecnica, palette, tratto e composizione. Non copiare soggetti né testi";
    - descrizione dello stile;
    - note di contesto del thread;
    - richiesta dell'utente, così come l'ha scritta;
    - vincoli: formato, lingua dei testi, sfondo.
3. Parametri predefiniti dello stile, salvo modifiche dell'utente.

**Regole che evitano la deriva**

- Il riferimento è sempre l'àncora dello stile, mai l'ultima immagine generata. Riferirsi all'ultima accumula piccole differenze a ogni passo.
- La descrizione dello stile si genera una volta sola, da un modello di testo con visione che analizza l'àncora, in campi fissi: tecnica, palette (con colori esadecimali), tratto, luce, composizione, tipografia, da evitare.
- Il modello è fissato per thread, se possibile con lo snapshot datato. Un aggiornamento di OpenAI non cambia l'aspetto di un progetto in corso.
- La cronologia della chat non viene inviata. Il contesto passa dalle note del thread, brevi e modificabili.
- Una modifica ("cambia il titolo") invia l'immagine da modificare più le àncore dello stile.

**Infografiche**

Lo stile per infografiche aggiunge alla descrizione le regole di impaginazione: griglia, stile delle icone, carattere, gerarchia dei titoli, colori per i dati. Usa qualità alta, perché il testo leggibile ne dipende, e dichiara sempre la lingua dei testi.

**Verifica**

Prova di accettazione: 10 immagini con soggetti diversi nello stesso stile, affiancate in galleria, devono sembrare della stessa mano a un familiare che non conosce il progetto.

## Integrazione OpenAI

L'app chiama direttamente l'Image API di OpenAI: generazione semplice per le prove di stile, endpoint di modifica con immagini di riferimento per tutto il resto. Il nome del modello è una impostazione, non una costante, perché la famiglia GPT Image cambia ogni pochi mesi.

**Stato dei modelli al 15 novembre 2026**

- GPT Image 2.5 (8 settembre 2026) ha due varianti: `gpt-image-2.5-flare`, più veloce e predefinita, e `gpt-image-2.5-sunburst`, più precisa nelle modifiche. Vedi la [guida OpenAI](https://developers.openai.com/api/docs/guides/image-generation) e [Wikipedia](https://en.wikipedia.org/wiki/GPT_Image).
- GPT Image 2.6 è uscito il 4 novembre 2026, sempre con Flare e Sunburst. Gli identificativi esatti vanno letti dalla guida OpenAI prima di fissarli nel codice.
- L'endpoint di modifica accetta più immagini di riferimento per chiamata (fino a 16 secondo le [schede dei rivenditori](https://www.atlascloud.ai/models/gpt-image-2.5)): tre àncore per stile ci stanno con largo margine.

**Scelte di integrazione**

| Uso | Endpoint | Modello predefinito | Qualità |
| --- | --- | --- | --- |
| Prove per creare uno stile | `POST /v1/images/generations` | Flare | bassa o media, 2-4 varianti |
| Immagine in uno stile | `POST /v1/images/edits` con le àncore | Flare | media |
| Infografica | `POST /v1/images/edits` con le àncore | Sunburst | alta |
| Modifica di un'immagine | `POST /v1/images/edits` con immagine e àncore | Sunburst | come l'originale |
| Descrizione dello stile da un'immagine | Responses API, modello di testo con visione | modello piccolo, configurabile | non applicabile |

- Perché l'Image API e non lo strumento immagini della Responses API: controllo esplicito su quali immagini entrano in ogni chiamata e nessuno stato di conversazione lato OpenAI. La coerenza resta nelle mani dell'app.
- La chiave API si incolla nelle Impostazioni e viene salvata nel portachiavi del sistema operativo. La usa solo il processo principale: l'interfaccia riceve soltanto la versione mascherata.
- Il modulo OpenAI sta dietro un'interfaccia `ImageProvider` (`generate`, `editWithReferences`, `describeStyle`) per poter cambiare modello o fornitore.

**Costi**

La tariffa è a token. Per GPT Image 2.5 le fonti riportano 5 USD per milione di token di testo in ingresso, 8 USD per le immagini in ingresso e 30 USD per le immagini in uscita ([Developers Digest](https://www.developersdigest.tech/blog/gpt-image-2-5-sunburst-flare)). Sono valori da verificare sulla pagina prezzi di OpenAI, anche per la 2.6.

- Le immagini di riferimento si pagano a ogni chiamata. Vanno ridotte a circa 1024 px sul lato lungo prima dell'invio.
- L'app salva i token di ogni risposta (`usage`) e mostra il costo per immagine e il totale del mese.
- Un tetto mensile configurabile avvisa e, se impostato, blocca le nuove generazioni.

**Errori e limiti da gestire**

- Rifiuto dei filtri di contenuto: messaggio chiaro, nessun tentativo automatico.
- Limiti di frequenza ed errori temporanei: fino a 2 nuovi tentativi con attesa crescente.
- Tempi lunghi: la generazione gira come lavoro in background, l'interfaccia riceve lo stato in tempo reale.
- Verifica dell'organizzazione: OpenAI può richiederla per i modelli GPT Image. Va fatta una volta sull'account prima del primo uso.

## Architettura e modello dati

Un'app desktop Electrobun con due parti: il processo principale Bun, che possiede database, file, chiave e chiamate a OpenAI, e una webview con l'interfaccia React. Nessun server web e nessuna porta aperta sulla rete. Tutto lo stato sta nella cartella dati dell'utente, quindi il backup è una copia della cartella.

**Componenti**

- **Processo principale (Bun, TypeScript)**: `bun:sqlite`, modulo OpenAI, coda di lavori in memoria con al massimo 2 generazioni in parallelo, lettura e scrittura dei file immagine.
- **Interfaccia (webview)**: React con Vite, impacchettata nell'app. Non ha accesso a rete, disco o chiave.
- **Ponte**: RPC tipizzato di Electrobun. La webview chiede ("genera", "elenca thread"), il processo principale risponde e invia gli eventi di avanzamento dei lavori.
- **Dati**: nella cartella dati dell'app (`~/Library/Application Support/...` su macOS, `%LOCALAPPDATA%` su Windows): `app.db`, `images/<thread>/<id>.png`, miniature WebP.
- **Immagini nella webview**: servite dal processo principale tramite uno schema locale dell'app, mai come base64 dentro l'RPC.

**Chiave API**

- Si incolla nelle Impostazioni. Il pulsante "Verifica" fa una chiamata di prova prima del salvataggio.
- Salvataggio nel portachiavi del sistema (Portachiavi macOS, Credential Manager di Windows, libsecret su Linux) tramite `Bun.secrets`. Da verificare nel primo prototipo che funzioni dentro Electrobun.
- Ripiego se il portachiavi non è disponibile: file `secrets.json` nella cartella dati con permessi limitati all'utente. Mai nel database, così una copia di `app.db` non porta con sé la chiave.
- La chiave non attraversa mai il ponte RPC verso la webview e non finisce nei log.

**Tabelle**

| Tabella | Campi principali |
| --- | --- |
| `threads` | id, titolo, note_contesto, modello_fissato, creato_il, archiviato |
| `styles` | id, thread_id, slot (1-3, unico per thread), nome, colore, descrizione, parametri (JSON), bloccato |
| `style_refs` | id, style_id, percorso_file, ordine |
| `messages` | id, thread_id, testo, style_id, creato_il |
| `images` | id, message_id, style_id, immagine_madre_id, percorso_file, prompt_finale, parametri (JSON), modello, token_ingresso, token_uscita, costo_usd, stato |
| `style_library` | id, nome, descrizione, parametri (JSON), riferimenti (copie dei file) |
| `settings` | chiave, valore: modelli predefiniti, tetto di spesa, lingua. Non la chiave API |

Migrazioni dello schema numerate ed eseguite all'avvio. Il database usa la modalità WAL.

**Comandi RPC**

- `threads.list / create / update / delete`
- `styles.set(threadId, slot, ...)`, `styles.describeFromImage`, `styles.saveToLibrary`, `styles.copyFromLibrary`
- `messages.send(threadId, text, styleSlot, opzioni)`: crea il messaggio, mette in coda i lavori, risponde subito con gli id
- `images.edit`, `images.regenerate`, `images.saveAs` (finestra di salvataggio nativa), `threads.exportZip`
- `settings.get / set`, `apiKey.set / verify / remove / status`
- Eventi dal processo principale: `job.progress`, `job.done`, `job.failed`

**Più computer in famiglia**

Ogni installazione ha i propri thread e la propria chiave. Per passare un progetto o uno stile da un computer all'altro basta l'esportazione ZIP di un thread e la relativa importazione. Nessuna sincronizzazione automatica.

## Tecnologia: Electrobun 2 o altro

Per un'app desktop locale con SQLite, Electrobun 2 va bene, a tre condizioni: processo principale su Bun, versione 2.0.x fissata, e computer di famiglia soprattutto Mac. Se il computer principale è Windows, Tauri 2 è la scelta più prudente.

**Perché Electrobun 2 si adatta**

- Tutto in TypeScript: un solo linguaggio per interfaccia, database e chiamate a OpenAI.
- `bun:sqlite` è integrato nel runtime: nessun modulo nativo da compilare.
- RPC tipizzato tra webview e processo principale: i tipi dei comandi sono condivisi.
- Usa la webview di sistema, quindi l'app resta piccola.

**Cosa sapere prima di sceglierlo**

- La 2.0 è stabile (2.0.2 a metà ottobre 2026), con build native per macOS, Windows e Linux e il nucleo riscritto in Zig ([changelog 2.x](https://framework.blackboard.sh/electrobun/guides/changelog/v2-x/), [annuncio](https://electrobun.dev/blog/electrobun-2-0/)).
- Il processo principale può girare su Cottontail (il nuovo runtime del progetto, ancora sperimentale), Bun, Zig, Rust, Go o Odin. Qui serve Bun: Cottontail non dà ancora garanzie su `bun:sqlite` e `Bun.secrets`.
- È un progetto giovane: la prima versione pubblica ha circa sei mesi e la 2.0 ha cambiato strumenti di build e runtime. Le versioni vanno fissate e aggiornate con calma.
- Windows e Linux sono meno maturi di macOS: una [valutazione di ottobre 2026](https://github.com/smolak/my-mame-ui/issues/11) segnala l'aggiornamento automatico rotto su Windows, l'installer Windows non firmato che fa scattare SmartScreen e l'assenza del menu applicazione su Linux.
- Webview diverse per sistema (WebKit su macOS e Linux, WebView2 su Windows): l'interfaccia va provata su ogni sistema usato in famiglia.

**Confronto**

| Opzione | A favore | Contro | Adatta se |
| --- | --- | --- | --- |
| Electrobun 2 (processo principale Bun) | Tutto TypeScript, `bun:sqlite` integrato, RPC tipizzato, app piccola | Framework giovane, Windows e Linux meno rifiniti | Mac in famiglia, voglia di restare su Bun. **Scelta consigliata** |
| Tauri 2 | Maturo, leggero, installer e aggiornamenti collaudati su Windows | Backend in Rust (SQLite e OpenAI lato Rust, o plugin), due linguaggi | Windows è il sistema principale, o serve robustezza a lungo termine |
| Electron | Il più collaudato, stesso motore ovunque, `better-sqlite3` | App da oltre 100 MB, eccessivo per questo scopo | Solo se le due sopra falliscono |

**Come ridurre il rischio**

- La logica (database, stili, composizione dei prompt, modulo OpenAI) sta in un pacchetto `core` TypeScript senza import di Electrobun. Il guscio desktop è sottile e sostituibile.
- Tutte le azioni vivono nell'interfaccia, non nei menu nativi, così Linux non resta indietro.
- Aggiornamenti: su macOS quelli integrati, su Windows manuali (si scarica il nuovo installer).
- Primo passo dello sviluppo: un prototipo di mezza giornata che verifica i tre punti incerti, cioè `bun:sqlite` nella cartella dati, `Bun.secrets` per la chiave, immagini locali mostrate nella webview.

## Piano di rilascio

Un prototipo tecnico e tre fasi. La fase 1 basta già per l'esempio delle sezioni e delle infografiche.

| Fase | Contenuto | Fatto quando |
| --- | --- | --- |
| 0. Prototipo | Guscio Electrobun con `bun:sqlite`, chiave nel portachiavi, un'immagine generata e mostrata | I tre punti incerti della tecnologia sono verificati sul computer di famiglia |
| 1. Nucleo | Impostazioni con chiave API e verifica, thread, 3 slot di stile (da descrizione, da immagine caricata, da immagine in chat), generazione con àncore, cronologia, salvataggio su disco | Un familiare crea un thread, due stili e 5 immagini per stile senza aiuto |
| 2. Rifinitura | Modifica conversazionale e versioni, varianti multiple, galleria filtrabile, libreria degli stili, costi e tetto mensile | Prova delle 10 immagini superata per entrambi gli stili di esempio |
| 3. Comodità | Esportazione e importazione ZIP dei thread, installer firmato, aggiornamenti | Installazione su un secondo computer in meno di 10 minuti |

**Criteri di accettazione della fase 1**

- Dalla schermata vuota alla prima immagine in meno di 2 minuti, senza leggere istruzioni.
- Ogni immagine mostra lo stile con cui è nata e si può rigenerare con gli stessi criteri.
- Cambiare stile nella barra di scrittura richiede un solo clic e non altera gli altri due stili.
- Chiudendo e riaprendo l'app, thread, stili e immagini sono intatti.
- La chiave API si incolla e si verifica dalle Impostazioni, non compare nel database, nei log né nei messaggi verso la webview.
- Un errore di OpenAI produce un messaggio in italiano e lascia il thread utilizzabile.

## Domande aperte

- Quali sistemi operativi hanno i computer di famiglia? Se c'è Windows, vale la pena decidere subito tra Electrobun 2 e Tauri 2.
- L'app gira su un solo computer condiviso o su più computer? Nel secondo caso l'esportazione ZIP sale alla fase 1.
- Qual è il tetto di spesa mensile accettabile?
- La libreria degli stili serve dalla fase 1 o può aspettare la fase 2?
- I bambini la usano da soli? In quel caso conviene un controllo dei contenuti prima dell'invio, oltre ai filtri di OpenAI.

## Fonti

Ricerca del 15 novembre 2026. Prezzi e identificativi dei modelli vanno riverificati sulle pagine ufficiali prima dell'implementazione.

- [OpenAI, guida alla generazione di immagini](https://developers.openai.com/api/docs/guides/image-generation)
- [Wikipedia, GPT Image](https://en.wikipedia.org/wiki/GPT_Image)
- [Developers Digest, GPT Image 2.5 Sunburst e Flare](https://www.developersdigest.tech/blog/gpt-image-2-5-sunburst-flare)
- [Atlas Cloud, GPT Image 2.5 API](https://www.atlascloud.ai/models/gpt-image-2.5)
- [Electrobun, changelog 2.x](https://framework.blackboard.sh/electrobun/guides/changelog/v2-x/)
- [Electrobun, annuncio della 2.0](https://electrobun.dev/blog/electrobun-2-0/)
- [my-mame-ui, Electrobun su Windows e Linux](https://github.com/smolak/my-mame-ui/issues/11)
