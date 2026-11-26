import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { inArray } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { hc } from 'hono/client'
import { createApp, type AppType } from './app.js'
import { createBookingStore } from './bookings.js'
import { createDatabase } from './db.js'
import { bookings, rooms } from './schema.js'

test('PostgreSQL arbitra solicitudes HTTP concurrentes y solo rechaza el solapamiento en la misma sala', async (t) => {
  assert.match(process.env.POSTGRES_DB ?? '', /_test$/, 'Usa una base de pruebas cuyo nombre termine en _test')
  const { db, close } = createDatabase()
  t.after(close)
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))
  await migrate(db, { migrationsFolder })
  await migrate(db, { migrationsFolder })

  const salt = randomUUID().slice(0, 13)
  const roomId = `test-${salt}-a`
  const otherRoomId = `test-${salt}-b`
  const fixtureIds = [roomId, otherRoomId]
  await db.insert(rooms).values(fixtureIds.map((id) => ({ id, name: id, capacity: 2 })))
  try {
    const epoch = Date.parse('2030-03-20T00:00:00Z')
    const app = createApp(createBookingStore(db), () => epoch)
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    try {
      await once(server, 'listening')
      const address = server.address()
      assert.ok(address && typeof address === 'object')
      const { api } = hc<AppType>(`http://127.0.0.1:${address.port}`)
      const iso = (hour: number) => new Date(epoch + hour * 3_600_000).toISOString()
      const window = (start: number, end: number) => ({ roomId, startsAt: iso(start), endsAt: iso(end) })
      const day = window(8, 20)
      const listed = await api.rooms.$get()
      assert.equal(listed.status, 200)
      assert.ok((await listed.json()).rooms.some(({ id }) => id === 'olivo'))

      const initiallyFree = await api.availability.$get({ query: day })
      assert.equal(initiallyFree.status, 200)
      assert.deepEqual(await initiallyFree.json(), { busy: [] })

      const candidates = [window(10, 11), window(10.5, 11.5)]
      const results = await Promise.all(candidates.map((json) => api.bookings.$post({ json })))
      assert.deepEqual(results.map(({ status }) => status).sort(), [201, 409])
      const winner = results.find((response) => response.status === 201)
      assert.ok(winner && winner.status === 201)
      const { booking } = await winner.json()
      const loser = results.find((response) => response.status === 409)
      assert.ok(loser)
      assert.deepEqual(await loser.json(), { error: 'slot_conflict' })

      const stored = await db.select().from(bookings).where(inArray(bookings.roomId, fixtureIds))
      assert.deepEqual(stored.map(({ id }) => id), [booking.id])
      const afterRace = await api.availability.$get({ query: day })
      assert.deepEqual(await afterRace.json(), { busy: [{ startsAt: booking.startsAt, endsAt: booking.endsAt }] })

      const anotherRoom = await api.bookings.$post({ json: { ...window(10, 11), roomId: otherRoomId } })
      assert.equal(anotherRoom.status, 201)
      const adjacentQuery = {
        roomId,
        startsAt: booking.endsAt,
        endsAt: new Date(Date.parse(booking.endsAt) + 30 * 60_000).toISOString(),
      }
      assert.deepEqual(await (await api.availability.$get({ query: adjacentQuery })).json(), { busy: [] })
      assert.equal((await api.bookings.$post({ json: adjacentQuery })).status, 201)
      assert.equal((await api.bookings.$post({ json: { ...window(13, 14), roomId: `${roomId}-missing` } })).status, 404)

      const makeRoom = { name: 'Sala de prueba', capacity: 6, active: true, openMinute: 480, closeMinute: 1140, timeZone: 'America/Mexico_City' }
      const createdRoom = await api.manage.rooms.$post({ json: makeRoom })
      assert.equal(createdRoom.status, 201)
      assert.ok(createdRoom.status === 201)
      const { room: managed } = await createdRoom.json()
      fixtureIds.push(managed.id)
      const managedWindow = (start: number, end: number) => ({ ...window(start, end), roomId: managed.id })
      assert.equal((await api.bookings.$post({ json: managedWindow(12, 13) })).status, 409)

      const first = await api.bookings.$post({ json: { ...managedWindow(15, 16), bookedFor: 'Ana', notes: 'Reunión' } })
      assert.equal(first.status, 201)
      assert.ok(first.status === 201)
      const { booking: entry } = await first.json()
      const blockResponse = await api.blocks.$post({ json: { ...managedWindow(17, 20), notes: 'Mantenimiento' } })
      assert.equal(blockResponse.status, 201)
      assert.ok(blockResponse.status === 201)
      const { booking: block } = await blockResponse.json()
      assert.equal((await api.blocks.$post({ json: { ...managedWindow(14.5, 15.5), notes: 'Solapado' } })).status, 409)
      assert.equal((await api.bookings.$post({ json: managedWindow(18, 19) })).status, 409)
      const version = 1
      const move = api.bookings[':id'].$patch
      const param = { id: entry.id }
      const rejected = await move({ param, json: { ...managedWindow(18, 19), version, bookedFor: 'Ana', notes: 'No se guarda' } })
      assert.equal(rejected.status, 409)
      const [original] = await db.select().from(bookings).where(inArray(bookings.id, [entry.id]))
      assert.equal(original?.startsAt.toISOString(), entry.startsAt)
      assert.equal(original?.notes, 'Reunión')
      const moved = await move({ param, json: { ...managedWindow(16, 17), version, bookedFor: 'Ana', notes: 'Actualizada' } })
      assert.equal(moved.status, 200)
      assert.equal((await move({ param, json: { ...managedWindow(14, 15), version } })).status, 409)

      const editedRoom = await api.manage.rooms[':id'].$patch({
        param: { id: managed.id }, json: { ...makeRoom, version: managed.version, active: false },
      })
      assert.equal(editedRoom.status, 200)
      assert.equal((await api.bookings.$post({ json: managedWindow(15, 16) })).status, 409)
      assert.equal((await api.availability.$get({ query: managedWindow(14, 21) })).status, 404)
      assert.equal((await api.bookings[':id'].cancel.$post({ param, json: { version: 2 } })).status, 200)
      assert.equal((await api.bookings[':id'].cancel.$post({ param: { id: block.id }, json: { version: 1 } })).status, 200)
      const history = await api.bookings.$get({ query: { view: 'history', kind: 'booking' } })
      assert.equal(history.status, 200)
      assert.ok(history.status === 200)
      assert.ok((await history.json()).entries.some((item) => item.id === entry.id && item.cancelledAt && item.notes === 'Actualizada'))
      const activity = await api.manage.audit.$get({ query: {} })
      assert.ok(activity.status === 200)
      const changes = (await activity.json()).changes.filter((change) => change.entityId === entry.id)
      assert.deepEqual(changes.map(({ action }) => action), ['cancel', 'update', 'insert'])
      const reactivated = await api.manage.rooms[':id'].$patch({
        param: { id: managed.id }, json: { ...makeRoom, version: managed.version + 1 },
      })
      assert.equal(reactivated.status, 200)
      assert.deepEqual(await (await api.availability.$get({ query: managedWindow(14, 21) })).json(), { busy: [] })
      assert.equal((await api.bookings.$post({ json: managedWindow(18, 19) })).status, 201)
      const simultaneous = await Promise.all([
        api.bookings.$post({ json: managedWindow(20, 21) }),
        api.blocks.$post({ json: { ...managedWindow(20, 21), notes: 'Prueba simultánea' } }),
      ])
      assert.deepEqual(simultaneous.map(({ status }) => status).sort(), [201, 409])
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  } finally {
    await db.delete(bookings).where(inArray(bookings.roomId, fixtureIds))
    await db.delete(rooms).where(inArray(rooms.id, fixtureIds))
  }
})
