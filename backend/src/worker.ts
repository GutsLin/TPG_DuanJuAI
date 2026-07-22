import { checkDatabaseConnection, closeDatabaseConnection } from './db/index.js'
import { runDatabaseMigrations } from './db/migrate.js'
import { startQueueWorkers } from './queue/workers.js'

await runDatabaseMigrations()
await checkDatabaseConnection()

const workers = startQueueWorkers()
console.log(`Huobao BullMQ worker started (${workers.length} queues)`)

async function shutdown(signal: string) {
  console.log(`Worker received ${signal}, shutting down...`)
  await Promise.all(workers.map(worker => worker.close()))
  await closeDatabaseConnection()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
