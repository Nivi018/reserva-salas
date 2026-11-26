import { spawnSync } from 'node:child_process'
import console from 'node:console'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, linkSync, mkdirSync, openSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { URL, fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const [action, filename, destination] = process.argv.slice(2)
const defaultFile = resolve(project, 'backups', `reserva-salas-${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(3).toString('hex')}.dump`)
const archive = filename ? resolve(filename) : defaultFile
const verification = `reserva_verificacion_${randomBytes(8).toString('hex')}`

function docker(args, streams = ['ignore', 'inherit', 'inherit']) {
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'db', ...args], { cwd: project, stdio: streams })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Falló el comando de PostgreSQL.')
}

const shell = (command, values = [], streams) =>
  docker(['sh', '-ec', `export PGPASSWORD="$POSTGRES_PASSWORD"; ${command}`, 'backup', ...values], streams)

function validateDatabaseName(name) {
  if (!name || !/^reserva_restaurada_[a-z0-9_]{1,40}$/.test(name)) {
    throw new Error('Usa un nombre nuevo con prefijo reserva_restaurada_, seguido de letras minúsculas, números o guiones bajos.')
  }
}

function restoreInto(name) {
  if (!existsSync(archive)) throw new Error(`No existe la copia: ${archive}`)
  const fd = openSync(archive, 'r')
  let created = false
  try {
    // createdb fails if the database already exists; never restore over a live database.
    shell('[ "$1" != "$POSTGRES_DB" ]; createdb -h 127.0.0.1 -U "$POSTGRES_USER" -- "$1"', [name])
    created = true
    shell('pg_restore -h 127.0.0.1 -U "$POSTGRES_USER" --dbname="$1" --single-transaction --exit-on-error --no-owner --no-privileges', [name], [fd, 'inherit', 'inherit'])
    shell('psql -X -h 127.0.0.1 -U "$POSTGRES_USER" --dbname="$1" -v ON_ERROR_STOP=1 -c "$2"', [
      name,
      `select (select count(*) from reservas.rooms) as salas,
              (select count(*) from reservas.bookings) as entradas,
              (select count(*) from reservas.audit) as cambios;
       do $$ begin
         if to_regclass('reservas.users') is not null then
           if not exists (select from pg_constraint where conrelid = 'reservas.bookings'::regclass
             and conname = 'bookings_user_id_users_id_fk' and contype = 'f') then
             raise exception 'Falta el vínculo de reservas con usuarios';
           end if;
         end if;
         if not exists (select from pg_constraint where conrelid = 'reservas.bookings'::regclass
           and conname = 'bookings_no_overlap' and contype = 'x') then
           raise exception 'Falta la restricción de solapamiento';
         end if;
         if (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O'
           and tgname in ('audit_room', 'audit_booking', 'check_booking_policy')
           and tgrelid in ('reservas.rooms'::regclass, 'reservas.bookings'::regclass)) <> 3 then
           raise exception 'Faltan reglas o auditoría';
         end if;
       end $$;`,
    ])
  } finally {
    closeSync(fd)
    if (created && action === 'verify') {
      shell('[ "$1" != "$POSTGRES_DB" ]; dropdb -h 127.0.0.1 -U "$POSTGRES_USER" -- "$1"', [name])
    }
  }
}

try {
  if (action === 'create' && !destination) {
    mkdirSync(dirname(archive), { recursive: true })
    const temp = `${archive}.${randomBytes(6).toString('hex')}.partial`
    if (existsSync(archive)) throw new Error('La copia de destino ya existe.')
    const fd = openSync(temp, 'wx', 0o600)
    try {
      try {
        shell('pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges', [], ['ignore', fd, 'inherit'])
      } finally {
        closeSync(fd)
      }
      // A filename explicitly supplied by the owner must not replace another copy.
      linkSync(temp, archive)
      unlinkSync(temp)
      console.log(`Copia guardada: ${archive}`)
    } catch (error) {
      if (existsSync(temp)) unlinkSync(temp)
      throw error
    }
  } else if (action === 'verify' && filename && !destination) {
    restoreInto(verification)
    console.log('Copia verificada mediante una restauración temporal. La base original no cambió.')
  } else if (action === 'restore' && filename && destination) {
    validateDatabaseName(destination)
    restoreInto(destination)
    console.log(`Copia restaurada en ${destination}. La base original sigue activa y no cambió.`)
  } else {
    throw new Error('Uso: db:backup [archivo] | db:backup:verify archivo | db:restore archivo reserva_restaurada_nombre')
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
