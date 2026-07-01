-- Extensión del modelo para importar el padrón municipal escaneado del 30/06/2026.
-- Ejecutar una sola vez antes de pdf_import_data.sql.

alter table public.green_spaces alter column latitude drop not null;
alter table public.green_spaces alter column longitude drop not null;
alter table public.green_spaces add column if not exists source_type text;
alter table public.green_spaces add column if not exists surface_m2 numeric(14,2);
alter table public.green_spaces add column if not exists section_code text;
alter table public.green_spaces add column if not exists source_document text;
alter table public.green_spaces add column if not exists source_key text;
create unique index if not exists green_spaces_source_key_uidx on public.green_spaces(source_key) where source_key is not null;

create table if not exists public.service_sections (
  section_code text primary key,
  provider_id uuid not null references public.providers(id) on delete restrict,
  declared_spaces integer not null,
  declared_surface_m2 numeric(14,2) not null,
  source_document text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.maintenance_checks (
  id uuid primary key default gen_random_uuid(),
  maintenance_task_id uuid not null references public.maintenance_tasks(id) on delete cascade,
  check_number smallint not null check (check_number between 1 and 3),
  checked_at date,
  performed boolean,
  observations text,
  checked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (maintenance_task_id, check_number)
);

alter table public.service_sections enable row level security;
alter table public.maintenance_checks enable row level security;
create policy "Public read service sections" on public.service_sections for select using (true);
create policy "Public read maintenance checks" on public.maintenance_checks for select using (true);
