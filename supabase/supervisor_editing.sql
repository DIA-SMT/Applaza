-- Ejecutar en SQL Editor para habilitar el rol supervisor y la edición operativa.
alter type public.user_role add value if not exists 'supervisor';

drop policy if exists "Staff update locations" on public.green_spaces;
create policy "Staff update locations" on public.green_spaces for update to authenticated
using (public.current_user_role()::text in ('admin','supervisor','inspector'))
with check (public.current_user_role()::text in ('admin','supervisor','inspector'));

drop policy if exists "Staff manage tasks" on public.maintenance_tasks;
create policy "Staff manage tasks" on public.maintenance_tasks for all to authenticated
using (public.current_user_role()::text in ('admin','supervisor','inspector'))
with check (public.current_user_role()::text in ('admin','supervisor','inspector'));

-- Ejemplo para asignar el rol:
-- update public.profiles set role='supervisor' where id=(select id from auth.users where email='supervisor@smt.gob.ar');
