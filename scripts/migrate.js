const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

async function migrate() {
  const sql = postgres(process.env.DATABASE_URL);

  // Ensure migrations tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      tag VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  const drizzleDir = path.join(__dirname, "drizzle");
  if (!fs.existsSync(drizzleDir)) {
    console.log("  No migrations directory found, skipping.");
    await sql.end();
    return;
  }

  const files = fs.readdirSync(drizzleDir)
    .filter(f => /^\d+.*\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const tag = file.replace(".sql", "");

    // Check if already applied
    const [existing] = await sql`
      SELECT 1 FROM __drizzle_migrations WHERE tag = ${tag}
    `;
    if (existing) {
      console.log(`  Skipping ${file} (already applied)`);
      continue;
    }

    console.log(`  Applying ${file}...`);
    const content = fs.readFileSync(path.join(drizzleDir, file), "utf8");
    const statements = content
      .split("--> statement-breakpoint")
      .map(s => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      try {
        await sql.unsafe(stmt);
      } catch (e) {
        // Ignore "already exists" errors for idempotency
        if (e.message.includes("already exists") || e.message.includes("duplicate")) {
          continue;
        }
        console.error(`  Error in ${file}: ${e.message.slice(0, 200)}`);
      }
    }

    await sql`INSERT INTO __drizzle_migrations (tag) VALUES (${tag})`;
    console.log(`  Applied ${file}`);
  }

  await sql.end();
  console.log("  Migrations complete.");
}

migrate().catch(err => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
