import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { bootstrapAdmin, createAccountStore, recoverLocalAdmin } from './accounts.js'
import { createApp } from './app.js'
import { createBookingStore } from './bookings.js'
import { createDatabase } from './db.js'
import { createPrivateApp } from './private-app.js'

test('usuarios persistentes, roles, reservas privadas y revocación de sesión', async (t) => {
  assert.match(process.env.POSTGRES_DB ?? '', /_test$/)
  const { db, close } = createDatabase()
  t.after(close)
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) })
  const suffix = randomBytes(5).toString('hex')
  const password = randomBytes(24).toString('hex')
  const adminData = { username: `admin-${suffix}`, email: `admin-${suffix}@example.test`, password }
  const memberData = { username: `member-${suffix}`, email: `member-${suffix}@example.test`, password }
  const accounts = createAccountStore(db)
  if ((await accounts.list()).length === 0) {
    assert.equal(await bootstrapAdmin(db, adminData), true)
    assert.equal(await bootstrapAdmin(db, adminData), false)
    assert.ok(await accounts.authenticate(adminData.email.toUpperCase(), password))
  }
  assert.equal(await accounts.create(memberData), true)
  assert.equal(await accounts.create({ ...memberData, username: `other-${suffix}` }), false)
  assert.equal(await accounts.authenticate(memberData.username, 'invalid password'), null)
  const member = await accounts.authenticate(memberData.email.toUpperCase(), password)
  assert.ok(member)
  const other = { ...memberData, username: `other-${suffix}`, email: `other-${suffix}@example.test` }
  assert.equal(await accounts.create(other), true)
  const now = Date.parse('2050-01-01T00:00:00Z') + (Number.parseInt(suffix.slice(0, 5), 16) % 10000) * 86_400_000
  const app = createPrivateApp(createApp(createBookingStore(db), () => now), accounts, '.')
  const origin = 'http://127.0.0.1:5174'
  const request = (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set('host', '127.0.0.1:5174')
    headers.set('origin', origin)
    return app.request(origin + path, { ...init, headers })
  }
  async function login(username: string, key: string) {
    const result = await request('/login', { method: 'POST', body: new URLSearchParams({ username, password: key }) })
    assert.equal(result.status, 303)
    const cookie = result.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)
    return cookie
  }
  const cookie = await login(memberData.username, password)
  const otherCookie = await login(other.email, password)
  const body = {
    roomId: 'olivo',
    startsAt: new Date(now + 10 * 3_600_000).toISOString(),
    endsAt: new Date(now + 11 * 3_600_000).toISOString(),
    notes: 'Nota privada',
  }
  const booked = await request('/api/bookings', {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  assert.equal(booked.status, 201)
  const { booking } = await booked.json() as { booking: { id: string } }
  const otherBookings = await request('/api/bookings', { headers: { cookie: otherCookie } })
  assert.equal(otherBookings.status, 200)
  assert.equal((await otherBookings.json() as { entries: unknown[] }).entries.length, 0)
  assert.equal((await request(`/api/bookings/${booking.id}/cancel`, {
    method: 'POST', headers: { cookie: otherCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1 }),
  })).status, 404)
  assert.equal((await request('/api/manage/audit', { headers: { cookie } })).status, 403)
  const updated = randomBytes(24).toString('hex')
  assert.equal(await accounts.changePassword(member, password, updated), true)
  assert.equal((await request('/api/profile', { headers: { cookie } })).status, 401)
  const updatedCookie = await login(memberData.email, updated)
  assert.equal(await accounts.setActive(member.id, false), true)
  assert.equal((await request('/api/profile', { headers: { cookie: updatedCookie } })).status, 401)
  const admin = (await accounts.list()).find(({ role }) => role === 'admin')
  assert.ok(admin)
  // Reuse the existing administrator only in the explicitly isolated test database.
  const adminPassword = randomBytes(24).toString('hex')
  assert.equal(await recoverLocalAdmin(db, admin.email.toUpperCase(), adminPassword), true)
  assert.equal(await recoverLocalAdmin(db, member.email, adminPassword), false)
  const adminCookie = await login(admin.username, adminPassword)
  const reset = (session: string, id: string, next: string, confirm = next) => request('/cuenta/restablecer', {
    method: 'POST', headers: { cookie: session }, body: new URLSearchParams({ id, password: next, confirm }),
  })
  const target = await accounts.authenticate(other.username, password)
  assert.ok(target)
  const next = randomBytes(24).toString('hex')
  assert.equal((await reset(otherCookie, target.id, next)).status, 403)
  assert.equal((await reset(adminCookie, target.id, next, 'different valid password')).status, 400)
  assert.equal((await reset(adminCookie, admin.id, next)).status, 404)
  assert.equal((await reset(adminCookie, target.id, next)).status, 303)
  assert.equal((await request('/api/profile', { headers: { cookie: otherCookie } })).status, 401)
  assert.equal(await accounts.authenticate(other.username, password), null)
  await login(other.email, next)
  const recovered = randomBytes(24).toString('hex')
  assert.equal(await recoverLocalAdmin(db, admin.username, recovered), true)
  assert.equal((await request('/api/profile', { headers: { cookie: adminCookie } })).status, 401)
  assert.equal(await accounts.authenticate(admin.email, adminPassword), null)
  const recoveredCookie = await login(admin.email, recovered)
  const activity = await request('/api/manage/audit', { headers: { cookie: recoveredCookie } })
  assert.equal(activity.status, 200)
  const activityBody = await activity.text()
  assert.match(activityBody, /password_reset/)
  assert.doesNotMatch(activityBody, /password_hash/)
  assert.ok(!activityBody.includes(recovered) && !activityBody.includes(next))
})
