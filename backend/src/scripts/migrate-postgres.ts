import { closeDatabaseConnection } from '../db/index.js'
import { runDatabaseMigrations } from '../db/migrate.js'

try {
  await runDatabaseMigrations()
  console.log('PostgreSQL migrations completed')
} finally {
  await closeDatabaseConnection()
}
