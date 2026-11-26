import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { BookingStore } from './bookings.js'
import type { Account } from './accounts.js'

export type AuthContext = { Variables: { account?: Account } }

const windowSchema = z.strictObject({
  roomId: z.string().max(40).regex(/^[a-z0-9-]+$/),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
})
const detailsSchema = windowSchema.extend({
  bookedFor: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
})
const revision = z.number().int().min(1).max(2_147_483_647)
const idSchema = z.object({ id: z.uuid() })
const roomIdSchema = z.object({ id: z.string().max(40).regex(/^[a-z0-9-]+$/) })
const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
const listSchema = pageSchema.extend({
  view: z.enum(['upcoming', 'history']).default('upcoming'),
  kind: z.enum(['booking', 'block']).default('booking'),
})
const roomSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  capacity: z.number().int().min(1).max(10000),
  active: z.boolean(),
  openMinute: z.number().int().min(0).max(1410).multipleOf(30),
  closeMinute: z.number().int().min(30).max(1440).multipleOf(30),
  timeZone: z.string().max(100).regex(/^[A-Za-z0-9_+/-]+$/).refine((zone) => {
    try { new Intl.DateTimeFormat('es', { timeZone: zone }); return true } catch { return false }
  }),
})
const invalid = { error: 'invalid_input' } as const
const unavailable = { error: 'service_unavailable' } as const
const forbidden = { error: 'forbidden' } as const
const missing = { error: 'room_not_found' } as const
const minute = 60_000
const writeFailures = {
  conflict: { error: 'slot_conflict' },
  room_not_found: missing,
  room_inactive: { error: 'room_inactive' },
  outside_hours: { error: 'outside_hours' },
  stale: { error: 'stale' },
  entry_not_found: { error: 'entry_not_found' },
} as const

function parseWindow(values: z.infer<typeof windowSchema>) {
  const startsAt = new Date(values.startsAt)
  const endsAt = new Date(values.endsAt)
  return { ...values, startsAt, endsAt, minutes: (+endsAt - +startsAt) / minute }
}

export function createApp(store: BookingStore, now = Date.now) {
  return new Hono<AuthContext>()
    .onError((error, c) => {
      if (error instanceof HTTPException && error.status === 400) {
        return c.json(invalid, 400)
      }
      return c.json({ error: 'internal_error' }, 500)
    })
    .use('/api/*', async (c, next) => {
      await next()
      c.header('Cache-Control', 'no-store')
    })
    .get('/api/health', (c) => c.json({ status: 'ok' } as const, 200))
    .get('/api/rooms', async (c) => {
      try {
        return c.json({ rooms: await store.listRooms() }, 200)
      } catch {
        return c.json(unavailable, 503)
      }
    })
    .get('/api/availability', zValidator('query', windowSchema, (result, c) => {
      if (!result.success) return c.json(invalid, 400)
    }), async (c) => {
      const window = parseWindow(c.req.valid('query'))
      if (!(window.minutes > 0 && window.minutes <= 48 * 60)) return c.json(invalid, 400)
      try {
        const busy = await store.availability(window)
        if (!busy) return c.json(missing, 404)
        return c.json({ busy }, 200)
      } catch {
        return c.json(unavailable, 503)
      }
    })
    .post('/api/bookings', zValidator('json', detailsSchema, (result, c) => {
      if (!result.success) return c.json(invalid, 400)
    }), async (c) => {
      const window = parseWindow(c.req.valid('json'))
      const { bookedFor, notes } = c.req.valid('json')
      if (![30, 60, 90, 120].includes(window.minutes) || +window.startsAt <= now()) {
        return c.json(invalid, 400)
      }
      try {
        const result = await store.reserve({ ...window, bookedFor, notes, userId: c.get('account')?.id })
        if (result.status === 'confirmed') return c.json({ booking: result.booking }, 201)
        if (result.status === 'room_not_found') return c.json(missing, 404)
        return c.json(writeFailures[result.status], 409)
      } catch {
        return c.json(unavailable, 503)
      }
    })
    .get('/api/bookings', zValidator('query', listSchema, (result, c) => {
      if (!result.success) return c.json(invalid, 400)
    }), async (c) => {
      const { page, view, kind } = c.req.valid('query')
      const account = c.get('account')
      if (kind === 'block' && account?.role === 'member') return c.json(forbidden, 403)
      try {
        if (!store.manage) return c.json(unavailable, 503)
        return c.json(await store.manage.entries(view, kind, page, new Date(now()), account?.role === 'member' ? account.id : undefined), 200)
      } catch { return c.json(unavailable, 503) }
    })
    .patch('/api/bookings/:id', zValidator('param', idSchema), zValidator('json', detailsSchema.extend({ version: revision }), (result, c) => {
      if (!result.success) return c.json(invalid, 400)
    }), async (c) => {
      const { version, bookedFor, notes, ...values } = c.req.valid('json')
      const window = parseWindow(values)
      const instant = now()
      if (![30, 60, 90, 120].includes(window.minutes) || +window.startsAt <= instant) return c.json(invalid, 400)
      try {
        if (!store.manage) return c.json(unavailable, 503)
        const account = c.get('account')
        const result = await store.manage.update(c.req.valid('param').id, version, {
          ...window, bookedFor, notes,
        }, new Date(instant), account?.role === 'member' ? account.id : undefined)
        if (result.status === 'confirmed') return c.json({ booking: result.booking }, 200)
        return c.json(writeFailures[result.status], result.status.endsWith('_not_found') ? 404 : 409)
      } catch { return c.json(unavailable, 503) }
    })
    .post('/api/bookings/:id/cancel', zValidator('param', idSchema), zValidator('json', z.strictObject({ version: revision })), async (c) => {
      try {
        if (!store.manage) return c.json(unavailable, 503)
        const account = c.get('account')
        const result = await store.manage.cancel(c.req.valid('param').id, c.req.valid('json').version, new Date(now()),
          account?.role === 'member' ? account.id : undefined)
        if (result.status === 'confirmed') return c.json({ booking: result.booking }, 200)
        return c.json(writeFailures[result.status], result.status === 'entry_not_found' ? 404 : 409)
      } catch { return c.json(unavailable, 503) }
    })
    .post('/api/blocks', zValidator('json', windowSchema.extend({
      notes: z.string().trim().min(1).max(1000),
    }), (result, c) => {
      if (!result.success) return c.json(invalid, 400)
    }), async (c) => {
      if (c.get('account')?.role === 'member') return c.json(forbidden, 403)
      const { notes, ...values } = c.req.valid('json')
      const window = parseWindow(values)
      if (!(window.minutes >= 1 && window.minutes <= 31 * 1440) || +window.startsAt <= now()) return c.json(invalid, 400)
      try {
        const result = await store.reserve({ ...window, kind: 'block', notes })
        if (result.status === 'confirmed') return c.json({ booking: result.booking }, 201)
        return c.json(writeFailures[result.status], result.status === 'room_not_found' ? 404 : 409)
      } catch { return c.json(unavailable, 503) }
    })
    .get('/api/manage/rooms', async (c) => {
      try {
        if (!store.manage) return c.json(unavailable, 503)
        return c.json({ rooms: await store.manage.rooms() }, 200)
      } catch { return c.json(unavailable, 503) }
    })
    .post('/api/manage/rooms', zValidator('json', roomSchema), async (c) => {
      if (c.get('account')?.role === 'member') return c.json(forbidden, 403)
      const room = c.req.valid('json')
      if (room.openMinute >= room.closeMinute) return c.json(invalid, 400)
      try {
        if (!store.manage) return c.json(unavailable, 503)
        const result = await store.manage.saveRoom(room)
        return result.status === 'saved' ? c.json({ room: result.room }, 201) : c.json(invalid, 400)
      } catch { return c.json(unavailable, 503) }
    })
    .patch('/api/manage/rooms/:id', zValidator('param', roomIdSchema), zValidator('json', roomSchema.extend({ version: revision })), async (c) => {
      if (c.get('account')?.role === 'member') return c.json(forbidden, 403)
      const { version, ...room } = c.req.valid('json')
      if (room.openMinute >= room.closeMinute) return c.json(invalid, 400)
      try {
        if (!store.manage) return c.json(unavailable, 503)
        const result = await store.manage.saveRoom(room, { id: c.req.valid('param').id, version })
        if (result.status === 'saved') return c.json({ room: result.room }, 200)
        if (result.status === 'invalid_zone') return c.json(invalid, 400)
        return c.json({ error: 'stale' } as const, 409)
      } catch { return c.json(unavailable, 503) }
    })
    .get('/api/manage/audit', zValidator('query', pageSchema), async (c) => {
      if (c.get('account')?.role === 'member') return c.json(forbidden, 403)
      try {
        if (!store.manage) return c.json(unavailable, 503)
        return c.json(await store.manage.audit(c.req.valid('query').page), 200)
      } catch { return c.json(unavailable, 503) }
    })
}

export type AppType = ReturnType<typeof createApp>
