#!/bin/sh
set -e

echo "Waiting for database to be ready..."
until node -e "
  const pg = require('postgres');
  const sql = pg(process.env.DATABASE_URL);
  sql\`SELECT 1\`.then(() => { sql.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  echo "Database not ready, retrying in 2s..."
  sleep 2
done

echo "Applying database migrations..."
node /app/migrate.js

echo "Starting application..."
exec node server.js
