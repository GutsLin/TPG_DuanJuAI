import IORedis from 'ioredis'

export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

export function createRedisConnection() {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
}
