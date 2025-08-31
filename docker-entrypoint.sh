#!/bin/sh
set -euo pipefail

DB_HOST="${POSTGRES_HOST:-db}"
DB_USER="${POSTGRES_USER:-todo}"
DB_PASS="${POSTGRES_PASSWORD:-todo}"
DB_NAME="${POSTGRES_DB:-todo}"

echo "Aguardando Postgres em ${DB_HOST}:5432 ..."
until PGPASSWORD="$DB_PASS" pg_isready -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
  sleep 1
done
echo "Postgres OK."

# Aplica migrations do Prisma (arquivos SQL)
if [ -d "prisma/migrations" ]; then
  echo "Aplicando migrations do Prisma (SQL) ..."
  # lista ordenada e aplica uma a uma
  for f in $(ls -1 prisma/migrations/*/migration.sql 2>/dev/null | sort); do
    echo " - $f"
    PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 \
      -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
      -f "$f" >/dev/null
  done
else
  echo "Aviso: pasta prisma/migrations não encontrada."
fi

# Checagem rápida: billing_config deve existir
if ! PGPASSWORD="$DB_PASS" psql -tAc "SELECT to_regclass('public.billing_config')" \
        -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" | grep -q billing_config; then
  echo "Aviso: tabela billing_config não existe após migrations."
fi

# Sobe a app (o server.js ainda garante os defaults de billing_config)
exec node server.js
