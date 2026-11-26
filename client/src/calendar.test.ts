import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dayInZone, isBusy, roomHours, zonedInstant } from './calendar.js'

test('los horarios se calculan en la zona de la sala y admiten un cierre a medianoche', () => {
  const hours = roomHours('2030-03-20', 480, 1440, 'America/Mexico_City')
  assert.equal(hours.open?.toISOString(), '2030-03-20T14:00:00.000Z')
  assert.equal(hours.close?.toISOString(), '2030-03-21T06:00:00.000Z')
  assert.equal(dayInZone(Date.parse('2030-03-21T03:00:00Z'), 'America/Mexico_City'), '2030-03-20')
})

test('no se inventa una hora inexistente; una hora que se repite elige la primera ocurrencia', () => {
  assert.equal(zonedInstant('2030-03-10T02:30', 'America/New_York'), null)
  assert.equal(zonedInstant('2030-11-03T01:30', 'America/New_York')?.toISOString(), '2030-11-03T05:30:00.000Z')
})

test('los intervalos contiguos siguen libres', () => {
  const startsAt = '2030-03-20T14:00:00Z'
  const endsAt = '2030-03-20T15:00:00Z'
  assert.equal(isBusy(Date.parse(endsAt), Date.parse('2030-03-20T15:30:00Z'), [{ startsAt, endsAt }]), false)
  assert.equal(isBusy(Date.parse('2030-03-20T14:30:00Z'), Date.parse(endsAt), [{ startsAt, endsAt }]), true)
})
