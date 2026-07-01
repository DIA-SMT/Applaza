create extension if not exists "pgcrypto";

create table if not exists public.control_records (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers(id) on delete cascade,
  green_space_id uuid not null references public.green_spaces(id) on delete cascade,
  period_month date not null,
  control_1 text check (control_1 in ('si','no')),
  control_1_date date,
  control_2 text check (control_2 in ('si','no')),
  control_2_date date,
  control_3 text check (control_3 in ('si','no')),
  control_3_date date,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint control_records_provider_space_month_key unique (provider_id, green_space_id, period_month)
);

create index if not exists control_records_provider_month_idx
on public.control_records(provider_id, period_month);

create index if not exists control_records_space_month_idx
on public.control_records(green_space_id, period_month);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists control_records_updated_at on public.control_records;
create trigger control_records_updated_at
before update on public.control_records
for each row execute function public.set_updated_at();

alter table public.control_records enable row level security;

drop policy if exists "Authenticated read control records" on public.control_records;
create policy "Authenticated read control records"
on public.control_records
for select
to authenticated
using (true);

drop policy if exists "Authenticated insert control records" on public.control_records;
create policy "Authenticated insert control records"
on public.control_records
for insert
to authenticated
with check (recorded_by = auth.uid());

drop policy if exists "Authenticated update control records" on public.control_records;
create policy "Authenticated update control records"
on public.control_records
for update
to authenticated
using (true)
with check (recorded_by = auth.uid());
