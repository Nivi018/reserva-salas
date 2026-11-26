import type { Interval } from '../../server/src/bookings.js'

export const minute = 60_000
export const durations = [30, 60, 90, 120] as const
export const minuteLabel = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`

const formatters = new Map<string, Intl.DateTimeFormat>()

function wallParts(date: Date | number, timeZone: string) {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
    formatters.set(timeZone, formatter)
  }
  return Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]))
}

export function dayInZone(date: Date | number, timeZone: string) {
  const { year, month, day } = wallParts(date, timeZone)
  return `${year?.padStart(4, '0')}-${month}-${day}`
}

export function dateTimeInZone(date: Date | number, timeZone: string) {
  const { hour, minute } = wallParts(date, timeZone)
  return `${dayInZone(date, timeZone)}T${hour}:${minute}`
}

// Resolve wall time independently of the browser zone. At a repeated time prefer the earlier instant.
export function zonedInstant(value: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const wall = Date.parse(`${value}:00Z`)
  if (!Number.isFinite(wall)) return null
  const offsets = new Set([-24, 0, 24].map((hour) => {
    const probe = wall + hour * 60 * minute
    return Date.parse(`${dateTimeInZone(probe, timeZone)}:00Z`) - probe
  }))
  const matches = [...offsets].map((offset) => wall - offset)
    .filter((instant) => dateTimeInZone(instant, timeZone) === value)
  return matches.length ? new Date(Math.min(...matches)) : null
}

export function moveDay(day: string, delta: number) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

export function roomHours(day: string, opens: number, closes: number, zone: string) {
  return {
    open: zonedInstant(`${day}T${minuteLabel(opens)}`, zone),
    close: zonedInstant(closes === 1440 ? `${moveDay(day, 1)}T00:00` : `${day}T${minuteLabel(closes)}`, zone),
  }
}

export function isBusy(start: number, end: number, busy: Interval[]) {
  return busy.some(({ startsAt, endsAt }) => start < Date.parse(endsAt) && end > Date.parse(startsAt))
}
