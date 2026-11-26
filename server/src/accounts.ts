import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { and, asc, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { createDatabase } from './db.js'
import { audit, users } from './schema.js'

type Db = ReturnType<typeof createDatabase>['db']
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) =>
  scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key)))
const dummySalt = randomBytes(16)
const dummyKey = randomBytes(64)
export const passwordSchema = z.string().min(12).max(256)
export const accountSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: passwordSchema,
})

type AccountInput = z.infer<typeof accountSchema>
export type Account = Pick<typeof users.$inferSelect, 'id' | 'username' | 'email' | 'role' | 'active' | 'sessionVersion'>
export type AccountStore = {
  authenticate(identifier: string, password: string): Promise<Account | null>
  get(id: string): Promise<Account | null>
  list(): Promise<Account[]>
  create(input: AccountInput): Promise<boolean>
  setActive(id: string, active: boolean): Promise<boolean>
  changePassword(account: Account, current: string, next: string): Promise<boolean>
  resetMemberPassword(actor: Account, id: string, password: string): Promise<boolean>
}

const publicFields = {
  id: users.id, username: users.username, email: users.email, role: users.role,
  active: users.active, sessionVersion: users.sessionVersion,
}

async function makeHash(password: string) {
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `${salt.toString('hex')}:${key.toString('hex')}`
}

async function matches(password: string, hash?: string) {
  const [salt, key] = hash?.split(':') ?? []
  const expected = key ? Buffer.from(key, 'hex') : dummyKey
  const actual = await derive(password, salt ? Buffer.from(salt, 'hex') : dummySalt)
  return Boolean(hash) && expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function bootstrapAdmin(db: Db, input: AccountInput) {
  const passwordHash = await makeHash(input.password)
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table reservas.users in exclusive mode`)
    const [existing] = await tx.select({ id: users.id }).from(users).limit(1)
    if (existing) return false
    await tx.insert(users).values({ username: input.username, email: input.email, passwordHash, role: 'admin' })
    return true
  })
}

async function resetPassword(
  db: Db, role: Account['role'], match: ReturnType<typeof eq>, password: string, actor?: Account,
) {
  const passwordHash = await makeHash(password)
  return db.transaction(async (tx) => {
    if (actor) {
      const [admin] = await tx.select({ id: users.id }).from(users).where(and(
        eq(users.id, actor.id), eq(users.role, 'admin'), eq(users.active, true),
        eq(users.sessionVersion, actor.sessionVersion),
      )).for('share')
      if (!admin) return false
    }
    const [account] = await tx.update(users).set({
      passwordHash, sessionVersion: sql`${users.sessionVersion} + 1`,
    }).where(and(match, eq(users.role, role))).returning({ id: users.id })
    if (!account) return false
    await tx.insert(audit).values({
      entity: 'users', entityId: account.id, action: 'password_reset',
      after: { source: actor ? 'admin_panel' : 'local_recovery', ...(actor ? { actorId: actor.id } : {}) },
    })
    return true
  })
}

export function recoverLocalAdmin(db: Db, identifier: string, password: string) {
  const normalized = identifier.trim().toLowerCase()
  const match = normalized.includes('@') ? eq(users.email, normalized) : eq(users.username, normalized)
  return resetPassword(db, 'admin', match, password)
}

export function createAccountStore(db: Db): AccountStore {
  return {
    async resetMemberPassword(actor, id, password) {
      if (actor.role !== 'admin' || !actor.active) return false
      return resetPassword(db, 'member', eq(users.id, id), password, actor)
    },
    async authenticate(identifier, password) {
      const normalized = identifier.trim().toLowerCase()
      const [result] = await db.select({ ...publicFields, passwordHash: users.passwordHash }).from(users)
        .where(or(eq(users.username, normalized), eq(users.email, normalized)))
      const valid = await matches(password, result?.passwordHash)
      if (!result?.active || !valid) return null
      return {
        id: result.id, username: result.username, email: result.email, role: result.role,
        active: result.active, sessionVersion: result.sessionVersion,
      }
    },
    async get(id) {
      const [account] = await db.select(publicFields).from(users).where(eq(users.id, id))
      return account ?? null
    },
    list: () => db.select(publicFields).from(users).orderBy(asc(users.username)),
    async create({ username, email, password }) {
      const [account] = await db.insert(users).values({ username, email, passwordHash: await makeHash(password) })
        .onConflictDoNothing().returning({ id: users.id })
      return Boolean(account)
    },
    async setActive(id, active) {
      const [account] = await db.update(users).set({ active, sessionVersion: sql`${users.sessionVersion} + 1` })
        .where(and(eq(users.id, id), eq(users.role, 'member'))).returning({ id: users.id })
      return Boolean(account)
    },
    async changePassword(account, current, next) {
      const [row] = await db.select({ hash: users.passwordHash }).from(users)
        .where(and(eq(users.id, account.id), eq(users.active, true), eq(users.sessionVersion, account.sessionVersion)))
      if (!row || !await matches(current, row.hash)) return false
      const [result] = await db.update(users).set({
        passwordHash: await makeHash(next), sessionVersion: sql`${users.sessionVersion} + 1`,
      }).where(and(eq(users.id, account.id), eq(users.active, true), eq(users.passwordHash, row.hash))).returning({ id: users.id })
      return Boolean(result)
    },
  }
}
