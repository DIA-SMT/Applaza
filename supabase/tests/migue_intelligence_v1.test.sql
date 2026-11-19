-- Prueba de supabase/migue_intelligence_v1.sql en una base DESCARTABLE (nunca en producción).
-- Ejecutar con supabase/tests/probar-migracion.sh, que copia la estructura (sin datos) y borra todo al final.
-- Esperado: los bloques marcados "deben fallar" dan ERROR; el resto pasa; al final 0 tablas de Migue.
\set ON_ERROR_STOP on
\echo '== 1. Migración (dos veces: debe ser re-ejecutable)'
\i /tmp/migue/migue_intelligence_v1.sql
\i /tmp/migue/migue_intelligence_v1.sql

\echo '== 2. Datos de prueba'
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'inspector@prueba.test'),
  ('22222222-2222-4222-8222-222222222222', 'proveedor@prueba.test');
insert into public.profiles (id, full_name, role) values
  ('11111111-1111-4111-8111-111111111111', 'Inspector', 'inspector'),
  ('22222222-2222-4222-8222-222222222222', 'Proveedor', 'provider')
on conflict (id) do update set role = excluded.role;
insert into public.green_spaces (id, name, type, latitude, longitude) values ('33333333-3333-4333-8333-333333333333', 'Plaza prueba', 'plaza', -26.8, -65.2);
insert into public.maintenance_tasks (id, green_space_id, start_date, end_date) values ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', '2026-11-01', '2026-11-30');

\echo '== 3. Sin rúbrica activa: subir una foto NO encola nada'
insert into public.maintenance_photos (id, maintenance_task_id, image_url, photo_type, uploaded_by)
values ('55555555-5555-4555-8555-555555555551', '44444444-4444-4444-8444-444444444444', 'https://x.test/1.jpg', 'antes', '11111111-1111-4111-8111-111111111111');
select count(*) as trabajos_sin_rubrica from public.migue_jobs;

\echo '== 4. Con rúbrica activa: encola una vez por foto'
insert into public.migue_rubrics (version, name, definition, active) values ('espacios-verdes-v1', 'Prueba', '{}', true);
insert into public.maintenance_photos (id, maintenance_task_id, image_url, photo_type, uploaded_by)
values ('55555555-5555-4555-8555-555555555552', '44444444-4444-4444-8444-444444444444', 'https://x.test/2.jpg', 'durante', '11111111-1111-4111-8111-111111111111');
select count(*) as trabajos_tras_foto_nueva from public.migue_jobs;
select public.migue_enqueue_backfill(100) as backfill_1;
select public.migue_enqueue_backfill(100) as backfill_2_idempotente;
select count(*) as trabajos_total from public.migue_jobs;

\echo '== 5. Una sola rúbrica activa'
\set ON_ERROR_STOP off
insert into public.migue_rubrics (version, name, definition, active) values ('otra', 'Otra', '{}', true);
\set ON_ERROR_STOP on

\echo '== 6. Cola: tomar, fallar con reintento, agotar intentos, terminar bien'
select count(*) as tomados from public.migue_claim_jobs('w1', 10);
select count(*) as tomados_de_nuevo_debe_ser_0 from public.migue_claim_jobs('w2', 10);
select public.migue_finish_job(id, false, 'HTTP 503', true) from public.migue_jobs where photo_id = '55555555-5555-4555-8555-555555555551';
select public.migue_finish_job(id, true) from public.migue_jobs where photo_id = '55555555-5555-4555-8555-555555555552';
select photo_id, status, attempts, run_after > now() as con_espera, last_error from public.migue_jobs order by photo_id;
update public.migue_jobs set attempts = max_attempts, status = 'procesando' where photo_id = '55555555-5555-4555-8555-555555555551';
select public.migue_finish_job(id, false, 'HTTP 503', true) from public.migue_jobs where photo_id = '55555555-5555-4555-8555-555555555551';
select status as tras_agotar_intentos from public.migue_jobs where photo_id = '55555555-5555-4555-8555-555555555551';

\echo '== 7. Guardar análisis'
insert into public.photo_analyses (photo_id, job_id, mode, model, prompt_version, rubric_version, suggested_status, overall_score, coverage_evaluated, coverage_total, output)
select photo_id, id, 'prueba', 'prueba/sin-modelo', 'foto-v1', 'espacios-verdes-v1', 'satisfactorio', 85, 8, 8, '{}' from public.migue_jobs where status = 'listo';

\echo '== 8. Permisos como inspector'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false), set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select auth.uid() as uid, public.current_user_role() as rol, current_user;
select count(*) as inspector_lee_analisis from public.photo_analyses;
select count(*) as inspector_lee_uso_debe_ser_0 from public.migue_usage;
insert into public.photo_analysis_reviews (analysis_id, decision, comment) select id, 'confirmado', 'Coincide' from public.photo_analyses;
select decision, reviewed_by from public.photo_analysis_reviews;
\set ON_ERROR_STOP off
\echo '-- (deben fallar) inspector escribe análisis / usa la cola / corrige sin corrección / revisa en nombre de otro'
insert into public.photo_analyses (photo_id, mode, model, prompt_version, rubric_version, suggested_status, coverage_evaluated, coverage_total, output) values ('55555555-5555-4555-8555-555555555551', 'real', 'x', 'x', 'espacios-verdes-v1', 'critico', 1, 8, '{}');
select public.migue_claim_jobs('intruso', 1);
insert into public.photo_analysis_reviews (analysis_id, decision) select id, 'corregido' from public.photo_analyses;
insert into public.photo_analysis_reviews (analysis_id, decision, reviewed_by) select id, 'rechazado', '22222222-2222-4222-8222-222222222222' from public.photo_analyses;
update public.photo_analysis_reviews set decision = 'rechazado';
select count(*) as revisiones_siguen_confirmadas from public.photo_analysis_reviews where decision = 'confirmado';
\set ON_ERROR_STOP on

\echo '== 9. Permisos como proveedor: lee pero no revisa'
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', false), set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
\set ON_ERROR_STOP off
insert into public.photo_analysis_reviews (analysis_id, decision) select id, 'confirmado' from public.photo_analyses;
\set ON_ERROR_STOP on
reset role;

\echo '== 10. Borrar una foto borra sus trabajos y análisis'
delete from public.maintenance_photos where id = '55555555-5555-4555-8555-555555555552';
select (select count(*) from public.photo_analyses) as analisis, (select count(*) from public.photo_analysis_reviews) as revisiones;

\echo '== 11. Reversión'
\i /tmp/migue/migue_intelligence_v1_rollback.sql
select count(*) as tablas_migue_restantes from information_schema.tables where table_schema = 'public' and (table_name like 'migue_%' or table_name like 'photo_analys%');
select count(*) as fotos_intactas from public.maintenance_photos;
\echo '== FIN'
