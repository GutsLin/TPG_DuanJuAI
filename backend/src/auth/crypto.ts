import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac } from 'crypto'
import { promisify } from 'util'

const scrypt = promisify(scryptCallback)
const PASSWORD_KEY_LENGTH = 64
const JWT_SECRET = process.env.AUTH_JWT_SECRET || 'dev-change-me'
const JWT_EXPIRES_IN_SECONDS = Number(process.env.AUTH_JWT_EXPIRES_IN_SECONDS || 60 * 60 * 24 * 7)

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url')
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url')
  const hash = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer
  return `scrypt$${salt}$${hash.toString('base64url')}`
}

export async function verifyPassword(password: string, storedHash: string) {
  const [scheme, salt, hash] = storedHash.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false

  const expected = Buffer.from(hash, 'base64url')
  const actual = (await scrypt(password, salt, expected.length)) as Buffer
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function signToken(payload: Record<string, unknown>) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const body = { ...payload, iat: now, exp: now + JWT_EXPIRES_IN_SECONDS }
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(body))}`
  const signature = createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}

export function verifyToken(token: string) {
  const [header, payload, signature] = token.split('.')
  if (!header || !payload || !signature) return null

  const unsigned = `${header}.${payload}`
  const expected = createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url')
  const expectedBuffer = Buffer.from(expected)
  const signatureBuffer = Buffer.from(signature)
  if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) return null

  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (typeof data.exp === 'number' && data.exp < Math.floor(Date.now() / 1000)) return null
  return data as Record<string, unknown>
}
