-- Schema del database "Tabellone BDS" multi-struttura.
-- Da eseguire una sola volta nell'SQL Editor del progetto Supabase
-- (Supabase → il tuo progetto → SQL Editor → New query → incolla tutto → Run).

create extension if not exists pgcrypto;

-- Una riga per ogni struttura ricettiva collegata da un proprietario.
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  airport_code text default 'BDS',
  ical_url text,
  created_at timestamptz default now()
);

-- Prezzo camera/notte impostato una volta per ciascun periodo (check-in/check-out).
create table if not exists listino (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties on delete cascade not null,
  check_in date not null,
  check_out date not null,
  price numeric not null,
  created_at timestamptz default now(),
  unique (property_id, check_in, check_out)
);

-- Storico dei controlli prezzo voli.
create table if not exists flight_checks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties on delete cascade not null,
  check_in date not null,
  check_out date not null,
  origin text,
  flight_price numeric not null,
  source text,
  note text,
  created_at timestamptz default now()
);

-- Impostazioni del modello (elasticità, tetti, soglia) per struttura.
create table if not exists settings (
  property_id uuid primary key references properties on delete cascade not null,
  elasticity numeric default 0.4,
  cap_up numeric default 20,
  cap_down numeric default 15,
  threshold numeric default 5
);

create index if not exists listino_property_idx on listino (property_id);
create index if not exists flight_checks_property_idx on flight_checks (property_id);

-- Riga per riga, ogni proprietario vede e modifica solo le proprie strutture e i dati collegati.
alter table properties enable row level security;
alter table listino enable row level security;
alter table flight_checks enable row level security;
alter table settings enable row level security;

drop policy if exists "properties_owner" on properties;
create policy "properties_owner" on properties
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "listino_owner" on listino;
create policy "listino_owner" on listino
  for all using (
    exists (select 1 from properties p where p.id = listino.property_id and p.user_id = auth.uid())
  )
  with check (
    exists (select 1 from properties p where p.id = listino.property_id and p.user_id = auth.uid())
  );

drop policy if exists "flight_checks_owner" on flight_checks;
create policy "flight_checks_owner" on flight_checks
  for all using (
    exists (select 1 from properties p where p.id = flight_checks.property_id and p.user_id = auth.uid())
  )
  with check (
    exists (select 1 from properties p where p.id = flight_checks.property_id and p.user_id = auth.uid())
  );

drop policy if exists "settings_owner" on settings;
create policy "settings_owner" on settings
  for all using (
    exists (select 1 from properties p where p.id = settings.property_id and p.user_id = auth.uid())
  )
  with check (
    exists (select 1 from properties p where p.id = settings.property_id and p.user_id = auth.uid())
  );
