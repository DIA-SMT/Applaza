-- Fecha real de carga de las evidencias fotográficas (opcional, recomendado para auditoría).
--
-- Desde que se puede cargar una evidencia con la fecha de un control pasado, created_at guarda la
-- fecha del control (la que cuenta en informes y auditoría). Esta columna conserva cuándo se cargó
-- realmente, y la app muestra "cargada el dd/mm/aaaa" cuando no coincide con la fecha del control.
-- La app funciona igual sin ejecutar este script; solo no muestra esa marca.
--
-- Ejecutar una vez en el SQL Editor de Supabase. Es seguro volver a ejecutarlo.

alter table public.maintenance_photos add column if not exists uploaded_at timestamptz;

-- Evidencias existentes: hasta hoy la fecha de carga era la misma que created_at.
update public.maintenance_photos set uploaded_at = created_at where uploaded_at is null;

alter table public.maintenance_photos alter column uploaded_at set default now();
alter table public.maintenance_photos alter column uploaded_at set not null;

-- La fecha de carga la pone siempre la base: el navegador no la puede elegir ni cambiar.
create or replace function public.set_photo_uploaded_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.uploaded_at := now();
  else
    new.uploaded_at := old.uploaded_at;
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_photos_uploaded_at on public.maintenance_photos;
create trigger maintenance_photos_uploaded_at
before insert or update on public.maintenance_photos
for each row execute function public.set_photo_uploaded_at();

-- Vista de evidencias: se agrega la fecha de carga al final.
create or replace view public.maintenance_photo_evidence
with (security_invoker = true) as
select
  photos.id,
  photos.maintenance_task_id,
  tasks.green_space_id,
  spaces.name as green_space_name,
  spaces.type as green_space_type,
  photos.image_url,
  photos.photo_type,
  photos.uploaded_by,
  photos.latitude,
  photos.longitude,
  photos.created_at,
  photos.uploaded_at
from public.maintenance_photos photos
join public.maintenance_tasks tasks on tasks.id = photos.maintenance_task_id
join public.green_spaces spaces on spaces.id = tasks.green_space_id;
