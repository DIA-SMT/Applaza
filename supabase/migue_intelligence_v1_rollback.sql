-- Reversión de migue_intelligence_v1.sql. Borra SOLO lo que creó esa migración (incluidos los
-- análisis y revisiones guardados). No toca fotos, tareas ni espacios.
-- Antes de ejecutarla en producción, conviene exportar photo_analyses y photo_analysis_reviews.

drop trigger if exists maintenance_photos_migue_enqueue on public.maintenance_photos;
drop function if exists public.migue_enqueue_photo();
drop function if exists public.migue_claim_jobs(text, integer);
drop function if exists public.migue_finish_job(uuid, boolean, text, boolean);
drop function if exists public.migue_enqueue_backfill(integer);

drop table if exists public.photo_analysis_reviews;
drop table if exists public.migue_usage;
drop table if exists public.photo_analyses;
drop table if exists public.migue_jobs;
drop table if exists public.migue_rubrics;
