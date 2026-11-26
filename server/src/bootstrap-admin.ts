import { buffer } from 'node:stream/consumers'
import { accountSchema, bootstrapAdmin } from './accounts.js'
import { createDatabase } from './db.js'

const raw = await buffer(process.stdin)
try {
  const input = accountSchema.safeParse(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')))
  if (!input.success) {
    console.error('Datos inválidos: correo válido, usuario de 3 a 32 caracteres y contraseña de 12 a 256.')
    process.exitCode = 1
  } else {
    const { db, close } = createDatabase()
    try {
      if (await bootstrapAdmin(db, input.data)) console.log('Administrador creado. Ya puedes iniciar sesión.')
      else {
        console.error('Ya existen usuarios. Usa el panel de administración.')
        process.exitCode = 1
      }
    } finally { await close() }
  }
} catch {
  console.error('No se pudo crear el administrador. Comprueba que PostgreSQL y las migraciones estén listos.')
  process.exitCode = 1
} finally {
  raw.fill(0)
}
