import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.js'

export function createDatabase() {
  const { POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD } = process.env
  if (!POSTGRES_DB || !POSTGRES_USER || !POSTGRES_PASSWORD) {
    throw new Error('Configura POSTGRES_DB, POSTGRES_USER y POSTGRES_PASSWORD en .env')
  }

  const port = Number(process.env.POSTGRES_PORT ?? 55432)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('POSTGRES_PORT debe estar entre 1 y 65535')
  }

  const pool = new Pool({
    host: '127.0.0.1',
    port,
    database: POSTGRES_DB,
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
  })
  pool.on('error', () => console.error('Se perdió una conexión inactiva con PostgreSQL.'))

  return { db: drizzle(pool, { schema }), close: () => pool.end() }
}
