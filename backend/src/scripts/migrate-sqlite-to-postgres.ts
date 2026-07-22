import Database from 'better-sqlite3'
import path from 'path'
import postgres from 'postgres'

const sqlitePath = path.resolve(process.env.SQLITE_DB_PATH || process.env.DB_PATH || '../data/huobao_drama.db')
const databaseUrl = process.env.DATABASE_URL || 'postgres://huobao:huobao@localhost:5432/huobao_drama'
const truncateFirst = process.env.MIGRATION_TRUNCATE === 'true'

const tables = [
  'dramas',
  'episodes',
  'characters',
  'episode_characters',
  'scenes',
  'episode_scenes',
  'storyboards',
  'storyboard_characters',
  'ai_service_configs',
  'ai_service_providers',
  'ai_voices',
  'agent_configs',
  'image_generations',
  'video_generations',
  'video_merges',
  'props',
  'assets',
] as const

const booleanColumns: Record<string, string[]> = {
  ai_service_configs: ['is_default', 'is_active'],
  ai_service_providers: ['is_active'],
  agent_configs: ['is_active'],
  assets: ['is_favorite'],
}

const sqlite = new Database(sqlitePath, { readonly: true })
const pg = postgres(databaseUrl, { max: 1, prepare: false })

try {
  if (truncateFirst) {
    const identifiers = tables.map(table => `"${table}"`).join(', ')
    await pg.unsafe(`truncate table ${identifiers} restart identity cascade`)
  }

  for (const table of tables) {
    const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
    if (!exists) {
      console.log(`[skip] ${table}: table not found in SQLite`)
      continue
    }

    const sourceRows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]
    if (!sourceRows.length) {
      console.log(`[skip] ${table}: 0 rows`)
      continue
    }

    const booleans = new Set(booleanColumns[table] || [])
    const rows = sourceRows.map(row => Object.fromEntries(
      Object.entries(row).map(([column, value]) => [
        column,
        booleans.has(column) && value != null ? Boolean(value) : value,
      ]),
    ))
    const columns = Object.keys(rows[0])

    for (let offset = 0; offset < rows.length; offset += 200) {
      const chunk = rows.slice(offset, offset + 200)
      await pg`insert into ${pg(table)} ${pg(chunk, ...columns)} on conflict do nothing`
    }

    if (columns.includes('id')) {
      const [result] = await pg`select max(id)::int as max_id from ${pg(table)}`
      const maxId = result?.max_id as number | null
      if (maxId != null) {
        await pg`select setval(pg_get_serial_sequence(${table}, 'id'), ${maxId}, true)`
      }
    }

    console.log(`[done] ${table}: ${rows.length} rows`)
  }
} finally {
  sqlite.close()
  await pg.end({ timeout: 5 })
}
