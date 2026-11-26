import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Entry, ManagedRoom } from '../../server/src/bookings.js'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { dateTimeInZone, durations, minute, minuteLabel, zonedInstant } from './calendar'
import { api, managedRooms, problem } from './manage-api'

const field = (data: FormData, key: string) => String(data.get(key) ?? '')

function message(error: Error | null) {
  return error && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>
}

function Pagination({ page, hasNext, onChange }: { page: number; hasNext: boolean; onChange: (page: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</Button>
      <span className="text-sm text-muted-foreground">Página {page}</span>
      <Button type="button" variant="outline" size="sm" disabled={!hasNext} onClick={() => onChange(page + 1)}>Siguiente</Button>
    </div>
  )
}

function useRooms() {
  return useQuery({ queryKey: ['rooms'], queryFn: ({ signal }) => managedRooms(signal), retry: false })
}

function useRefresh() {
  const cache = useQueryClient()
  return () => {
    for (const key of ['rooms', 'entries', 'audit', 'availability']) {
      void cache.invalidateQueries({ queryKey: [key] })
    }
  }
}

function dateLabel(value: string, zone?: string) {
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(value))
}

export function Rooms() {
  const rooms = useRooms()
  const [editing, setEditing] = useState<ManagedRoom | 'new' | null>(null)
  const refresh = useRefresh()
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Administrar salas</CardTitle>
          <Button onClick={() => setEditing('new')} disabled={editing !== null}>Nueva sala</Button>
        </div>
        <CardDescription>Horario diario y zona horaria por sala. Los cambios no anulan las reservas existentes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message(rooms.error)}
        {rooms.isPending && <p role="status">Cargando salas…</p>}
        {editing && <RoomForm key={editing === 'new' ? 'new' : `${editing.id}-${editing.version}`}
          room={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh() }} />}
        <ul className="divide-y">
          {rooms.data?.map((room) => (
            <li key={room.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{room.name}</p>
                <p className="text-sm text-muted-foreground">
                  {room.capacity} personas · {room.active ? 'Activa' : 'Desactivada'} · {minuteLabel(room.openMinute)}–{minuteLabel(room.closeMinute)} · {room.timeZone}
                </p>
              </div>
              <Button variant="outline" size="sm" disabled={editing !== null} onClick={() => setEditing(room)}>Editar <span className="sr-only">{room.name}</span></Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function RoomForm({ room, onClose, onSaved }: { room?: ManagedRoom; onClose: () => void; onSaved: () => void }) {
  const save = useMutation({
    mutationFn: async (data: FormData) => {
      const json = {
        name: field(data, 'name'), capacity: Number(field(data, 'capacity')),
        openMinute: Number(field(data, 'open')), closeMinute: Number(field(data, 'close')),
        active: field(data, 'active') === 'yes', timeZone: field(data, 'zone').trim(),
      }
      const response = room
        ? await api.manage.rooms[':id'].$patch({ param: { id: room.id }, json: { ...json, version: room.version } })
        : await api.manage.rooms.$post({ json })
      if (!response.ok) throw await problem(response)
    },
    onSuccess: onSaved,
  })
  const choices = Array.from({ length: 49 }, (_, i) => i * 30)
  return (
    <form className="space-y-3 rounded-lg border p-4" onSubmit={(event) => {
      event.preventDefault()
      save.mutate(new FormData(event.currentTarget))
    }}>
      <h3 className="font-semibold">{room ? `Editar ${room.name}` : 'Nueva sala'}</h3>
      <fieldset disabled={save.isPending} className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="room-name">Nombre</Label><Input id="room-name" name="name" required maxLength={100} defaultValue={room?.name} /></div>
        <div className="space-y-1"><Label htmlFor="room-capacity">Capacidad</Label><Input id="room-capacity" name="capacity" type="number" min={1} max={10000} required defaultValue={room?.capacity ?? 4} /></div>
        <div className="space-y-1"><Label htmlFor="room-open">Apertura</Label><NativeSelect id="room-open" name="open" defaultValue={room?.openMinute ?? 480}>
          {choices.slice(0, -1).map((value) => <NativeSelectOption key={value} value={value}>{minuteLabel(value)}</NativeSelectOption>)}
        </NativeSelect></div>
        <div className="space-y-1"><Label htmlFor="room-close">Cierre</Label><NativeSelect id="room-close" name="close" defaultValue={room?.closeMinute ?? 1200}>
          {choices.slice(1).map((value) => <NativeSelectOption key={value} value={value}>{minuteLabel(value)}</NativeSelectOption>)}
        </NativeSelect></div>
        <div className="space-y-1"><Label htmlFor="room-zone">Zona horaria IANA</Label><Input id="room-zone" name="zone" required maxLength={100}
          placeholder="America/Mexico_City" defaultValue={room?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} /></div>
        <div className="space-y-1"><Label htmlFor="room-active">Estado</Label><NativeSelect id="room-active" name="active" defaultValue={room?.active === false ? 'no' : 'yes'}>
          <NativeSelectOption value="yes">Activa</NativeSelectOption><NativeSelectOption value="no">Desactivada</NativeSelectOption>
        </NativeSelect></div>
      </fieldset>
      {message(save.error)}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar sala'}</Button>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cerrar formulario</Button>
      </div>
    </form>
  )
}

export function Entries({ kind }: { kind: 'booking' | 'block' }) {
  const [view, setView] = useState<'upcoming' | 'history'>('upcoming')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Entry | 'block' | null>(null)
  const [notice, setNotice] = useState('')
  const rooms = useRooms()
  const refresh = useRefresh()
  const entries = useQuery({
    queryKey: ['entries', kind, view, page],
    queryFn: async ({ signal }) => {
      const response = await api.bookings.$get({ query: { kind, view, page: String(page) } }, { init: { signal } })
      if (response.status !== 200) throw await problem(response)
      return response.json()
    },
    retry: false,
  })
  const cancel = useMutation({
    mutationFn: async (entry: Entry) => {
      const response = await api.bookings[':id'].cancel.$post({ param: { id: entry.id }, json: { version: entry.version } })
      if (response.status !== 200) throw await problem(response)
    },
    onSuccess: () => setNotice(kind === 'booking' ? 'Reserva cancelada. El horario quedó libre.' : 'Bloqueo retirado. El horario quedó libre.'),
    onSettled: refresh,
  })
  const availableRooms = (rooms.data ?? []).filter(({ active }) => active)
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{kind === 'booking' ? 'Mis reservas' : 'Bloqueos de mantenimiento'}</CardTitle>
          {kind === 'block' && <Button disabled={editing !== null || !availableRooms.length} onClick={() => {
            setEditing('block')
            setNotice('')
          }}>Nuevo bloqueo</Button>}
        </div>
        <CardDescription>{kind === 'booking' ? 'Consulta, reprograma o cancela tus reservas.' : 'Aparta horarios en los que una sala no deba reservarse.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="entries-view">Mostrar</Label>
          <NativeSelect id="entries-view" value={view} onChange={(event) => {
            setView(event.target.value === 'history' ? 'history' : 'upcoming')
            setPage(1)
          }}>
            <NativeSelectOption value="upcoming">Próximos y en curso</NativeSelectOption>
            <NativeSelectOption value="history">Historial</NativeSelectOption>
          </NativeSelect>
        </div>
        {editing && <EntryForm key={editing === 'block' ? 'block' : editing.id}
          entry={editing === 'block' ? undefined : editing} rooms={availableRooms} allRooms={rooms.data ?? []}
          onClose={() => setEditing(null)} onSaved={() => {
            setEditing(null)
            setNotice(kind === 'booking' ? 'Reserva actualizada.' : 'Bloqueo creado.')
            refresh()
          }} />}
        {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
        {message(rooms.error)}
        {message(entries.error)}
        {message(cancel.error)}
        {entries.isPending && <p role="status">Cargando…</p>}
        {entries.data?.entries.length === 0 && <p className="text-sm text-muted-foreground">No hay registros en esta página.</p>}
        <ul className="divide-y">
          {entries.data?.entries.map((entry) => {
            const room = rooms.data?.find(({ id }) => id === entry.roomId)
            const upcoming = view === 'upcoming'
            return (
              <li key={entry.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{room?.name ?? entry.roomId}{entry.bookedFor && ` · ${entry.bookedFor}`}</p>
                  <p className="text-sm">{dateLabel(entry.startsAt, room?.timeZone)} – {dateLabel(entry.endsAt, room?.timeZone)}</p>
                  {entry.notes && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{entry.notes}</p>}
                  <p className="break-all text-xs text-muted-foreground">
                    Ref. {entry.id}{entry.cancelledAt ? ` · Cancelado: ${dateLabel(entry.cancelledAt)}` : ''}
                  </p>
                </div>
                {upcoming && <div className="flex flex-wrap gap-2">
                  {kind === 'booking' && Date.parse(entry.startsAt) > Date.now() && availableRooms.length > 0 &&
                    <Button size="sm" variant="outline" disabled={editing !== null || cancel.isPending}
                      onClick={() => { setEditing(entry); setNotice(''); cancel.reset() }}>Editar o reprogramar</Button>}
                  <Button size="sm" variant="destructive" disabled={editing !== null || cancel.isPending}
                    onClick={() => {
                      if (window.confirm(kind === 'booking' ? '¿Cancelar esta reserva?' : '¿Retirar este bloqueo?')) {
                        setNotice('')
                        cancel.mutate(entry)
                      }
                    }}>{kind === 'booking' ? 'Cancelar reserva' : 'Retirar bloqueo'}</Button>
                </div>}
              </li>
            )
          })}
        </ul>
        <Pagination page={page} hasNext={entries.data?.hasNext ?? false} onChange={setPage} />
      </CardContent>
    </Card>
  )
}

function EntryForm({ entry, rooms, allRooms, onClose, onSaved }: {
  entry?: Entry; rooms: ManagedRoom[]; allRooms: ManagedRoom[]; onClose: () => void; onSaved: () => void
}) {
  const [roomId, setRoomId] = useState(entry?.roomId ?? rooms[0]?.id ?? '')
  const room = rooms.find(({ id }) => id === roomId)
  const originalRoom = allRooms.find(({ id }) => id === entry?.roomId)
  const originalDuration = entry ? (Date.parse(entry.endsAt) - Date.parse(entry.startsAt)) / minute : 30
  const save = useMutation({
    mutationFn: async (data: FormData) => {
      if (!room) throw new Error('Selecciona una sala activa.')
      const input = field(data, 'starts')
      const unchanged = entry && originalRoom?.id === roomId
        && input === dateTimeInZone(new Date(entry.startsAt), room.timeZone)
      const starts = unchanged ? new Date(entry.startsAt) : zonedInstant(input, room.timeZone)
      const ends = entry && starts
        ? new Date(+starts + Number(field(data, 'duration')) * minute)
        : zonedInstant(field(data, 'ends'), room.timeZone)
      if (!starts || !ends || +ends <= +starts) {
        throw new Error('Revisa las fechas. Algunas horas no existen durante un cambio de horario.')
      }
      const json = { roomId, startsAt: starts.toISOString(), endsAt: ends.toISOString(), notes: field(data, 'notes') }
      const response = entry
        ? await api.bookings[':id'].$patch({
          param: { id: entry.id }, json: { ...json, version: entry.version, bookedFor: field(data, 'bookedFor') },
        })
        : await api.blocks.$post({ json })
      if (!response.ok) throw await problem(response)
    },
    onSuccess: onSaved,
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    save.mutate(new FormData(event.currentTarget))
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border p-4">
      <h3 className="font-semibold">{entry ? 'Editar o reprogramar reserva' : 'Nuevo bloqueo'}</h3>
      <fieldset disabled={save.isPending} className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="entry-room">Sala</Label><NativeSelect id="entry-room" required value={roomId}
          onChange={(event) => setRoomId(event.target.value)}>
          {!room && <NativeSelectOption value={roomId} disabled>Selecciona una sala activa</NativeSelectOption>}
          {rooms.map((option) => <NativeSelectOption key={option.id} value={option.id}>{option.name}</NativeSelectOption>)}
        </NativeSelect></div>
        <div className="space-y-1"><Label htmlFor="entry-start">Inicio</Label><Input id="entry-start" type="datetime-local" name="starts" required
          defaultValue={entry && originalRoom ? dateTimeInZone(new Date(entry.startsAt), originalRoom.timeZone) : undefined} /></div>
        {entry ? <>
          <div className="space-y-1"><Label htmlFor="entry-length">Duración</Label><NativeSelect id="entry-length" name="duration" defaultValue={originalDuration}>
            {durations.map((value) => <NativeSelectOption key={value} value={value}>{value} min</NativeSelectOption>)}
          </NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="entry-person">Para quién</Label><Input id="entry-person" name="bookedFor" maxLength={120} defaultValue={entry.bookedFor} /></div>
        </> : <div className="space-y-1"><Label htmlFor="entry-end">Fin</Label><Input id="entry-end" type="datetime-local" name="ends" required /></div>}
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="entry-notes">{entry ? 'Notas' : 'Motivo del bloqueo'}</Label>
          <textarea id="entry-notes" name="notes" required={!entry} maxLength={1000} rows={3} defaultValue={entry?.notes}
            className="w-full rounded-md border border-input p-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" />
        </div>
      </fieldset>
      {room && <p className="text-sm text-muted-foreground">Introduce las horas en {room.timeZone}.</p>}
      {message(save.error)}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || !room}>{save.isPending ? 'Guardando…' : entry ? 'Guardar cambios' : 'Crear bloqueo'}</Button>
        <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cerrar formulario</Button>
      </div>
    </form>
  )
}

export function Activity() {
  const [page, setPage] = useState(1)
  const activity = useQuery({
    queryKey: ['audit', page],
    queryFn: async ({ signal }) => {
      const response = await api.manage.audit.$get({ query: { page: String(page) } }, { init: { signal } })
      if (response.status !== 200) throw await problem(response)
      return response.json()
    },
    retry: false,
  })
  const actions: Record<string, string> = { insert: 'Creación', update: 'Actualización', cancel: 'Cancelación', delete: 'Eliminación', password_reset: 'Restablecimiento de contraseña' }
  const entities: Record<string, string> = { rooms: 'Sala', bookings: 'Reserva o bloqueo', users: 'Usuario' }
  return (
    <Card>
      <CardHeader><CardTitle>Registro de actividad</CardTitle><CardDescription>Cambios aplicados desde la actualización. Las operaciones rechazadas no alteran el registro.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {message(activity.error)}
        {activity.isPending && <p role="status">Cargando actividad…</p>}
        {activity.data?.changes.length === 0 && <p>No hay cambios registrados.</p>}
        <ul className="divide-y">
          {activity.data?.changes.map((change) => (
            <li key={change.id} className="py-3">
              <p className="font-medium">{actions[change.action] ?? change.action} · {entities[change.entity] ?? change.entity}</p>
              <p className="break-all text-sm text-muted-foreground">{dateLabel(change.at)} · {change.entityId}</p>
              <details className="mt-1 text-sm">
                <summary className="cursor-pointer">Ver detalles</summary>
                <pre className="mt-2 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify({ antes: change.before, después: change.after }, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ul>
        <Pagination page={page} hasNext={activity.data?.hasNext ?? false} onChange={setPage} />
      </CardContent>
    </Card>
  )
}
