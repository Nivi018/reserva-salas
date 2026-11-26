import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { createAccountStore } from './accounts.js'
import { createBookingStore } from './bookings.js'
import { createDatabase } from './db.js'
import { createPrivateApp, privateHost, privatePort } from './private-app.js'

const port = Number(process.env.APP_PORT ?? privatePort)
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('APP_PORT debe estar entre 1024 y 65535')
}
const { db, close } = createDatabase()
const app = createPrivateApp(
  createApp(createBookingStore(db)),
  createAccountStore(db),
  fileURLToPath(new URL('../../client/dist/', import.meta.url)),
  port,
)

const server = serve({ fetch: app.fetch, hostname: privateHost, port }, ({ port }) => {
  console.log(`Reserva Salas privada: http://${privateHost}:${port}`)
})

function shutdown() {
  server.close(() => void close())
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
