import { buffer } from 'node:stream/consumers'
import { z } from 'zod'
import { passwordSchema, recoverLocalAdmin } from './accounts.js'
import { createDatabase } from './db.js'

const inputSchema = z.object({ identifier: z.string().trim().min(1).max(254), password: passwordSchema })
const raw = await buffer(process.stdin)
try {
  const input = inputSchema.safeParse(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')))
  if (!input.success) throw new Error('Datos inválidos')
  const { db, close } = createDatabase()
  try {
    if (await recoverLocalAdmin(db, input.data.identifier, input.data.password)) {
      console.log('Contraseña de administración restablecida. Las sesiones anteriores quedaron cerradas.')
    } else {
      console.error('No se encontró una cuenta administradora con ese correo o usuario.')
      process.exitCode = 1
    }
  } finally {
    await close()
  }
} catch {
  console.error('No se pudo recuperar el acceso. Revisa los datos, PostgreSQL y las migraciones.')
  process.exitCode = 1
} finally {
  raw.fill(0)
}
