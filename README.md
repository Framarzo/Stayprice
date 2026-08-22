# Tabellone

App multi-struttura: ogni proprietario crea un account, collega il calendario iCal della propria struttura, tiene sotto controllo periodi liberi/occupati e prezzi impostati, e riceve un suggerimento di tariffa basato sull'andamento dei voli in arrivo nell'aeroporto di riferimento.

## ⚠️ Prima di far usare l'app ad altre persone

Nel momento in cui altri proprietari caricano i loro dati (calendari, prezzi), stai trattando dati di terzi — in UE questo comporta obblighi di privacy (GDPR). Prima di un lancio pubblico servirebbero come minimo un'informativa privacy e termini di servizio: non sono un avvocato, per quella parte è meglio farsi seguire da un professionista. Tecnicamente l'app è pronta; questo pezzo resta da chiudere separatamente.

## Come funziona, in breve

1. Un proprietario si registra e accede con un **link via email** (nessuna password da ricordare).
2. Dalla dashboard aggiunge una o più strutture: nome, aeroporto di riferimento, e (facoltativo) il link al proprio calendario **iCal** (Booking.com, Airbnb, ecc. lo trovano di solito sotto "Esporta calendario" o "Sincronizzazione calendario").
3. Per ogni struttura: il pannello "Disponibilità e prezzi" mostra i periodi che ha impostato nel listino, con lo stato libero/occupato letto dal calendario iCal.
4. Il "Controllo rapido" cerca il prezzo di un volo (Google Flights o, in riserva, Travelpayouts) e suggerisce se aumentare, ridurre o mantenere la tariffa, confrontandolo con la media dei controlli precedenti per lo stesso periodo.

**Importante sul calendario iCal**: il formato iCal trasmette solo occupato/libero, mai il prezzo — nessuna piattaforma lo espone in questo modo. I prezzi che vedi nell'app vengono dal listino che ogni proprietario imposta qui dentro, incrociato con lo stato del calendario.

## Cosa serve prima di iniziare

- Un account gratuito su [supabase.com](https://supabase.com) (autenticazione + database — un solo servizio per entrambi)
- Un account gratuito su [serpapi.com](https://serpapi.com) (prezzi voli da Google Flights, fonte principale)
- Facoltativo: un account gratuito su [travelpayouts.com](https://www.travelpayouts.com) (fonte di riserva per i prezzi voli)
- Un account gratuito su [GitHub](https://github.com)
- Un account gratuito su [Vercel](https://vercel.com)

## Passo 1 — Crea il progetto Supabase

1. Vai su [supabase.com](https://supabase.com), registrati gratis, crea un nuovo progetto (scegli una password del database, non ti servirà più dopo).
2. Nel progetto, vai su **SQL Editor → New query**, incolla tutto il contenuto del file `supabase-schema.sql` incluso in questo progetto, e premi **Run**. Questo crea le tabelle e le regole di sicurezza (ogni proprietario vede solo i propri dati).
3. Vai su **Project Settings → API**: copia **Project URL** e la chiave **anon public** — ti serviranno al Passo 4.
4. Vai su **Authentication → URL Configuration** e imposta il tuo dominio (lo avrai dopo il Passo 5 su Vercel — puoi tornare qui e aggiornarlo in seguito) come Site URL, così i link di accesso via email puntano al posto giusto.

## Passo 2 — Ottieni la chiave SerpApi (Google Flights)

1. Vai su [serpapi.com](https://serpapi.com), registrati gratis.
2. Copia la tua **Private API Key** dalla dashboard.

## Passo 3 — (Facoltativo) Token Travelpayouts come riserva

1. Vai su [travelpayouts.com](https://www.travelpayouts.com), registrati come "webmaster/editore".
2. Copia il token da **Profilo → API token**.

## Passo 4 — Carica il progetto su GitHub

1. Su [github.com](https://github.com), crea un nuovo repository.
2. Usa **"uploading an existing file"** per caricare tutti i file e cartelle di questo progetto (tranne `.env.local.example`, che è solo un promemoria).
3. Conferma il caricamento.

## Passo 5 — Collega il progetto a Vercel

1. Su [vercel.com](https://vercel.com), registrati (puoi entrare con GitHub) e clicca **Add New → Project**, seleziona il repository.
2. Prima di "Deploy", apri **Environment Variables** e aggiungi:
   - `NEXT_PUBLIC_SUPABASE_URL` → il Project URL del Passo 1
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → la chiave anon public del Passo 1
   - `SERPAPI_KEY` → la chiave del Passo 2
   - `TRAVELPAYOUTS_TOKEN` → il token del Passo 3 (se l'hai fatto)
3. Clicca **Deploy**. Dopo un paio di minuti avrai un indirizzo pubblico tipo `tuonome.vercel.app`.
4. Torna su Supabase (**Authentication → URL Configuration**) e imposta quel dominio come Site URL, così i link di accesso via email funzionano correttamente.

## Dove sono salvati i dati ora

A differenza della prima versione (dati nel browser), ora tutto è nel **database Supabase**: ogni proprietario ha il proprio account e vede solo le proprie strutture, da qualsiasi dispositivo. Le regole di sicurezza (Row Level Security) sono già incluse nello schema e impediscono a un utente di vedere i dati di un altro.

## Se l'installazione (npm install) desse un errore di versione

I numeri di versione nel `package.json` sono indicativi: se durante il deploy su Vercel un pacchetto risultasse non più disponibile in quella versione esatta, rimuovi il numero di versione lasciando solo il nome del pacchetto (es. `"next": "latest"`) e riprova.

## Provarla in locale (facoltativo, richiede Node.js)

```bash
npm install
cp .env.local.example .env.local   # poi incolla le tue chiavi
npm run dev
```

L'app sarà disponibile su `http://localhost:3000`.
