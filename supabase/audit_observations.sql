-- Ejecutar en Supabase SQL Editor para habilitar observaciones de auditoria.
create extension if not exists "pgcrypto";

create table if not exists public.audit_observations (
  id uuid primary key default gen_random_uuid(),
  green_space_id uuid not null references public.green_spaces(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete set null,
  period_month date not null,
  observation text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists audit_observations_period_idx
on public.audit_observations(period_month);

create index if not exists audit_observations_space_period_idx
on public.audit_observations(green_space_id, period_month);

alter table public.audit_observations enable row level security;

drop policy if exists "Authenticated read audit observations" on public.audit_observations;
create policy "Authenticated read audit observations"
on public.audit_observations
for select
to authenticated
using (true);

drop policy if exists "Admins and auditors insert audit observations" on public.audit_observations;
create policy "Admins and auditors insert audit observations"
on public.audit_observations
for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.current_user_role()::text in ('admin','auditor')
);
