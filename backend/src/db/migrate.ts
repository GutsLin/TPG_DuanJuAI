import path from 'path'
import { fileURLToPath } from 'url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db } from './index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsFolder = path.resolve(__dirname, '../../drizzle')

export async function runDatabaseMigrations() {
  await migrate(db, { migrationsFolder })
}
