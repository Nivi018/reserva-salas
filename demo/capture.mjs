import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { URL, URLSearchParams, fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import console from 'node:console'
import { performance } from 'node:perf_hooks'
import { serve } from '@hono/node-server'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { bootstrapAdmin, createAccountStore } from '../server/dist/accounts.js'
import { createApp } from '../server/dist/app.js'
import { createBookingStore } from '../server/dist/bookings.js'
import { createDatabase } from '../server/dist/db.js'
import { createPrivateApp } from '../server/dist/private-app.js'

assert.match(process.env.POSTGRES_DB ?? '', /_test$/, 'Usa únicamente una base desechable de prueba.')
const { chromium } = createRequire(join(process.env.DEMO_TOOLS, 'package.json'))('playwright-core')
const root = fileURLToPath(new URL('./', import.meta.url))
const assets = join(root, 'hyperframes', 'assets')
const narration = JSON.parse(await readFile(join(root, 'guion.json'), 'utf8'))
await mkdir(assets, { recursive: true })

const { db, close } = createDatabase()
const accounts = createAccountStore(db)
const store = createBookingStore(db)
const password = randomBytes(24).toString('hex')
const credentials = { username: 'admin-demo', email: 'admin@ejemplo.test', password }
const member = { username: 'miembro-demo', email: 'miembro@ejemplo.test', password: randomBytes(24).toString('hex') }
const day = '2031-04-15'
const windowFor = (startsAt, endsAt) => ({
  roomId: 'olivo', startsAt: `${day}T${startsAt}:00Z`, endsAt: `${day}T${endsAt}:00Z`,
})
const pause = (page, ms = 650) => page.waitForTimeout(ms)
const meta = []
let browser, server, app, origin, adminCookie, memberCookie

async function session(account) {
  const response = await fetch(`${origin}/login`, {
    method: 'POST', headers: { origin }, body: new URLSearchParams({ username: account.username, password: account.password }), redirect: 'manual',
  })
  assert.equal(response.status, 303)
  return response.headers.get('set-cookie').split(';')[0]
}
const cookieSpec = (cookie) => ({ name: cookie.split('=')[0], value: cookie.split('=')[1], url: origin, httpOnly: true, sameSite: 'Strict' })

async function aim(page, locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y, { steps: 14 })
  await page.evaluate(({ x, y }) => {
    const dot = document.getElementById('demo-pointer')
    if (dot) Object.assign(dot.style, { left: `${x}px`, top: `${y}px`, display: 'block' })
  }, { x, y })
  await pause(page, 220)
}
function button(page, name) { return page.getByRole('button', { name, exact: true }) }
async function click(page, locator) {
  const target = typeof locator === 'string' ? button(page, locator) : locator
  await aim(page, target)
  await target.click()
  await pause(page)
}
async function fill(page, selector, value) {
  const target = page.locator(selector)
  await aim(page, target)
  await target.fill(value)
  await pause(page, 420)
}
async function select(page, selector, value) {
  const target = page.locator(selector)
  await aim(page, target)
  await target.selectOption(value)
  await pause(page, 500)
}
async function calendar(page) {
  await page.locator('#room').selectOption('olivo')
  await page.locator('#date').fill(day)
  await button(page, '08:00 Libre').waitFor()
}
function stamp(scene, name) {
  scene.stills.push({ name, seconds: (performance.now() - scene.started) / 1000 })
}

async function segment(index, run, cookie = adminCookie) {
  const name = String(index).padStart(2, '0')
  const wav = join(assets, `voz-${name}.wav`)
  const voiceLength = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', wav], { encoding: 'utf8' }).trim())
  const started = performance.now()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }, timezoneId: 'UTC', locale: 'es-MX',
    recordVideo: { dir: assets, size: { width: 1280, height: 900 } },
  })
  const scene = { ...narration[index - 1], name, started, stills: [] }
  let video
  try {
    if (cookie) await context.addCookies([cookieSpec(cookie)])
    await context.addInitScript(() => {
      addEventListener('DOMContentLoaded', () => {
        const dot = document.createElement('div')
        dot.id = 'demo-pointer'
        Object.assign(dot.style, {
          display: 'none', pointerEvents: 'none', position: 'fixed', zIndex: '2147483647',
          width: '19px', height: '19px', borderRadius: '50%', border: '2px solid #102943',
          background: '#89ddff80', boxShadow: '0 0 0 2px #ffffffd9', transform: 'translate(-50%, -50%)',
          transition: 'left .20s ease, top .20s ease',
        })
        document.body.append(dot)
      })
    })
    const page = await context.newPage()
    scene.started = performance.now()
    video = page.video()
    await page.goto(origin)
    await pause(page, 780)
    await run(page, scene)
    await pause(page, Math.max(1400, (voiceLength + 1.4) * 1000 - (performance.now() - scene.started)))
  } finally { await context.close() }
  const raw = join(assets, `pantalla-${name}.webm`)
  await rename(await video.path(), raw)
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', raw], { encoding: 'utf8' }).trim())
  const file = `pantalla-${name}.mp4`
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', join(assets, file)])
  const rest = { title: scene.title, caption: scene.caption, name: scene.name, stills: scene.stills }
  meta.push({ ...rest, file, duration: Math.floor(duration * 25) / 25, voiceLength })
  await writeFile(join(root, 'hyperframes', 'escenas.json'), JSON.stringify(meta, null, 2))
  console.log(`Grabada escena ${index}: ${scene.title}`)
}

try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../server/drizzle/', import.meta.url)) })
  assert.equal(await bootstrapAdmin(db, credentials), true, 'La base demo debe estar vacía.')
  assert.equal(await accounts.create(member), true)
  for (const [from, to, bookedFor] of [['09:00', '10:00', 'Equipo creativo'], ['12:00', '13:00', 'Revisión mensual']]) {
    const item = windowFor(from, to)
    await store.reserve({ ...item, startsAt: new Date(item.startsAt), endsAt: new Date(item.endsAt), bookedFor })
  }
  server = serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => app.fetch(request) })
  await once(server, 'listening')
  const { port } = server.address()
  origin = `http://127.0.0.1:${port}`
  app = createPrivateApp(createApp(store, () => Date.parse(`${day}T07:00:00Z`)), accounts,
    fileURLToPath(new URL('../client/dist/', import.meta.url)), port)
  adminCookie = await session(credentials)
  memberCookie = await session(member)
  browser = await chromium.launch({ channel: 'chrome' })

  await segment(1, async (page, scene) => {
    await page.locator('#username').waitFor()
    stamp(scene, '01-inicio-de-sesion')
    await fill(page, '#username', credentials.email)
    await fill(page, '#password', password)
    await click(page, 'Entrar')
    await page.getByRole('heading', { name: 'Reserva Salas' }).waitFor()
  }, '')
  await segment(2, async (page, scene) => {
    await calendar(page)
    await pause(page, 900)
    stamp(scene, '02-calendario')
    await click(page, '10:00 Libre')
    await fill(page, '#booked-for', 'Equipo de diseño')
    await fill(page, '#booking-notes', 'Revisión de prototipos')
    await click(page, 'Confirmar reserva')
    await page.getByText('Reserva confirmada', { exact: true }).waitFor()
    await pause(page, 560)
    stamp(scene, '03-reserva-confirmada')
  })
  await segment(3, async (page, scene) => {
    await calendar(page)
    await click(page, '11:00 Libre')
    let statuses
    await page.route('**/api/bookings', async (route) => {
      const data = route.request().postDataJSON()
      const other = () => fetch(`${origin}/api/bookings`, {
        method: 'POST', headers: { origin, cookie: memberCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ ...data, bookedFor: 'Equipo invitado' }),
      })
      const both = await Promise.all([other(), route.fetch()])
      statuses = both.map((response) => typeof response.status === 'function' ? response.status() : response.status)
      await route.fulfill({ response: both[1] })
    }, { times: 1 })
    await click(page, 'Confirmar reserva')
    await page.getByText(/Reserva confirmada|No se confirmó la reserva/, { exact: true }).waitFor()
    assert.deepEqual(statuses.sort(), [201, 409])
    if (await page.getByText('Reserva confirmada', { exact: true }).isVisible()) {
      // A real competing request also returns the conflict if the recorded session wins.
      const loser = await fetch(`${origin}/api/bookings`, {
        method: 'POST', headers: { origin, cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify(windowFor('11:00', '11:30')),
      })
      assert.equal(loser.status, 409)
    }
    await pause(page, 600)
    stamp(scene, '04-resultado-solicitudes-simultaneas')
  })
  await segment(4, async (page, scene) => {
    await click(page, 'Mis reservas')
    const row = page.getByRole('listitem').filter({ hasText: 'Equipo de diseño' })
    await row.waitFor()
    stamp(scene, '05-mis-reservas')
    await click(page, row.getByRole('button', { name: 'Editar o reprogramar' }))
    stamp(scene, '06-reprogramar-reserva')
    await fill(page, '#entry-start', `${day}T14:00`)
    await click(page, 'Guardar cambios')
    await page.getByText('Reserva actualizada.', { exact: true }).waitFor()
    page.once('dialog', (dialog) => dialog.accept())
    await click(page, row.getByRole('button', { name: 'Cancelar reserva' }))
    await page.getByText(/Reserva cancelada/).waitFor()
    await select(page, '#entries-view', 'history')
    await row.waitFor()
    stamp(scene, '07-historial-de-reservas')
  })
  await segment(5, async (page, scene) => {
    await click(page, 'Salas y bloqueos')
    await button(page, 'Editar Sala Olivo').waitFor()
    stamp(scene, '08-salas-y-bloqueos')
    await click(page, 'Editar Sala Olivo')
    stamp(scene, '09-editar-sala')
    await click(page, 'Cerrar formulario')
    await click(page, 'Nuevo bloqueo')
    await select(page, '#entry-room', 'olivo')
    await fill(page, '#entry-start', `${day}T16:00`)
    await fill(page, '#entry-end', `${day}T18:00`)
    await fill(page, '#entry-notes', 'Mantenimiento del proyector')
    stamp(scene, '10-nuevo-bloqueo')
    await click(page, 'Crear bloqueo')
    await page.getByText('Bloqueo creado.', { exact: true }).waitFor()
    stamp(scene, '11-bloqueo-confirmado')
  })
  await segment(6, async (page, scene) => {
    await click(page, 'Actividad')
    await page.getByText('Registro de actividad', { exact: true }).waitFor()
    await page.locator('details summary').first().waitFor()
    stamp(scene, '12-actividad')
    await click(page, page.locator('details summary').first())
    stamp(scene, '13-detalle-de-actividad')
  })
  await segment(7, async (page, scene) => {
    await click(page, page.getByRole('link', { name: /Mi cuenta/ }))
    await page.getByRole('heading', { name: 'Mi cuenta', exact: true }).waitFor()
    stamp(scene, '14-mi-cuenta-administrador')
    await page.locator('#new-email').evaluate((field) => field.scrollIntoView({ block: 'center' }))
    await pause(page, 500)
    stamp(scene, '15-crear-usuario')
    await click(page, page.getByText('Restablecer contraseña de miembro-demo', { exact: true }))
    await page.locator('form[action="/cuenta/restablecer"] input[name="confirm"]').evaluate((field) => field.scrollIntoView({ block: 'center' }))
    await pause(page, 550)
    stamp(scene, '16-restablecer-contrasena')
    await page.context().clearCookies()
    await page.context().addCookies([cookieSpec(memberCookie)])
    await page.goto(`${origin}/cuenta`)
    await page.getByRole('heading', { name: 'Mi cuenta', exact: true }).waitFor()
    await pause(page, 650)
    stamp(scene, '17-mi-cuenta-miembro')
  })
} finally {
  if (browser) await browser.close()
  if (server) await new Promise((resolve) => server.close(resolve))
  await close()
}
/* global fetch, document, addEventListener */
