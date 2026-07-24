-- Calificacion mensual de cooperativas: cumplio/no cumplio + observacion.
-- Ejecutar en el SQL Editor de Supabase.

create extension if not exists "pgcrypto";

create table if not exists public.provider_ratings (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  period_month date not null,
  fulfilled text not null check (fulfilled in ('si','no')),
  observations text not null default '',
  rated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provider_ratings_provider_month_key unique (provider_id, period_month)
);

create index if not exists provider_ratings_provider_month_idx
on public.provider_ratings(provider_id, period_month);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists provider_ratings_updated_at on public.provider_ratings;
create trigger provider_ratings_updated_at
before update on public.provider_ratings
for each row execute function public.set_updated_at();

alter table public.provider_ratings enable row level security;

drop policy if exists "Authenticated read provider ratings" on public.provider_ratings;
create policy "Authenticated read provider ratings"
on public.provider_ratings
for select
to authenticated
using (true);

drop policy if exists "Staff insert provider ratings" on public.provider_ratings;
create policy "Staff insert provider ratings"
on public.provider_ratings
for insert
to authenticated
with check (rated_by = auth.uid() and public.current_user_role()::text in ('admin','supervisor','inspector','auditor'));

drop policy if exists "Staff update provider ratings" on public.provider_ratings;
create policy "Staff update provider ratings"
on public.provider_ratings
for update
to authenticated
using (public.current_user_role()::text in ('admin','supervisor','inspector','auditor'))
with check (rated_by = auth.uid());
