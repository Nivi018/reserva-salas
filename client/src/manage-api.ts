import { hc } from 'hono/client'
import type { AppType } from '../../server/src/app.js'

export const api = hc<AppType>('/').api

export function handleSession(status: number) {
  if (status === 401) window.location.assign('/login')
}

const errors: Record<string, string> = {
  invalid_input: 'Revisa los datos, el horario y la zona horaria.',
  slot_conflict: 'Ese horario ya tiene una reserva o un bloqueo.',
  stale: 'El registro cambió o ya no se puede editar. Recarga la lista antes de reintentar.',
  room_inactive: 'La sala está desactivada.',
  outside_hours: 'El horario está fuera de la apertura de la sala.',
  room_not_found: 'La sala ya no está disponible.',
  entry_not_found: 'No se encontró la reserva o el bloqueo.',
}

export async function problem(response: Response) {
  handleSession(response.status)
  const data = await response.json().catch(() => null) as { error?: string } | null
  return new Error((data?.error && errors[data.error]) || 'No se pudo completar la operación. Inténtalo de nuevo.')
}

export async function managedRooms(signal: AbortSignal) {
  const response = await api.manage.rooms.$get(undefined, { init: { signal } })
  if (response.status !== 200) throw await problem(response)
  return (await response.json()).rooms
}
