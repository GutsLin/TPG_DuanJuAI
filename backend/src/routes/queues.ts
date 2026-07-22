import { Hono } from 'hono'
import { getImageQueue, getMediaQueue, getVideoQueue } from '../queue/queues.js'
import { success } from '../utils/response.js'

const app = new Hono()

app.get('/status', async c => {
  const entries = [
    ['images', getImageQueue()],
    ['videos', getVideoQueue()],
    ['media', getMediaQueue()],
  ] as const

  const statuses = await Promise.all(entries.map(async ([name, queue]) => ({
    name,
    queue: queue.name,
    counts: await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
  })))

  return success(c, statuses)
})

export default app
