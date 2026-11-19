#!/bin/bash
# Prueba la migración de Migue en un Postgres descartable (sin red, se borra al final).
# Uso (desde esta PC, en la raíz del repo):
#   ssh root@VPS "mkdir -p /tmp/migue" && scp supabase/migue_intelligence_v1*.sql supabase/tests/* root@VPS:/tmp/migue/
#   ssh root@VPS "chown -R applaza /tmp/migue && sudo -u applaza bash /tmp/migue/probar-migracion.sh; rm -rf /tmp/migue"
# Solo LEE la estructura de la base real (pg_dump --schema-only), nunca datos ni escrituras.
set -euo pipefail
export DOCKER_HOST=unix:///run/user/1003/docker.sock
export PATH=/srv/applaza/bin:$PATH
cd /tmp
NAME=migue-prueba
docker rm -f "$NAME" >/dev/null 2>&1 || true
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc a-zA-Z0-9)" supabase/postgres:17.6.1.136 >/dev/null
for i in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres -h localhost >/dev/null 2>&1; then break; fi
  sleep 2
done
sleep 5
echo "== Base descartable lista"

docker exec supabase-db pg_dump -U supabase_admin -d postgres --schema-only -n public --no-owner --no-privileges > /tmp/migue/estructura.sql
echo "== Estructura de producción: $(grep -c '^CREATE TABLE' /tmp/migue/estructura.sql) tablas"
docker exec -i "$NAME" psql -q -U supabase_admin -d postgres -v ON_ERROR_STOP=0 < /tmp/migue/estructura.sql 2>&1 | grep -i error | grep -v "already exists" | head -20 || true

docker cp /tmp/migue/. "$NAME":/tmp/migue/
docker exec "$NAME" psql -U supabase_admin -d postgres -f /tmp/migue/migue_intelligence_v1.test.sql 2>&1
