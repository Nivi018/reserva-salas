import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hc } from 'hono/client'
import { createApp, type AppType } from './app.js'
import type { BookingStore } from './bookings.js'

const slot = {
  roomId: 'olivo',
  startsAt: '2030-03-20T10:00:00.000Z',
  endsAt: '2030-03-20T11:00:00.000Z',
}
const room = { id: 'olivo', name: 'Sala Olivo', capacity: 4 }
const booking = { id: '7b393918-98b5-4c29-8ea2-634c65dfa37f', ...slot }
const interval = { startsAt: slot.startsAt, endsAt: slot.endsAt }

function client(overrides: Partial<BookingStore> = {}) {
  const store: BookingStore = {
    listRooms: async () => [room],
    availability: async () => [interval],
    reserve: async () => ({ status: 'confirmed', booking }),
    ...overrides,
  }
  const app = createApp(store, () => Date.parse('2030-03-20T09:00:00.000Z'))
  const fetchApp: typeof fetch = async (input, init) => app.request(new Request(input, init))
  return { api: hc<AppType>('http://localhost', { fetch: fetchApp }).api, app }
}

test('expone la salud, las salas y los intervalos sin datos de reserva', async () => {
  const { api } = client()
  assert.equal((await api.health.$get()).status, 200)
  assert.deepEqual(await (await api.rooms.$get()).json(), { rooms: [room] })
  const response = await api.availability.$get({ query: slot })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await response.json(), { busy: [interval] })
})

test('rechaza fechas, duraciones, rangos pasados y JSON malformado sin llamar al repositorio', async () => {
  let calls = 0
  const { api, app } = client({
    reserve: async () => { calls++; return { status: 'conflict' } },
    availability: async () => { calls++; return [] },
  })
  for (const json of [
    { ...slot, startsAt: '2030-02-30T10:00:00Z' },
    { ...slot, startsAt: '2030-03-20T10:00:00' },
    { ...slot, endsAt: '2030-03-20T10:15:00Z' },
    { ...slot, startsAt: '2030-03-20T08:30:00Z', endsAt: '2030-03-20T09:30:00Z' },
    { ...slot, startsAt: '2030-03-20T09:00:00Z' },
  ]) {
    const response = await api.bookings.$post({ json })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'invalid_input' })
  }
  const response = await app.request('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: 'invalid_input' })
  assert.equal((await api.availability.$get({ query: { ...slot, endsAt: slot.startsAt } })).status, 400)
  assert.equal((await api.availability.$get({ query: { ...slot, endsAt: '2030-03-23T10:00:00Z' } })).status, 400)
  assert.equal(calls, 0)
})

test('devuelve 201 con referencia, 409 ante conflicto y 404 para una sala inexistente', async () => {
  const confirmed = await client().api.bookings.$post({ json: slot })
  assert.equal(confirmed.status, 201)
  assert.deepEqual(await confirmed.json(), { booking })

  const conflict = client({ reserve: async () => ({ status: 'conflict' }) })
  assert.equal((await conflict.api.bookings.$post({ json: slot })).status, 409)

  const missing = client({
    reserve: async () => ({ status: 'room_not_found' }),
    availability: async () => null,
  })
  assert.equal((await missing.api.bookings.$post({ json: slot })).status, 404)
  assert.equal((await missing.api.availability.$get({ query: slot })).status, 404)
})

test('una caída de PostgreSQL no revela el error interno ni afecta la ruta de salud', async () => {
  const fail = async () => { throw new Error('detalle privado de la base') }
  const { api } = client({ listRooms: fail, availability: fail, reserve: fail })
  assert.equal((await api.health.$get()).status, 200)
  for (const response of [
    await api.rooms.$get(),
    await api.availability.$get({ query: slot }),
    await api.bookings.$post({ json: slot }),
  ]) {
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'service_unavailable' })
  }
})
