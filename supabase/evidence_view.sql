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
  photos.created_at
from public.maintenance_photos photos
join public.maintenance_tasks tasks on tasks.id = photos.maintenance_task_id
join public.green_spaces spaces on spaces.id = tasks.green_space_id;
