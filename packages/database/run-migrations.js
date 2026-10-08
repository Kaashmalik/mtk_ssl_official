const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

// Database connection string — MUST be provided via DATABASE_URL env var.
// Falls back to local Supabase dev instance for convenience only.
const connectionString = process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:54322/postgres';

const migrationsDir = path.join(__dirname, '../../supabase/migrations');
const filesToRun = [
  '018_create_impersonation_sessions.sql',
  '019_add_dkim_private_key.sql',
  '020_restore_missing_tables.sql',
];

async function run() {
  console.log('Connecting to Supabase to run migrations...');
  console.log('  Host:', connectionString.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
  const sql = postgres(connectionString);

  try {
    // Insert system default tenant to prevent FK violations in fantasy cricket migrations
    console.log('Ensuring system default tenant exists...');
    await sql`
      INSERT INTO public.tenants (id, name, slug, owner_id)
      VALUES ('00000000-0000-0000-0000-000000000000', 'System Default Tenant', 'system-default', '00000000-0000-0000-0000-000000000000')
      ON CONFLICT (id) DO NOTHING
    `;
    console.log('System default tenant ensured.');

    for (const file of filesToRun) {
      const filePath = path.join(migrationsDir, file);
      if (fs.existsSync(filePath)) {
        console.log(`Running migration: ${file}...`);
        const content = fs.readFileSync(filePath, 'utf8');
        // Use sql.unsafe to execute multiple statements in one query
        await sql.unsafe(content);
        console.log(`Successfully applied ${file}`);
      } else {
        console.warn(`Warning: File ${file} not found, skipping.`);
      }
    }
    console.log('🎉 All migrations applied successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await sql.end();
  }
}

run();
