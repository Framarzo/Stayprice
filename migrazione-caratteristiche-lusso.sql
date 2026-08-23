-- Migrazione: caratteristiche della struttura usate per suggerire
-- automaticamente la fascia (economy / standard / luxury) in base a
-- grandezza e servizi (piscina, SPA, vista mare, ecc.).
--
-- Esegui questo script UNA VOLTA nell'SQL Editor di Supabase
-- (Supabase → il tuo progetto → SQL Editor → New query → incolla → Run).
-- È sicuro da eseguire anche più di una volta: usa "IF NOT EXISTS".

-- Grandezza della struttura in metri quadri.
alter table public.properties
  add column if not exists size_sqm numeric;

-- Elenco dei servizi presenti (piscina, sauna, vasca idromassaggio, SPA,
-- vista mare, cucina attrezzata/chef privato, palestra, pulizie
-- giornaliere, colazione inclusa, aria condizionata, parcheggio gratuito),
-- salvato come lista di chiavi testuali per restare facilmente estendibile
-- in futuro senza bisogno di altre migrazioni.
alter table public.properties
  add column if not exists amenities text[] not null default '{}';
