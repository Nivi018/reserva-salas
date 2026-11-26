import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDatabase } from './db.js'

const { db, close } = createDatabase()
try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) })
  console.log('Migraciones aplicadas.')
} finally {
  await close()
}
