import { randomBytes } from 'node:crypto'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import type { AppType, AuthContext } from './app.js'
import { accountSchema, passwordSchema, type AccountStore } from './accounts.js'
import { accountPage, loginPage, loginStyle } from './login-page.js'

export const privateHost = '127.0.0.1'
export const privatePort = 5174
const cookieName = 'reserva_salas_session'
const cookieOptions = { httpOnly: true, sameSite: 'Strict', path: '/' } as const
const sessionSeconds = 8 * 60 * 60

export function createPrivateApp(api: AppType, accounts: AccountStore, files: string, port = privatePort) {
  const host = `${privateHost}:${port}`
  const sessions = new Map<string, { expiry: number; id: string; version: number }>()
  let attempts = 0
  let retryAfter = 0

  async function validSession(token: string | undefined) {
    if (!token) return null
    const session = sessions.get(token)
    if (!session) return null
    if (session.expiry > Date.now()) {
      const account = await accounts.get(session.id)
      if (account?.active && account.sessionVersion === session.version) return account
    }
    sessions.delete(token)
    return null
  }

  const formLimit = bodyLimit({ maxSize: 8192 })
  return new Hono<AuthContext>()
    .onError((_error, c) => c.text('Servicio no disponible. Comprueba PostgreSQL e inténtalo de nuevo.', 503))
    .use('*', async (c, next) => {
      c.header('Cache-Control', 'no-store')
      c.header('X-Content-Type-Options', 'nosniff')
      c.header('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
      if (c.req.header('host') !== host) return c.text('Dirección no permitida.', 403)
      if (!['GET', 'HEAD'].includes(c.req.method)) {
        if (c.req.header('origin') !== `http://${host}`) return c.text('Origen no permitido.', 403)
      }
      const path = c.req.path
      if (['/login', '/login.css', '/logout'].includes(path)) return next()
      const account = await validSession(getCookie(c, cookieName))
      if (account) {
        c.set('account', account)
        return next()
      }
      if (['/', '/cuenta'].includes(path) && ['GET', 'HEAD'].includes(c.req.method)) return c.redirect('/login', 303)
      return c.json({ error: 'login_required' }, 401)
    })
    .get('/login', async (c) => await validSession(getCookie(c, cookieName))
      ? c.redirect('/', 303) : c.html(loginPage()))
    .get('/login.css', (c) => c.body(loginStyle, 200, { 'Content-Type': 'text/css; charset=utf-8' }))
    .post('/login', formLimit, async (c) => {
      const now = Date.now()
      if (now >= retryAfter) {
        attempts = 0
        retryAfter = now + 60_000
      }
      if (attempts >= 12) {
        c.header('Retry-After', String(Math.ceil((retryAfter - now) / 1000)))
        return c.html(loginPage('limit'), 429)
      }
      attempts++
      const body = await c.req.parseBody({ all: true })
      const candidate = typeof body.password === 'string' ? body.password : ''
      const identifier = typeof body.username === 'string' ? body.username : ''
      const account = identifier.length <= 254 && candidate.length <= 256
        ? await accounts.authenticate(identifier, candidate) : null
      if (!account) return c.html(loginPage('credentials'), 401)
      attempts = Math.max(0, attempts - 1)
      for (const [token, session] of sessions) {
        if (session.expiry <= now) sessions.delete(token)
      }
      const oldest = sessions.keys().next().value
      if (sessions.size >= 128 && oldest) sessions.delete(oldest)
      const previous = getCookie(c, cookieName)
      if (previous) sessions.delete(previous)
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, { expiry: now + sessionSeconds * 1000, id: account.id, version: account.sessionVersion })
      setCookie(c, cookieName, token, { ...cookieOptions, maxAge: sessionSeconds })
      return c.redirect('/', 303)
    })
    .post('/logout', (c) => {
      const token = getCookie(c, cookieName)
      if (token) sessions.delete(token)
      deleteCookie(c, cookieName, cookieOptions)
      return c.redirect('/login', 303)
    })
    .get('/api/profile', (c) => {
      const account = c.get('account')
      if (!account) return c.json({ error: 'login_required' }, 401)
      return c.json({ username: account.username, role: account.role })
    })
    .get('/cuenta', async (c) => {
      const account = c.get('account')
      if (!account) return c.redirect('/login', 303)
      const notice = c.req.query('ok')
      return c.html(accountPage(account, account.role === 'admin' ? await accounts.list() : [], {
        notice: notice === 'created' ? 'Cuenta creada.' : notice === 'status' ? 'Estado actualizado.'
          : notice === 'reset' ? 'Contraseña restablecida. Se cerraron las sesiones de esa cuenta.' : undefined,
      }))
    })
    .post('/cuenta/restablecer', formLimit, async (c) => {
      const account = c.get('account')
      if (account?.role !== 'admin') return c.text('No tienes permiso.', 403)
      const form = z.object({ id: z.uuid(), password: passwordSchema, confirm: passwordSchema })
        .safeParse(await c.req.parseBody({ all: true }))
      if (!form.success || form.data.password !== form.data.confirm) {
        return c.html(accountPage(account, await accounts.list(), {
          error: 'Usa de 12 a 256 caracteres y repite la misma contraseña.',
        }), 400)
      }
      if (!await accounts.resetMemberPassword(account, form.data.id, form.data.password)) {
        return c.html(accountPage(account, await accounts.list(), {
          error: 'Solo se puede restablecer una cuenta de miembro desde este panel.',
        }), 404)
      }
      return c.redirect('/cuenta?ok=reset', 303)
    })
    .post('/cuenta/usuarios', formLimit, async (c) => {
      const account = c.get('account')
      if (account?.role !== 'admin') return c.text('No tienes permiso.', 403)
      const result = accountSchema.safeParse(await c.req.parseBody({ all: true }))
      if (!result.success || !await accounts.create(result.data)) {
        const error = result.success
          ? 'El correo o nombre de usuario ya existe.'
          : 'Revisa el correo, el usuario y la contraseña (mínimo 12 caracteres).'
        return c.html(accountPage(account, await accounts.list(), { error }), result.success ? 409 : 400)
      }
      return c.redirect('/cuenta?ok=created', 303)
    })
    .post('/cuenta/estado', formLimit, async (c) => {
      if (c.get('account')?.role !== 'admin') return c.text('No tienes permiso.', 403)
      const form = z.object({ id: z.uuid(), active: z.enum(['yes', 'no']) }).safeParse(await c.req.parseBody({ all: true }))
      if (!form.success) return c.text('Datos incorrectos.', 400)
      if (!await accounts.setActive(form.data.id, form.data.active === 'yes')) return c.text('Cuenta no disponible.', 404)
      return c.redirect('/cuenta?ok=status', 303)
    })
    .post('/cuenta/clave', formLimit, async (c) => {
      const account = c.get('account')
      if (!account) return c.text('Inicia sesión.', 401)
      const form = z.object({ current: z.string().min(1).max(256), password: passwordSchema, confirm: passwordSchema })
        .safeParse(await c.req.parseBody({ all: true }))
      const error = !form.success || form.data.password !== form.data.confirm
        ? 'La contraseña nueva debe tener al menos 12 caracteres y coincidir.'
        : !await accounts.changePassword(account, form.data.current, form.data.password) ? 'No se pudo cambiar la contraseña. Revisa la contraseña actual.' : null
      if (error) return c.html(accountPage(account, account.role === 'admin' ? await accounts.list() : [], { error }), 400)
      deleteCookie(c, cookieName, cookieOptions)
      return c.redirect('/login', 303)
    })
    .route('/', api)
    .get('/', serveStatic({ root: files }))
    .get('/assets/*', serveStatic({ root: files }))
}
