-- Migue Intelligence · Etapa 1: análisis de fotos con revisión humana.
--
-- MIGRACIÓN ADITIVA: solo crea tablas, funciones y un disparador nuevos. No modifica ni borra
-- datos ni columnas existentes. Las fotos originales no se tocan. Reversión:
-- supabase/migue_intelligence_v1_rollback.sql
--
-- Mientras no haya una rúbrica activa en migue_rubrics, el disparador no encola nada: instalar
-- esto no cambia el comportamiento de la app. Se activa con:
--   insert into public.migue_rubrics (version, name, definition, active) values (...);
-- (el worker la carga desde lib/migue-vision/rubric-v1.ts; ver docs/migue-intelligence).
--
-- Seguro de volver a ejecutar.

create extension if not exists "pgcrypto";

-- Rúbricas versionadas. Una versión no se edita: se crea otra.
create table if not exists public.migue_rubrics (
  version text primary key,
  name text not null,
  definition jsonb not null,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists migue_rubrics_one_active on public.migue_rubrics (active) where active;

-- Cola de trabajos (sin servicios extra: Postgres con FOR UPDATE SKIP LOCKED).
create table if not exists public.migue_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('analizar_foto')),
  photo_id uuid not null references public.maintenance_photos(id) on delete cascade,
  rubric_version text not null references public.migue_rubrics(version),
  status text not null default 'pendiente' check (status in ('pendiente','procesando','listo','error','descartado')),
  attempts integer not null default 0,
  max_attempts integer not null default 4,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  -- Una foto se analiza una sola vez por versión de rúbrica, aunque se encole varias veces.
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists migue_jobs_ready_idx on public.migue_jobs (run_after) where status = 'pendiente';
create index if not exists migue_jobs_photo_idx on public.migue_jobs (photo_id);

-- Resultado del análisis de una foto. Nunca se sobrescribe: un reanálisis es otra fila.
create table if not exists public.photo_analyses (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.maintenance_photos(id) on delete cascade,
  job_id uuid unique references public.migue_jobs(id) on delete set null,
  mode text not null check (mode in ('real','prueba')),
  model text not null,
  prompt_version text not null,
  rubric_version text not null references public.migue_rubrics(version),
  suggested_status text not null check (suggested_status in ('satisfactorio','requiere_atencion','critico','indeterminado')),
  overall_score smallint check (overall_score between 0 and 100),
  coverage_evaluated smallint not null,
  coverage_total smallint not null,
  reasons jsonb not null default '[]'::jsonb,
  output jsonb not null,
  warnings jsonb not null default '[]'::jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists photo_analyses_photo_idx on public.photo_analyses (photo_id, created_at desc);

-- Revisión humana: confirmar / corregir / rechazar. Historial sin ediciones ni borrados;
-- la revisión vigente es la más reciente.
create table if not exists public.photo_analysis_reviews (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.photo_analyses(id) on delete cascade,
  decision text not null check (decision in ('confirmado','corregido','rechazado')),
  corrected_status text check (corrected_status in ('satisfactorio','requiere_atencion','critico','indeterminado')),
  corrected_dimensions jsonb,
  comment text not null default '',
  reviewed_by uuid not null default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (decision <> 'corregido' or corrected_status is not null or corrected_dimensions is not null)
);
create index if not exists photo_analysis_reviews_analysis_idx on public.photo_analysis_reviews (analysis_id, created_at desc);

-- Uso y costo de cada llamada al proveedor (también las fallidas, que también se cobran).
create table if not exists public.migue_usage (
  id uuid primary key default gen_random_uuid(),
  feature text not null check (feature in ('analisis_foto','comparacion','chat')),
  job_id uuid references public.migue_jobs(id) on delete set null,
  mode text not null check (mode in ('real','prueba')),
  model text not null,
  ok boolean not null,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12,6),
  created_at timestamptz not null default now()
);
create index if not exists migue_usage_created_idx on public.migue_usage (created_at);

-- Encolado automático al subir una foto (solo si hay rúbrica activa).
create or replace function public.migue_enqueue_photo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rubric text;
begin
  select version into rubric from public.migue_rubrics where active limit 1;
  if rubric is not null then
    insert into public.migue_jobs (kind, photo_id, rubric_version, idempotency_key)
    values ('analizar_foto', new.id, rubric, 'analizar_foto:' || new.id || ':' || rubric)
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_photos_migue_enqueue on public.maintenance_photos;
create trigger maintenance_photos_migue_enqueue
after insert on public.maintenance_photos
for each row execute function public.migue_enqueue_photo();

-- El worker toma trabajos sin pisarse con otro worker. Los que quedaron "procesando" más de
-- 10 minutos (worker caído) vuelven a estar disponibles.
create or replace function public.migue_claim_jobs(worker text, batch integer default 1)
returns setof public.migue_jobs
language sql security definer set search_path = public as $$
  update public.migue_jobs j
  set status = 'procesando', locked_at = now(), locked_by = worker, attempts = j.attempts + 1, updated_at = now()
  where j.id in (
    select id from public.migue_jobs
    where (status = 'pendiente' and run_after <= now())
       or (status = 'procesando' and locked_at < now() - interval '10 minutes')
    order by run_after
    limit greatest(batch, 1)
    for update skip locked
  )
  returning j.*;
$$;

-- Cierra un trabajo: listo, o error con reintento con espera creciente hasta max_attempts.
create or replace function public.migue_finish_job(job uuid, succeeded boolean, error_text text default null, retryable boolean default true)
returns void
language sql security definer set search_path = public as $$
  update public.migue_jobs
  set status = case
        when succeeded then 'listo'
        when retryable and attempts < max_attempts then 'pendiente'
        else 'error' end,
      run_after = case when not succeeded then now() + (interval '1 minute' * power(4, least(attempts, 4))) else run_after end,
      last_error = case when succeeded then null else left(error_text, 500) end,
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where id = job;
$$;

-- Encola fotos ya cargadas (histórico), de a tandas. Devuelve cuántas encoló.
create or replace function public.migue_enqueue_backfill(max_photos integer default 100)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  rubric text;
  inserted integer;
begin
  select version into rubric from public.migue_rubrics where active limit 1;
  if rubric is null then
    raise exception 'No hay rúbrica activa';
  end if;
  insert into public.migue_jobs (kind, photo_id, rubric_version, idempotency_key, run_after)
  select 'analizar_foto', p.id, rubric, 'analizar_foto:' || p.id || ':' || rubric, now()
  from public.maintenance_photos p
  where not exists (select 1 from public.migue_jobs j where j.idempotency_key = 'analizar_foto:' || p.id || ':' || rubric)
  order by p.created_at desc
  limit greatest(max_photos, 0)
  on conflict (idempotency_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- Las funciones de la cola son solo para el worker (rol de servicio).
revoke all on function public.migue_claim_jobs(text, integer) from public, anon, authenticated;
revoke all on function public.migue_finish_job(uuid, boolean, text, boolean) from public, anon, authenticated;
revoke all on function public.migue_enqueue_backfill(integer) from public, anon, authenticated;
revoke all on function public.migue_enqueue_photo() from public, anon, authenticated;
grant execute on function public.migue_claim_jobs(text, integer) to service_role;
grant execute on function public.migue_finish_job(uuid, boolean, text, boolean) to service_role;
grant execute on function public.migue_enqueue_backfill(integer) to service_role;

-- Permisos (RLS). Lectura como el resto de la app (usuarios autenticados); los resultados los
-- escribe solo el worker; las revisiones, el personal municipal en su propio nombre.
alter table public.migue_rubrics enable row level security;
alter table public.migue_jobs enable row level security;
alter table public.photo_analyses enable row level security;
alter table public.photo_analysis_reviews enable row level security;
alter table public.migue_usage enable row level security;

drop policy if exists "Authenticated read rubrics" on public.migue_rubrics;
create policy "Authenticated read rubrics" on public.migue_rubrics for select to authenticated using (true);

drop policy if exists "Authenticated read migue jobs" on public.migue_jobs;
create policy "Authenticated read migue jobs" on public.migue_jobs for select to authenticated using (true);

drop policy if exists "Authenticated read photo analyses" on public.photo_analyses;
create policy "Authenticated read photo analyses" on public.photo_analyses for select to authenticated using (true);

drop policy if exists "Authenticated read analysis reviews" on public.photo_analysis_reviews;
create policy "Authenticated read analysis reviews" on public.photo_analysis_reviews for select to authenticated using (true);

drop policy if exists "Staff insert analysis reviews" on public.photo_analysis_reviews;
create policy "Staff insert analysis reviews" on public.photo_analysis_reviews for insert to authenticated
with check (reviewed_by = auth.uid() and public.current_user_role()::text in ('admin','supervisor','inspector'));

drop policy if exists "Managers read migue usage" on public.migue_usage;
create policy "Managers read migue usage" on public.migue_usage for select to authenticated
using (public.current_user_role()::text in ('admin','supervisor'));
