-- Habilitar el alta rápida en campo desde Applaza (nuevo espacio con GPS).
-- Ejecutar una sola vez en el SQL Editor de Supabase.

drop policy if exists "Staff insert spaces" on public.green_spaces;
create policy "Staff insert spaces" on public.green_spaces for insert to authenticated
with check (public.current_user_role()::text in ('admin','supervisor','inspector'));
