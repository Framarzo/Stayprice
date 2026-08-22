# HANDOFF — stato del progetto "Tabellone"

Questo progetto è stato scritto in una chat Claude.ai senza accesso a internet:
tutto il codice è stato controllato solo a livello sintattico (con `tsc`,
in modalità JS permissiva). Non è mai stato installato, compilato, né
eseguito davvero. Considera il codice un impianto completo ma **non ancora
verificato end-to-end** — è il punto di partenza logico, non un progetto
già testato.

## Aggiornamento — sessione successiva (Claude Code)

Al momento dell'upload di questo HANDOFF, il repository conteneva solo
`README.md`, `package.json`, `next.config.js`, `supabase-schema.sql` e un
`ui.js` in root — **non** `pages/`, `components/`, `.env.local.example` né
le API route citate sotto in "File da leggere per primi". In questa
sessione sono stati ricostruiti i pezzi mancanti, basandosi sulla logica
già presente nel vecchio `ui.js` (spostato in `components/ui.js`, contenuto
invariato) e sullo schema Supabase:

- `lib/supabaseClient.js` — client Supabase condiviso.
- `pages/_app.js`, `styles/globals.css` — layout globale e CSS.
- `pages/index.js` — login con magic link (form custom, non i pacchetti
  `@supabase/auth-ui-*`: sono stati rimossi da `package.json` perché non
  usati, per ridurre il rischio di incompatibilità mai verificato).
- `pages/dashboard.js` — elenco strutture del proprietario + form per
  aggiungerne una nuova.
- `pages/property/[id].js` — pagina struttura: listino prezzi, stato
  libero/occupato dal calendario iCal, "Controllo rapido" prezzo volo con
  suggerimento tariffa, storico controlli con grafico (`recharts`,
  dipendenza già presente in `package.json` ma finora inutilizzata),
  impostazioni del modello (elasticità/tetti/soglia).
- `pages/api/ical-availability.js` — legge un feed `.ics` con `node-ical` e
  restituisce solo i periodi occupato/libero.
- `pages/api/flight-price.js` — cerca il prezzo volo: prova SerpApi
  (Google Flights), poi Travelpayouts (`v2/prices/latest`) come riserva.
- `.env.local.example`, `.gitignore`.

**Resta tutto ciò che era già segnato come non fatto qui sotto** (npm
install/build mai eseguiti, nessun progetto Supabase reale, login mai
provato end-to-end, endpoint iCal mai testato contro un feed vero, nessuna
privacy policy, nessun deploy) — questa sessione ha scritto codice, non lo
ha eseguito né verificato contro servizi reali.

## Cosa fa l'app

App multi-struttura per proprietari di B&B/case vacanza: ogni proprietario
crea un account, collega il calendario iCal della propria struttura, tiene
un listino prezzi per periodo, e riceve un suggerimento di tariffa basato
sul confronto tra il prezzo attuale dei voli verso l'aeroporto di
riferimento e la media dei controlli precedenti per lo stesso periodo.

## Decisioni architetturali (e perché)

- **Next.js (Pages Router)** — scelto per semplicità di deploy su Vercel e
  perché le API route servono comunque per due cose che non possono girare
  nel browser: leggere calendari iCal esterni (CORS/credenziali) e
  chiamare le API dei prezzi voli (chiavi private).
- **Supabase** per autenticazione (magic link via email) + database
  Postgres — un solo servizio invece di due, pensato per un proprietario
  non tecnico che deve configurarlo una volta sola. Row Level Security
  (vedi `supabase-schema.sql`) isola i dati tra proprietari a livello di
  database, non solo di codice applicativo.
- **Prezzi voli**: prova prima Google Flights via SerpApi (dati live, a
  pagamento oltre la soglia gratuita), poi Travelpayouts come riserva
  gratuita (dati di cache fino a 7 giorni). Amadeus è stato scartato: il
  suo programma self-service gratuito è stato chiuso il 17 luglio 2026.
- **node-ical** per leggere i feed `.ics`: importante, iCal trasmette solo
  occupato/libero, **mai il prezzo** — nessuna piattaforma lo espone così.
  Il prezzo mostrato viene sempre dal listino interno dell'app, incrociato
  con lo stato del calendario.
- **localStorage → Supabase**: le versioni precedenti (single-tenant)
  salvavano tutto nel browser. Questa versione multi-tenant sposta tutto
  nel database; non c'è più localStorage nel codice.

## Cosa NON è ancora stato fatto (prossimi passi consigliati)

1. **`npm install` mai eseguito.** Le versioni in `package.json` sono
   caret ranges (`^`) scelte a memoria, non verificate contro il registry
   npm reale. Primo passo: installare e vedere cosa si rompe.
2. **`npm run build` mai eseguito.** Possibili errori di import, di tipi
   impliciti, o incompatibilità tra Next 14 e le versioni reali dei
   pacchetti Supabase Auth UI installate.
3. **Nessun progetto Supabase esiste ancora.** Lo schema
   (`supabase-schema.sql`) non è mai stato eseguito contro un database
   reale — le policy RLS sono scritte per essere corrette ma non testate.
4. **Il flusso di login (magic link) non è mai stato provato** end-to-end
   — vale la pena verificare che il redirect dopo il click sul link email
   funzioni con l'URL di Vercel una volta fatto il deploy.
5. **L'endpoint iCal (`pages/api/ical-availability.js`) non è mai stato
   testato contro un vero feed `.ics`** di Booking.com o Airbnb — vale la
   pena procurarsi un link reale presto e verificare che `node-ical` lo
   interpreti come previsto (formati e fusi orari possono variare).
6. **Nessuna informativa privacy / termini di servizio.** Necessari prima
   di far usare l'app a proprietari reali (dati di terzi, GDPR). Non è un
   compito da delegare a un agente di codice — serve un professionista.
7. **Deploy su Vercel mai avvenuto.**

## File da leggere per primi

- `README.md` — guida passo-passo pensata per un utente non tecnico
  (creazione account Supabase/SerpApi/Vercel, variabili d'ambiente).
- `supabase-schema.sql` — schema completo da eseguire su Supabase.
- `.env.local.example` — elenco delle variabili d'ambiente richieste.
- `components/ui.js` — logica e componenti condivisi (calendario,
  calcolo del suggerimento prezzo, formattazioni).
- `pages/property/[id].js` — la pagina principale, il file più corposo.
