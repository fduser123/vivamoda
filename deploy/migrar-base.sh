#!/usr/bin/env bash
# ============================================================
# Exporta la base local y la importa en Supabase (o cualquier PostgreSQL remoto).
#
#   ./migrar-base.sh "postgresql://postgres:PASS@db.xxx.supabase.co:5432/postgres"
#
# Antes de ejecutarlo, en Supabase → SQL Editor:
#   CREATE EXTENSION IF NOT EXISTS vector;
# ============================================================
set -euo pipefail

DESTINO="${1:?Uso: ./migrar-base.sh \"postgresql://usuario:clave@host:5432/base\"}"
CONTENEDOR="${CONTENEDOR:-vivamoda-postgres}"
VOLCADO="${VOLCADO:-/tmp/vivamoda-migracion.sql}"

echo "→ 1/4  Comprobando el contenedor local"
docker exec "$CONTENEDOR" pg_isready -U vivamoda >/dev/null || {
  echo "  ERROR: el contenedor $CONTENEDOR no responde. Arráncalo con:"
  echo "         docker start $CONTENEDOR"; exit 1; }

echo "→ 2/4  Volcando la base (123 MB, tarda un poco)"
docker exec "$CONTENEDOR" pg_dump -U vivamoda -d vivamoda --no-owner --no-acl > "$VOLCADO"
echo "  volcado: $VOLCADO ($(du -h "$VOLCADO" | cut -f1))"

echo "→ 3/4  Habilitando pgvector en el destino"
psql "$DESTINO" -q -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "→ 4/4  Importando (puede tardar varios minutos)"
psql "$DESTINO" -q -f "$VOLCADO"

echo
echo "✓ Migración completada. Verifica con:"
echo "  psql \"\$DESTINO\" -c \"SELECT COUNT(*) FROM products;\""
echo "  psql \"\$DESTINO\" -c \"SELECT COUNT(*) FROM product_embeddings;\""
