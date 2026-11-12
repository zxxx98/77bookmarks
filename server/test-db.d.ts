/**
 * A real in-memory SQLite database with every migration applied, behind the parts of the D1 API
 * the server uses. Resolves to null on a Node without built-in SQLite.
 */
export function testDatabase(): Promise<D1Database | null>
