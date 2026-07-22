import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import path from 'path'
import { fileURLToPath } from 'url'

import dramas from './routes/dramas.js'
import episodes from './routes/episodes.js'
import storyboards from './routes/storyboards.js'
import scenes from './routes/scenes.js'
import characters from './routes/characters.js'
import images from './routes/images.js'
import videos from './routes/videos.js'
import upload from './routes/upload.js'
import aiConfigs, { aiProviders } from './routes/aiConfigs.js'
import agentConfigs from './routes/agentConfigs.js'
import agent from './routes/agent.js'
import compose from './routes/compose.js'
import merge from './routes/merge.js'
import grid from './routes/grid.js'
import skills from './routes/skills.js'
import webhooks from './routes/webhooks.js'
import aiVoices from './routes/aiVoices.js'
import queues from './routes/queues.js'
import auth from './routes/auth.js'
import { requestLogger, errorHandler } from './middleware/logger.js'
import { checkDatabaseConnection, closeDatabaseConnection } from './db/index.js'
import { runDatabaseMigrations } from './db/migrate.js'
import { closeQueues, getImageQueue, getMediaQueue, getVideoQueue } from './queue/queues.js'
import { requireAdminMiddleware, requireAuth } from './auth/access.js'

await runDatabaseMigrations()
await checkDatabaseConnection()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const app = new Hono()

// Middleware
app.use('*', cors({
  origin: ['http://localhost:3013', 'http://localhost:5679'],
  credentials: true,
}))
app.use('*', requestLogger)
app.use('*', errorHandler)

// Health check
app.get('/api/v1/health', async (c) => {
  try {
    await checkDatabaseConnection()
    await Promise.all([
      getImageQueue().waitUntilReady(),
      getVideoQueue().waitUntilReady(),
      getMediaQueue().waitUntilReady(),
    ])
    return c.json({ status: 'ok', database: 'ok', redis: 'ok', timestamp: new Date().toISOString() })
  } catch (err: any) {
    return c.json({ status: 'error', message: err.message, timestamp: new Date().toISOString() }, 503)
  }
})

// API routes
const api = new Hono()
api.route('/auth', auth)
api.use('*', requireAuth)
api.use('/agent-configs', requireAdminMiddleware)
api.use('/agent-configs/*', requireAdminMiddleware)
api.use('/skills', requireAdminMiddleware)
api.use('/skills/*', requireAdminMiddleware)
api.use('/ai-voices/sync', requireAdminMiddleware)
api.route('/dramas', dramas)
api.route('/episodes', episodes)
api.route('/storyboards', storyboards)
api.route('/scenes', scenes)
api.route('/characters', characters)
api.route('/images', images)
api.route('/videos', videos)
api.route('/upload', upload)
api.route('/ai-configs', aiConfigs)
api.route('/ai-providers', aiProviders)
api.route('/agent-configs', agentConfigs)
api.route('/agent', agent)
api.route('/compose', compose)
api.route('/merge', merge)
api.route('/grid', grid)
api.route('/skills', skills)
api.route('/ai-voices', aiVoices)
api.route('/queues', queues)

app.route('/api/v1', api)

// Webhook callbacks (Vidu, etc.) - outside /api/v1
app.route('/webhooks', webhooks)

// Serve static files (storage)
app.use('/static/*', serveStatic({ root: path.join(projectRoot, 'data') }))

// Serve frontend (production build)
const distPath = path.join(projectRoot, 'frontend', 'dist')
app.use('*', serveStatic({ root: distPath }))
app.get('*', serveStatic({ root: distPath, path: 'index.html' }))

const port = Number(process.env.PORT || 5679)
console.log(`🚀 Huobao Drama TS server on http://localhost:${port}`)
const server = serve({ fetch: app.fetch, port })

async function shutdown(signal: string) {
  console.log(`API received ${signal}, shutting down...`)
  server.close()
  await closeQueues()
  await closeDatabaseConnection()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
