import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'
import { durations, isBusy, dayInZone, minute, minuteLabel, moveDay, roomHours } from './calendar'
import { api, handleSession, managedRooms, problem } from './manage-api'
import { Activity, Entries, Rooms } from './management'

type Window = { roomId: string; startsAt: string; endsAt: string }

async function fetchAvailability(query: Window, signal: AbortSignal) {
  const response = await api.availability.$get({ query }, { init: { signal } })
  handleSession(response.status)
  if (!response.ok) throw new Error('No se pudo consultar la disponibilidad.')
  return (await response.json()).busy
}

async function book(json: Window & { bookedFor: string; notes: string }) {
  const uncertain = 'No se pudo confirmar la reserva. Consulta el calendario antes de volver a intentarlo.'
  const response = await api.bookings.$post({ json }).catch(() => { throw new Error(uncertain) })
  handleSession(response.status)
  if (response.status === 201) return (await response.json()).booking
  if (response.status === 400) throw new Error('El horario no es válido o ya comenzó. Elige otro.')
  if (response.status === 503) throw new Error(uncertain)
  throw await problem(response)
}

const tabs = { calendar: 'Calendario', bookings: 'Mis reservas', rooms: 'Salas y bloqueos', audit: 'Actividad' } as const

export function App() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<keyof typeof tabs>('calendar')
  const profile = useQuery({
    queryKey: ['profile'],
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/profile', { signal })
      if (!response.ok) throw await problem(response)
      return response.json() as Promise<{ username: string; role: 'admin' | 'member' }>
    },
  })
  const admin = profile.data?.role === 'admin'
  return (
    <main className="mx-auto max-w-6xl space-y-7 px-4 py-8 sm:px-7 sm:py-12">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
            <CalendarDays aria-hidden="true" className="size-4" /> Gestión local
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><a href="/cuenta">Mi cuenta{profile.data ? ` · ${profile.data.username}` : ''}</a></Button>
            <form method="post" action="/logout">
              <Button type="submit" variant="outline" size="sm">Cerrar sesión</Button>
            </form>
          </div>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Reserva Salas</h1>
        <nav aria-label="Secciones" className="flex flex-wrap gap-2">
          {(Object.keys(tabs) as (keyof typeof tabs)[]).filter((key) => admin || key === 'calendar' || key === 'bookings').map((key) => (
            <Button key={key} aria-current={tab === key ? 'page' : undefined}
              variant={key === tab ? 'default' : 'outline'} onClick={() => {
                setTab(key)
                void queryClient.invalidateQueries()
              }}>{tabs[key]}</Button>
          ))}
        </nav>
      </header>
      {profile.isError && <Alert variant="destructive"><AlertDescription>No se pudo cargar tu cuenta.</AlertDescription></Alert>}
      {tab === 'calendar' && <Calendar />}
      {tab === 'bookings' && <Entries kind="booking" />}
      {admin && tab === 'rooms' && <div className="space-y-5"><Rooms /><Entries kind="block" /></div>}
      {admin && tab === 'audit' && <Activity />}
    </main>
  )
}

function Calendar() {
  const queryClient = useQueryClient()
  const [now, setNow] = useState(Date.now)
  const [day, setDay] = useState('')
  const [selectedRoom, setSelectedRoom] = useState('')
  const [duration, setDuration] = useState<number>(30)
  const [selectedStart, setSelectedStart] = useState<number | null>(null)
  const [bookedFor, setBookedFor] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  const rooms = useQuery({ queryKey: ['rooms'], queryFn: ({ signal }) => managedRooms(signal), retry: false })
  const activeRooms = rooms.data?.filter(({ active }) => active) ?? []
  const room = activeRooms.find(({ id }) => id === selectedRoom) ?? activeRooms[0]
  const timeZone = room?.timeZone ?? 'UTC'
  const today = dayInZone(now, timeZone)
  const date = day < today ? today : day
  const hours = room ? roomHours(date, room.openMinute, room.closeMinute, timeZone) : { open: null, close: null }
  const open = hours.open?.getTime() ?? 0
  const close = hours.close?.getTime() ?? 0
  const validHours = close > open
  const clock = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone })
  const fullDate = new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeZone: 'UTC' })
  const availability = useQuery({
    queryKey: ['availability', room?.id, open, close],
    queryFn: ({ signal }) => fetchAvailability({
      roomId: room?.id ?? '',
      startsAt: new Date(open).toISOString(),
      endsAt: new Date(close).toISOString(),
    }, signal),
    enabled: Boolean(room) && validHours,
    retry: false,
    refetchInterval: 5_000,
  })

  const reservation = useMutation({
    mutationFn: book,
    onSuccess: () => { setSelectedStart(null); setBookedFor(''); setNotes('') },
    onSettled: (_data, _error, values) => {
      void queryClient.invalidateQueries({ queryKey: ['availability', values.roomId] })
      void queryClient.invalidateQueries({ queryKey: ['entries'] })
      void queryClient.invalidateQueries({ queryKey: ['audit'] })
    },
  })

  const busy = availability.data ?? []
  const slots = Array.from({ length: Math.max(0, Math.ceil((close - open) / (30 * minute))) },
    (_, index) => open + index * 30 * minute)

  function slotStatus(start: number, length: number) {
    if (start <= now) return 'Pasado'
    if (isBusy(start, start + 30 * minute, busy)) return 'Ocupado'
    const end = start + length * minute
    if (end > close || isBusy(start, end, busy)) return 'No cabe'
    return 'Libre'
  }

  const validSelection = selectedStart !== null
    && selectedStart >= open && selectedStart < close
    && slotStatus(selectedStart, duration) === 'Libre'
    && !availability.isError && availability.isSuccess

  function resetForm() {
    setSelectedStart(null)
    reservation.reset()
  }

  function selectDay(next: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next < today || next >= '9999-12-31' || !Number.isFinite(Date.parse(`${next}T00:00:00Z`))) return
    setDay(next)
    resetForm()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!room || selectedStart === null || !validSelection || reservation.isPending) return
    reservation.mutate({
      roomId: room.id,
      startsAt: new Date(selectedStart).toISOString(),
      endsAt: new Date(selectedStart + duration * minute).toISOString(),
      bookedFor,
      notes,
    })
  }

  const shownStart = selectedStart !== null && selectedStart >= open && selectedStart < close
    ? selectedStart : null
  const locked = reservation.isPending

  return (
    <>
      {rooms.isPending && <p role="status">Cargando salas…</p>}
      {rooms.isError && (
        <Alert variant="destructive">
          <AlertTitle>No se pudieron cargar las salas.</AlertTitle>
          <AlertDescription>Comprueba que la API y PostgreSQL estén en marcha.</AlertDescription>
          <Button className="mt-2 w-fit" variant="outline" onClick={() => void rooms.refetch()}>
            Reintentar
          </Button>
        </Alert>
      )}
      {rooms.isSuccess && !room && <p role="status">No hay salas configuradas.</p>}

      {room && (
        <form onSubmit={submit} className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card>
            <CardHeader>
              <CardTitle>Disponibilidad</CardTitle>
              <CardDescription>{minuteLabel(room.openMinute)}–{minuteLabel(room.closeMinute)} · {timeZone}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="room">Sala</Label>
                  <NativeSelect id="room" className="w-full" value={room.id} disabled={locked} onChange={(event) => {
                    setSelectedRoom(event.target.value)
                    resetForm()
                  }}>
                    {activeRooms.map((item) => (
                      <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date">Fecha</Label>
                  <div className="flex gap-1.5">
                    <Button type="button" variant="outline" size="icon" aria-label="Día anterior"
                      disabled={date <= today || locked} onClick={() => selectDay(moveDay(date, -1))}>
                      <ChevronLeft aria-hidden="true" />
                    </Button>
                    <Input id="date" className="min-w-0 flex-1" type="date" min={today} max="9999-12-30"
                      value={date} disabled={locked} onChange={(event) => selectDay(event.target.value)} />
                    <Button type="button" variant="outline" size="icon" aria-label="Día siguiente"
                      disabled={date >= '9999-12-30' || locked} onClick={() => selectDay(moveDay(date, 1))}>
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-4">
                <h2 id="available-times" className="font-semibold capitalize">{fullDate.format(new Date(`${date}T00:00:00Z`))}</h2>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users aria-hidden="true" className="size-4" /> {room.capacity} personas
                </span>
              </div>
              {!validHours && <p role="status">El horario de apertura no existe en esta fecha por el cambio de hora.</p>}
              {validHours && availability.isPending && <p role="status">Consultando horarios…</p>}
              {availability.isError && (
                <Alert variant="destructive">
                  <AlertTitle>No se pudo consultar la disponibilidad.</AlertTitle>
                  <AlertDescription>Los horarios se volverán a consultar automáticamente.</AlertDescription>
                </Alert>
              )}
              {availability.isSuccess && (
                <>
                  <div role="group" aria-labelledby="available-times" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {slots.map((start) => {
                      const status = slotStatus(start, duration)
                      const selected = start === shownStart
                      return (
                        <Button key={start} type="button" variant={selected ? 'default' : 'outline'}
                          aria-pressed={selected} disabled={locked || status !== 'Libre'}
                          className={cn('h-auto flex-col gap-0.5 py-2', !selected && status === 'Ocupado' && 'bg-muted')}
                          onClick={() => {
                            setSelectedStart(start)
                            reservation.reset()
                          }}>
                          <span className="tabular-nums">{clock.format(start)}</span>
                          <span className="text-xs font-normal opacity-80">{status}</span>
                        </Button>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">La disponibilidad se actualiza cada 5 segundos.</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tu reserva</CardTitle>
              <CardDescription>{room.name}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="duration">Duración</Label>
                <NativeSelect id="duration" className="w-full" value={duration} disabled={locked} onChange={(event) => {
                  setDuration(Number(event.target.value))
                  reservation.reset()
                }}>
                  {durations.map((value) => <NativeSelectOption key={value} value={value}>{value} minutos</NativeSelectOption>)}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="booked-for">Para quién (opcional)</Label>
                <Input id="booked-for" maxLength={120} value={bookedFor} disabled={locked} onChange={(e) => setBookedFor(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="booking-notes">Notas (opcional)</Label>
                <textarea id="booking-notes" rows={3} maxLength={1000} value={notes} disabled={locked} onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-md border border-input p-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" />
              </div>

              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock3 aria-hidden="true" className="size-4 shrink-0" />
                {shownStart === null
                  ? 'Selecciona un horario libre.'
                  : `${clock.format(shownStart)}–${clock.format(shownStart + duration * minute)}${validSelection ? '' : ' · No disponible'}`}
              </p>

              <Button className="w-full" type="submit" disabled={!validSelection || locked}>
                {locked ? 'Confirmando…' : 'Confirmar reserva'}
              </Button>

              {reservation.isError && (
                <Alert variant="destructive">
                  <AlertTitle>No se confirmó la reserva</AlertTitle>
                  <AlertDescription>{reservation.error.message}</AlertDescription>
                </Alert>
              )}
              {reservation.data && (
                <Alert role="status">
                  <CheckCircle2 aria-hidden="true" />
                  <AlertTitle>Reserva confirmada</AlertTitle>
                  <AlertDescription>
                    <span>{fullDate.format(new Date(`${dayInZone(Date.parse(reservation.data.startsAt), timeZone)}T00:00:00Z`))}, {clock.format(Date.parse(reservation.data.startsAt))}–{clock.format(Date.parse(reservation.data.endsAt))}</span>
                    <span className="block break-all text-xs">Referencia: {reservation.data.id}</span>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </form>
      )}
    </>
  )
}
