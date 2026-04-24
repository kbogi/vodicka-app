-- ============================================================
-- Vodička — SQL schema pro Supabase (Postgres)
-- ============================================================
-- MVP test mode: RLS zapnuté ale s „allow all" politikou, žádná
-- autentizace. Kdokoliv s anon_key vidí a upravuje všechno.
-- Pro produkci přidej řádné policies nebo auth bránu.
-- ============================================================

-- Pomocná funkce: Last-Write-Wins guard. Když přichozí UPDATE má
-- starší updated_at než existující řádek, update se ignoruje.
-- Tím chráníme před tím, že offline zařízení po návratu přepíše
-- novější změny z jiného zařízení.
create or replace function public.lww_guard()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'UPDATE'
     and new.updated_at is not null
     and old.updated_at is not null
     and new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

-- ============================================================
-- Events
-- ============================================================
create table if not exists public.events (
  id uuid primary key,
  name text not null,
  date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

drop trigger if exists lww_events on public.events;
create trigger lww_events before update on public.events
  for each row execute procedure public.lww_guard();

-- ============================================================
-- Stages
-- ============================================================
create table if not exists public.stages (
  id uuid primary key,
  event_id uuid not null,
  name text not null,
  order_index integer not null default 0,
  default_interval_seconds integer not null default 30,
  first_start_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists stages_event_id_idx on public.stages (event_id);

drop trigger if exists lww_stages on public.stages;
create trigger lww_stages before update on public.stages
  for each row execute procedure public.lww_guard();

-- ============================================================
-- Racers
-- ============================================================
create table if not exists public.racers (
  id uuid primary key,
  event_id uuid not null,
  bib_number integer not null,
  first_name text not null default '',
  last_name text not null default '',
  category text not null default '',
  club text not null default '',
  dob date,
  notes text not null default '',
  dns boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists racers_event_id_idx on public.racers (event_id);
create index if not exists racers_event_bib_idx on public.racers (event_id, bib_number);

drop trigger if exists lww_racers on public.racers;
create trigger lww_racers before update on public.racers
  for each row execute procedure public.lww_guard();

-- ============================================================
-- Start entries
-- ============================================================
create table if not exists public.start_entries (
  id uuid primary key,
  stage_id uuid not null,
  racer_id uuid,
  bib_guess integer,
  order_index integer not null default 0,
  scheduled_start timestamptz,
  actual_start timestamptz,
  status text not null default 'pending',
  device_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists start_entries_stage_id_idx on public.start_entries (stage_id);
create index if not exists start_entries_racer_id_idx on public.start_entries (racer_id);

drop trigger if exists lww_start_entries on public.start_entries;
create trigger lww_start_entries before update on public.start_entries
  for each row execute procedure public.lww_guard();

-- ============================================================
-- Finish entries
-- ============================================================
create table if not exists public.finish_entries (
  id uuid primary key,
  stage_id uuid not null,
  racer_id uuid,
  bib_guess integer,
  finish_time timestamptz not null,
  device_id text not null default '',
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists finish_entries_stage_id_idx on public.finish_entries (stage_id);
create index if not exists finish_entries_racer_id_idx on public.finish_entries (racer_id);

drop trigger if exists lww_finish_entries on public.finish_entries;
create trigger lww_finish_entries before update on public.finish_entries
  for each row execute procedure public.lww_guard();

-- ============================================================
-- Row Level Security — „allow all" pro test mode.
-- ============================================================
alter table public.events        enable row level security;
alter table public.stages        enable row level security;
alter table public.racers        enable row level security;
alter table public.start_entries enable row level security;
alter table public.finish_entries enable row level security;

drop policy if exists "Allow all on events"         on public.events;
drop policy if exists "Allow all on stages"         on public.stages;
drop policy if exists "Allow all on racers"         on public.racers;
drop policy if exists "Allow all on start_entries"  on public.start_entries;
drop policy if exists "Allow all on finish_entries" on public.finish_entries;

create policy "Allow all on events"         on public.events         for all using (true) with check (true);
create policy "Allow all on stages"         on public.stages         for all using (true) with check (true);
create policy "Allow all on racers"         on public.racers         for all using (true) with check (true);
create policy "Allow all on start_entries"  on public.start_entries  for all using (true) with check (true);
create policy "Allow all on finish_entries" on public.finish_entries for all using (true) with check (true);

-- ============================================================
-- Realtime publication — aby přicházely změny přes WebSocket.
-- ============================================================
alter table public.events         replica identity full;
alter table public.stages         replica identity full;
alter table public.racers         replica identity full;
alter table public.start_entries  replica identity full;
alter table public.finish_entries replica identity full;

-- Přidat tabulky do publication. Pokud už v ní jsou, skočí warning
-- a běží se dál (DO $$ ... $$ blok ignoruje chybu).
do $$
begin
  begin
    alter publication supabase_realtime add table public.events;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.stages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.racers;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.start_entries;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.finish_entries;
  exception when duplicate_object then null;
  end;
end $$;
