-- Ejecuta este SQL en tu proyecto de Supabase
-- Dashboard → SQL Editor → New query

create table if not exists itinerary (
  day_num    int  primary key,
  notes      text default '',
  places     jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);

-- Insertar los 8 días vacíos
insert into itinerary (day_num) values (1),(2),(3),(4),(5),(6),(7),(8)
on conflict (day_num) do nothing;

-- Permitir lectura y escritura sin autenticación
-- (la app es personal, no hay datos sensibles)
alter table itinerary enable row level security;

create policy "acceso publico"
  on itinerary for all
  using (true)
  with check (true);
