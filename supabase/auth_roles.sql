-- Ejecutar en SQL Editor después de los esquemas anteriores.
do $$ begin create type public.user_role as enum ('admin','supervisor','inspector','provider'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.user_role not null default 'provider',
  provider_id uuid references public.providers(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles (id,full_name) values (new.id,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1))) on conflict (id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

insert into public.profiles (id,full_name) select id,coalesce(raw_user_meta_data->>'full_name',split_part(email,'@',1)) from auth.users on conflict (id) do nothing;

create or replace function public.current_user_role() returns public.user_role language sql stable security definer set search_path=public as $$ select role from public.profiles where id=auth.uid() $$;

drop policy if exists "Profiles read own" on public.profiles;
create policy "Profiles read own" on public.profiles for select to authenticated using (id=auth.uid() or public.current_user_role()='admin');
drop policy if exists "Admins update profiles" on public.profiles;
create policy "Admins update profiles" on public.profiles for update to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');

drop policy if exists "Public read providers" on public.providers;
drop policy if exists "Public read spaces" on public.green_spaces;
drop policy if exists "Public read tasks" on public.maintenance_tasks;
drop policy if exists "Public read photos" on public.maintenance_photos;
drop policy if exists "Public read service sections" on public.service_sections;
drop policy if exists "Public read maintenance checks" on public.maintenance_checks;
create policy "Authenticated read providers" on public.providers for select to authenticated using (true);
create policy "Authenticated read spaces" on public.green_spaces for select to authenticated using (true);
create policy "Authenticated read tasks" on public.maintenance_tasks for select to authenticated using (true);
create policy "Authenticated read photos" on public.maintenance_photos for select to authenticated using (true);
create policy "Authenticated read sections" on public.service_sections for select to authenticated using (true);
create policy "Authenticated read checks" on public.maintenance_checks for select to authenticated using (true);

drop policy if exists "Staff update locations" on public.green_spaces;
create policy "Staff update locations" on public.green_spaces for update to authenticated using (public.current_user_role() in ('admin','supervisor','inspector')) with check (public.current_user_role() in ('admin','supervisor','inspector'));
drop policy if exists "Staff manage tasks" on public.maintenance_tasks;
create policy "Staff manage tasks" on public.maintenance_tasks for all to authenticated using (public.current_user_role() in ('admin','supervisor','inspector')) with check (public.current_user_role() in ('admin','supervisor','inspector'));

-- Después de crear el primer usuario en Authentication > Users, promoverlo manualmente:
-- update public.profiles set role='admin', full_name='Nombre Apellido' where id=(select id from auth.users where email='correo@smt.gob.ar');
