import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'
import type { createDatabase } from './db.js'
import { audit, bookings, rooms } from './schema.js'

type Db = ReturnType<typeof createDatabase>['db']

export type Room = { id: string; name: string; capacity: number }
export type ManagedRoom = typeof rooms.$inferSelect
export type Interval = { startsAt: string; endsAt: string }
export type Booking = Interval & { id: string; roomId: string }
type Window = { roomId: string; startsAt: Date; endsAt: Date }
type EntryInput = Window & { kind?: 'booking' | 'block'; bookedFor?: string; notes?: string; userId?: string }
type RoomInput = Omit<ManagedRoom, 'id' | 'version'>
type EntryRow = typeof bookings.$inferSelect
type EntryStatus = 'conflict' | 'room_not_found' | 'room_inactive' | 'outside_hours' | 'stale' | 'entry_not_found'
type EntryResult =
  | { status: 'confirmed'; booking: Booking & { version: number } }
  | { status: EntryStatus }
export type Entry = Booking & Pick<EntryRow, 'kind' | 'bookedFor' | 'notes' | 'version'> & {
  cancelledAt: string | null
}

export type BookingStore = {
  listRooms(): Promise<Room[]>
  availability(window: Window): Promise<Interval[] | null>
  reserve(window: EntryInput): Promise<
    | { status: 'confirmed'; booking: Booking }
    | { status: EntryStatus }
  >
  manage?: ReturnType<typeof createManagement>
}

function timestamps(row: { startsAt: Date; endsAt: Date }): Interval {
  return { startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() }
}

function postgresError(error: unknown): { code: unknown; constraint: unknown } | undefined {
  if (!error || typeof error !== 'object') return
  if ('code' in error && 'constraint' in error) {
    return { code: error.code, constraint: error.constraint }
  }
  if (error instanceof Error && error.cause !== error) return postgresError(error.cause)
}

function managedEntry(row: EntryRow): Entry {
  const { id, roomId, kind, bookedFor, notes, version, cancelledAt } = row
  return { id, roomId, kind, bookedFor, notes, version, cancelledAt: cancelledAt?.toISOString() ?? null, ...timestamps(row) }
}

async function writeEntry(write: () => Promise<EntryRow[]>, onMissing: () => Promise<'stale' | 'entry_not_found'>): Promise<EntryResult> {
  try {
    const [row] = await write()
    return row ? {
      status: 'confirmed',
      booking: { id: row.id, roomId: row.roomId, version: row.version, ...timestamps(row) },
    } : { status: await onMissing() }
  } catch (error) {
    const pg = postgresError(error)
    if (pg?.code === '23P01' && pg.constraint === 'bookings_no_overlap') return { status: 'conflict' }
    if (pg?.code === '23503' && pg.constraint === 'bookings_room_id_rooms_id_fk') return { status: 'room_not_found' }
    if (pg?.code === '23514' && pg.constraint === 'bookings_room_inactive') return { status: 'room_inactive' }
    if (pg?.code === '23514' && pg.constraint === 'bookings_room_hours') return { status: 'outside_hours' }
    throw error
  }
}

const pageSize = 25

function createManagement(db: Db) {
  const ownership = (owner?: string) => owner ? eq(bookings.userId, owner) : undefined
  async function missing(id: string, owner?: string) {
    const [row] = await db.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.id, id), ownership(owner)))
    return row ? 'stale' as const : 'entry_not_found' as const
  }

  return {
    rooms: () => db.select().from(rooms).orderBy(asc(rooms.name), asc(rooms.id)),
    async saveRoom(input: RoomInput, edit?: { id: string; version: number }) {
      const zone = await db.execute(sql`select 1 from pg_timezone_names where name = ${input.timeZone}`)
      if (!zone.rowCount) return { status: 'invalid_zone' } as const
      const [room] = edit
        ? await db.update(rooms).set({ ...input, version: sql`${rooms.version} + 1` })
          .where(and(eq(rooms.id, edit.id), eq(rooms.version, edit.version))).returning()
        : await db.insert(rooms).values({ ...input, id: randomUUID() }).returning()
      return room ? { status: 'saved', room } as const : { status: 'stale' } as const
    },
    async entries(view: 'upcoming' | 'history', kind: 'booking' | 'block', page: number, now: Date, owner?: string) {
      const upcoming = view === 'upcoming'
      const rows = await db.select().from(bookings).where(and(
        eq(bookings.kind, kind),
        ownership(owner),
        upcoming
          ? and(isNull(bookings.cancelledAt), gt(bookings.endsAt, now))
          : or(sql`${bookings.cancelledAt} is not null`, lte(bookings.endsAt, now)),
      )).orderBy(
        upcoming ? asc(bookings.startsAt) : desc(bookings.startsAt),
        upcoming ? asc(bookings.id) : desc(bookings.id),
      ).limit(pageSize + 1).offset((page - 1) * pageSize)
      return { entries: rows.slice(0, pageSize).map(managedEntry), hasNext: rows.length > pageSize }
    },
    update(id: string, version: number, input: EntryInput, now: Date, owner?: string) {
      return writeEntry(() => db.update(bookings).set({
        roomId: input.roomId, startsAt: input.startsAt, endsAt: input.endsAt,
        bookedFor: input.bookedFor, notes: input.notes, version: sql`${bookings.version} + 1`,
      }).where(and(
        eq(bookings.id, id), eq(bookings.version, version), eq(bookings.kind, 'booking'),
        ownership(owner),
        isNull(bookings.cancelledAt), gt(bookings.startsAt, now),
      )).returning(), () => missing(id, owner))
    },
    cancel(id: string, version: number, now: Date, owner?: string) {
      return writeEntry(() => db.update(bookings).set({
        cancelledAt: now, version: sql`${bookings.version} + 1`,
      }).where(and(
        eq(bookings.id, id), eq(bookings.version, version),
        ownership(owner),
        isNull(bookings.cancelledAt), gt(bookings.endsAt, now),
      )).returning(), () => missing(id, owner))
    },
    async audit(page: number) {
      const rows = await db.select().from(audit).orderBy(desc(audit.at), desc(audit.id))
        .limit(pageSize + 1).offset((page - 1) * pageSize)
      return { changes: rows.slice(0, pageSize).map((row) => ({ ...row, at: row.at.toISOString() })), hasNext: rows.length > pageSize }
    },
  }
}

export function createBookingStore(db: Db): BookingStore {
  return {
    manage: createManagement(db),
    listRooms: () => db.select().from(rooms).where(eq(rooms.active, true)).orderBy(asc(rooms.name)),
    async availability({ roomId, startsAt, endsAt }) {
      const [room] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.active, true)))
      if (!room) return null
      const rows = await db.select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
        .from(bookings)
        .where(and(
          eq(bookings.roomId, roomId),
          isNull(bookings.cancelledAt),
          sql`tstzrange(${bookings.startsAt}, ${bookings.endsAt}, '[)') &&
            tstzrange(${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz, '[)')`,
        ))
        .orderBy(asc(bookings.startsAt))
      return rows.map(timestamps)
    },
    async reserve(window) {
      const { roomId, startsAt, endsAt, kind, bookedFor, notes, userId } = window
      const result = await writeEntry(
        () => db.insert(bookings).values({ roomId, startsAt, endsAt, kind, bookedFor, notes, userId }).returning(),
        async () => { throw new Error('PostgreSQL did not return a booking') },
      )
      if (result.status !== 'confirmed') return result
      const { id, ...booking } = result.booking
      return { status: 'confirmed', booking: { id, roomId: booking.roomId, startsAt: booking.startsAt, endsAt: booking.endsAt } }
    },
  }
}
