-- Latido para que el proyecto gratuito no se pause por inactividad.
-- El workflow keep-alive de GitHub llama a public.keep_alive() por RPC
-- y la funcion escribe una fila real, en vez de un SELECT que RLS deja vacio.

create table if not exists public.keep_alive (
  id smallint primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now()
);

-- Sin politicas: nadie la lee ni la escribe por la API, solo la funcion.
alter table public.keep_alive enable row level security;

create or replace function public.keep_alive()
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  insert into public.keep_alive (id, pinged_at)
  values (1, now())
  on conflict (id) do update set pinged_at = excluded.pinged_at
  returning pinged_at;
$$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;

-- Primer latido, para comprobar que funciona.
select public.keep_alive();
