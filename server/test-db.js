// A real SQLite database behind the parts of the D1 API this server uses, with every migration
// applied in order. Plain JavaScript on purpose: the project carries no Node typings, because the
// functions are type-checked against the Workers runtime instead.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))

/** Resolves to null on a Node without built-in SQLite, so that tests can skip instead of failing */
export async function testDatabase() {
  // Loading the module prints an "experimental feature" notice, which would otherwise show up in every test run
  const emitWarning = process.emitWarning
  process.emitWarning = () => {}
  const sqlite = await import('node:sqlite').catch(() => null)
  process.emitWarning = emitWarning
  if (!sqlite) return null
  const db = new sqlite.DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(MIGRATIONS + file, 'utf8'))
  }

  const prepare = (sql) => {
    let bindings = []
    const reads = /^\s*(SELECT|WITH)\b/i.test(sql)
    const statement = {
      bind(...values) {
        bindings = values
        return statement
      },
      /** What D1 reports for one statement, on its own or inside a batch */
      execute() {
        const prepared = db.prepare(sql)
        if (reads) return { success: true, results: prepared.all(...bindings).map((row) => ({ ...row })), meta: {} }
        const { lastInsertRowid, changes } = prepared.run(...bindings)
        return { success: true, results: [], meta: { last_row_id: Number(lastInsertRowid), changes: Number(changes) } }
      },
      run: async () => statement.execute(),
      all: async () => statement.execute(),
      first: async () => {
        const row = db.prepare(sql).get(...bindings)
        return row ? { ...row } : null
      },
    }
    return statement
  }

  return {
    prepare,
    // D1 runs a batch as one transaction
    async batch(statements) {
      db.exec('BEGIN')
      try {
        const results = statements.map((statement) => statement.execute())
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}
