import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema.js'

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://huobao:huobao@localhost:5432/huobao_drama'
const DATABASE_POOL_SIZE = Number(process.env.DATABASE_POOL_SIZE || 20)

export const sql = postgres(DATABASE_URL, {
  max: DATABASE_POOL_SIZE,
  idle_timeout: Number(process.env.DATABASE_IDLE_TIMEOUT || 20),
  connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT || 10),
  prepare: false,
})

export const db = drizzle(sql, { schema })
export { schema }
export type DB = typeof db

export async function checkDatabaseConnection() {
  await sql`select 1`
}

export async function closeDatabaseConnection() {
  await sql.end({ timeout: 5 })
}
