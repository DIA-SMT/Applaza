create extension if not exists "pgcrypto";

create type public.green_space_type as enum ('plaza', 'espacio_verde', 'platabanda');
create type public.maintenance_status as enum ('programado', 'en_curso', 'finalizado', 'vencido', 'incumplido', 'observado');
create type public.fulfillment_status as enum ('si', 'no', 'pendiente');
create type public.photo_type as enum ('antes', 'durante', 'despues');

create table public.providers (
  id uuid primary key default gen_random_uuid(), name text not null, contact_name text, phone text, email text, notes text,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.green_spaces (
  id uuid primary key default gen_random_uuid(), name text not null, type public.green_space_type not null, address text, neighborhood text,
  latitude double precision not null check (latitude between -90 and 90), longitude double precision not null check (longitude between -180 and 180),
  status public.maintenance_status not null default 'programado', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.maintenance_tasks (
  id uuid primary key default gen_random_uuid(), green_space_id uuid not null references public.green_spaces(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete set null, start_date date not null, end_date date not null,
  completed_date date, status public.maintenance_status not null default 'programado', fulfilled public.fulfillment_status not null default 'pendiente',
  observations text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check (end_date >= start_date)
);
create table public.maintenance_photos (
  id uuid primary key default gen_random_uuid(), maintenance_task_id uuid not null references public.maintenance_tasks(id) on delete cascade,
  image_url text not null, photo_type public.photo_type not null, uploaded_by uuid references auth.users(id) on delete set null,
  latitude double precision check (latitude between -90 and 90), longitude double precision check (longitude between -180 and 180), created_at timestamptz not null default now()
);
create index maintenance_tasks_space_idx on public.maintenance_tasks(green_space_id);
create index maintenance_tasks_provider_idx on public.maintenance_tasks(provider_id);
create index maintenance_photos_task_idx on public.maintenance_photos(maintenance_task_id);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger providers_updated_at before update on public.providers for each row execute function public.set_updated_at();
create trigger green_spaces_updated_at before update on public.green_spaces for each row execute function public.set_updated_at();
create trigger maintenance_tasks_updated_at before update on public.maintenance_tasks for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public) values ('maintenance-photos', 'maintenance-photos', true) on conflict (id) do nothing;
alter table public.providers enable row level security; alter table public.green_spaces enable row level security; alter table public.maintenance_tasks enable row level security; alter table public.maintenance_photos enable row level security;
create policy "Public read providers" on public.providers for select using (true);
create policy "Public read spaces" on public.green_spaces for select using (true);
create policy "Public read tasks" on public.maintenance_tasks for select using (true);
create policy "Public read photos" on public.maintenance_photos for select using (true);
create policy "Authenticated insert photos" on public.maintenance_photos for insert to authenticated with check (auth.uid() = uploaded_by);
create policy "Authenticated upload evidence" on storage.objects for insert to authenticated with check (bucket_id = 'maintenance-photos');
create policy "Public evidence access" on storage.objects for select using (bucket_id = 'maintenance-photos');
