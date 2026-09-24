import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as appConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new pg.Pool({
  connectionString: appConfig.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[db] error inesperado en el pool', err.message);
});

/** Aplica el esquema (CREATE TABLE IF NOT EXISTS ...) */
export async function ensureSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

/** Retorna true cuando la base está lista (con reintentos para esperar a docker compose up) */
export async function waitForDb({ attempts = 12, delayMs = 1500 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`[db] esperando base de datos… (intento ${i}/${attempts})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** Convierte una fila de numeric → number (pg devuelve strings) */
export function money(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Ayudante: ejecuta consulta y normaliza filas (money/counts) */
export async function query(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
