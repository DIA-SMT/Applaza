-- Ejecutar en Supabase SQL Editor para habilitar el rol auditor.
alter type public.user_role add value if not exists 'auditor';

-- Reemplazar el correo por el usuario real que va a auditar.
-- update public.profiles
-- set role = 'auditor',
--     full_name = coalesce(nullif(full_name, ''), 'Auditor Municipal')
-- where id = (
--   select id
--   from auth.users
--   where email = 'auditor@smt.gob.ar'
-- );

-- Para verificar:
-- select p.id, u.email, p.full_name, p.role
-- from public.profiles p
-- join auth.users u on u.id = p.id
-- where p.role = 'auditor';
