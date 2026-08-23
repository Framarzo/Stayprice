-- Migrazione completa per Tabellone (villa-flight-pricing)
-- Esegui questo script UNA VOLTA nell'SQL Editor di Supabase
-- (Supabase → il tuo progetto → SQL Editor → New query → incolla → Run).
--
-- È sicuro da eseguire anche se alcune colonne esistono già: ogni comando
-- usa "IF NOT EXISTS" o un controllo esplicito, quindi non darà errore né
-- duplicherà nulla se lo lanci più di una volta per sbaglio.

-- 1) Fascia della struttura (economy / standard / luxury)
alter table public.properties
  add column if not exists property_type text not null default 'standard';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'properties_property_type_check'
  ) then
    alter table public.properties
      add constraint properties_property_type_check
      check (property_type in ('economy', 'standard', 'luxury'));
  end if;
end $$;

-- 2) Caratteristiche della struttura, usate per il prezzo di partenza suggerito
alter table public.properties
  add column if not exists address text;

alter table public.properties
  add column if not exists bedrooms integer;

alter table public.properties
  add column if not exists bathrooms numeric;

alter table public.properties
  add column if not exists max_guests integer;

-- 3) Collegamento a Lodgify (nel caso non fosse già stato creato in precedenza)
alter table public.properties
  add column if not exists lodgify_api_key text;

alter table public.properties
  add column if not exists lodgify_property_id bigint;

alter table public.properties
  add column if not exists lodgify_room_type_id bigint;

-- 4) Soglia in deviazioni standard per il "Controllo rapido" (tabella settings)
alter table public.settings
  add column if not exists z_threshold numeric;
