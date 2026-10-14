'use strict';
// Migrações aditivas idempotentes no mesmo banco PostgreSQL usado pela v2.
// Executar antes do servidor aceitar requisicoes v3.
const fs = require('node:fs');
const path = require('node:path');
const MIGRATIONS = [
  '001_operational_audit.sql',
  '002_academic_foundation.sql'
];
async function ensureV3Schema({pool, userStore}) {
  if (!pool || !userStore || typeof userStore.ready !== 'function') throw new Error('Dependencias de inicializacao da v3 ausentes.');
  await userStore.ready(); // garante etec_teachers preexistente, sem alteracao dos dados v2
  const client = await pool.connect();
  try {
    // Lock global de sessao protege contra a criacao concorrente de tabelas.
    await client.query('SELECT pg_advisory_lock(782413, 300)');
    try {
      for (const name of MIGRATIONS) {
        const sql = fs.readFileSync(path.join(__dirname, 'migrations', name), 'utf8');
        await client.query(sql);
      }
      const check = await client.query(`SELECT count(*)::int AS present
        FROM information_schema.tables WHERE table_schema=current_schema()
          AND table_name IN ('etec_v3_rooms','etec_v3_enrollments','etec_v3_activities',
                             'etec_v3_submission_versions','etec_v3_submission_files')`);
      if (check.rows[0]?.present !== 5) throw new Error('As tabelas academicas da v3 nao foram criadas integralmente.');
    } finally {
      await client.query('SELECT pg_advisory_unlock(782413, 300)');
    }
  } finally { client.release(); }
  return true;
}
module.exports = {ensureV3Schema, MIGRATIONS};
