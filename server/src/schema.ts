import { sql } from 'drizzle-orm'
import { boolean, check, integer, pgSchema, text, timestamp, uuid, jsonb } from 'drizzle-orm/pg-core'

export const reservations = pgSchema('reservas')

export const users = reservations.table('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  active: boolean('active').notNull().default(true),
  sessionVersion: integer('session_version').notNull().default(1),
}, (table) => [
  check('users_role', sql`${table.role} in ('admin', 'member')`),
  check('users_normalized', sql`${table.username} = lower(${table.username}) and ${table.email} = lower(${table.email})`),
])

export const rooms = reservations.table('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  capacity: integer('capacity').notNull(),
  active: boolean('active').notNull().default(true),
  openMinute: integer('open_minute').notNull().default(480),
  closeMinute: integer('close_minute').notNull().default(1200),
  timeZone: text('time_zone').notNull().default('UTC'),
  version: integer('version').notNull().default(1),
}, (table) => [
  check('rooms_positive_capacity', sql`${table.capacity} > 0`),
  check('rooms_daily_schedule', sql`${table.openMinute} >= 0 and ${table.closeMinute} <= 1440 and ${table.openMinute} < ${table.closeMinute} and ${table.openMinute} % 30 = 0 and ${table.closeMinute} % 30 = 0`),
])

export const bookings = reservations.table('bookings', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  kind: text('kind', { enum: ['booking', 'block'] }).notNull().default('booking'),
  bookedFor: text('booked_for').notNull().default(''),
  notes: text('notes').notNull().default(''),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  userId: uuid('user_id').references(() => users.id),
  version: integer('version').notNull().default(1),
}, (table) => [
  check('bookings_valid_duration', sql`(${table.kind} = 'booking' and extract(epoch from (${table.endsAt} - ${table.startsAt})) in (1800, 3600, 5400, 7200)) or (${table.kind} = 'block' and extract(epoch from (${table.endsAt} - ${table.startsAt})) between 60 and 2678400)`),
  // The exclusion constraint is maintained in the custom PostgreSQL migration.
])

export const audit = reservations.table('audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
})
