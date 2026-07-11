#!/bin/sh
# Railway start script.
#   - Normal boot: apply pending migrations, seed reference data (idempotent), start.
#   - Recovery boot (set RESET_DB=1 in Railway Variables): drop everything, re-apply
#     migrations from scratch, re-seed. Use this ONCE to recover from a failed/mismatched
#     migration, then remove RESET_DB so deploys never reset your data again.
set -e

if [ "$RESET_DB" = "1" ]; then
  echo ">>> RESET_DB=1 — resetting database (drops ALL data, re-applies migrations, re-seeds)"
  npx prisma migrate reset --force --skip-generate
else
  npx prisma migrate deploy
  npx prisma db seed || echo ">>> seed skipped"
fi

exec npm run start
