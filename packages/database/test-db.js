const postgres = require('postgres');

// Connection via DATABASE_URL env var (required).
// Usage: DATABASE_URL=postgresql://... node test-db.js
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('ERROR: DATABASE_URL environment variable is required.');
  console.error('Usage: DATABASE_URL=postgresql://... node test-db.js');
  process.exit(1);
}

async function test() {
  console.log('Connecting to database...');
  const sql = postgres(connectionString);
  try {
    const result = await sql`
      SELECT id, name
      FROM public.tenants
    `;
    console.log('Tenants:');
    console.log(result.map(row => `${row.id}: ${row.name}`).join('\n'));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await sql.end();
  }
}

test();
