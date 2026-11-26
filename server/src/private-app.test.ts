import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from './app.js'
import { createPrivateApp, privateHost, privatePort } from './private-app.js'
import type { Account, AccountStore } from './accounts.js'

const origin = `http://${privateHost}:${privatePort}`
const password = 'contraseña-de-prueba-no-real'
const admin: Account = { id: 'bcdffef3-2855-4dea-bea9-e60d16d54cfb', username: 'admin', email: 'admin@example.test', role: 'admin', active: true, sessionVersion: 1 }
const member: Account = { id: 'bcdffef3-2855-4dea-bea9-e60d16d54cfc', username: 'member', email: 'member@example.test', role: 'member', active: true, sessionVersion: 1 }

function createTestApp(overrides: Partial<AccountStore> = {}) {
  const api = createApp({
    listRooms: async () => [],
    availability: async () => [],
    reserve: async () => ({ status: 'conflict' }),
  })
  const accounts: AccountStore = {
    get: async (id) => [admin, member].find((account) => account.id === id) ?? null,
    authenticate: async (identifier, key) => key === password ? [admin, member].find((account) => [account.email, account.username].includes(identifier)) ?? null : null,
    list: async () => [admin, member],
    create: async () => true,
    setActive: async () => true,
    changePassword: async () => true,
    resetMemberPassword: async () => true,
    ...overrides,
  }
  const app = createPrivateApp(api, accounts, '.')
  return (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    headers.set('host', new URL(origin).host)
    return app.request(origin + path, { ...init, headers })
  }
}

test('el formulario inicia sesión y cerrar sesión invalida también la cookie anterior', async () => {
  const request = createTestApp()
  const guest = await request('/')
  assert.equal(guest.status, 303)
  assert.equal(guest.headers.get('location'), '/login')
  const form = await request('/login')
  assert.equal(form.status, 200)
  assert.match(await form.text(), /Iniciar sesión/)
  assert.equal((await request('/api/rooms')).status, 401)
  assert.equal((await request('/assets/test.js')).status, 401)
  const attempt = (candidate: string, from = origin) => request('/login', {
    method: 'POST',
    headers: { origin: from },
    body: new URLSearchParams({ username: 'admin', password: candidate }),
  })
  assert.equal((await attempt(password, 'http://example.invalid')).status, 403)
  const wrong = await attempt('contraseña incorrecta')
  assert.equal(wrong.status, 401)
  assert.equal(wrong.headers.get('set-cookie'), null)
  const loggedIn = await attempt(password)
  assert.equal(loggedIn.status, 303)
  assert.equal(loggedIn.headers.get('location'), '/')
  const setCookie = loggedIn.headers.get('set-cookie')
  assert.ok(setCookie)
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /SameSite=Strict/)
  const cookie = setCookie.split(';')[0]!
  assert.equal((await request('/api/rooms', { headers: { cookie } })).status, 200)
  assert.equal((await request('/logout', { method: 'POST', headers: { cookie } })).status, 403)
  const logout = await request('/logout', { method: 'POST', headers: { cookie, origin } })
  assert.equal(logout.status, 303)
  assert.equal(logout.headers.get('location'), '/login')
  assert.equal((await request('/api/rooms', { headers: { cookie } })).status, 401)
})

test('se puede entrar por correo; las cuentas demo no funcionan y un miembro no administra usuarios', async () => {
  const request = createTestApp()
  const attempt = (username: string, candidate: string) => request('/login', {
    method: 'POST',
    headers: { origin },
    body: new URLSearchParams({ username, password: candidate }),
  })
  assert.equal((await attempt('demo', password)).status, 401)
  const response = await attempt(member.email, password)
  assert.equal(response.status, 303)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  assert.equal((await request('/api/rooms', { headers: { cookie } })).status, 200)
  assert.equal((await request('/api/manage/audit', { headers: { cookie } })).status, 403)
  assert.equal((await request('/cuenta/usuarios', { method: 'POST', headers: { cookie, origin } })).status, 403)
  const profile = await request('/api/profile', { headers: { cookie } })
  assert.deepEqual(await profile.json(), { username: member.username, role: 'member' })
})
