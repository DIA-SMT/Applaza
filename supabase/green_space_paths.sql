-- Trazado de platabandas: lista de 2 o 3 puntos (inicio, medio opcional, fin).
-- Las politicas existentes de green_spaces cubren esta columna.
-- Ejecutar en el SQL Editor de Supabase.

alter table public.green_spaces
add column if not exists path jsonb;

comment on column public.green_spaces.path is
'Puntos del tramo para espacios lineales (platabandas): [{"latitude":..,"longitude":..}, ...]. Null para espacios puntuales.';
