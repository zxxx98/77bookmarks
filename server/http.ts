export interface Env {
  DB: D1Database
  ADMIN_PASSWORD: string
  SESSION_SECRET: string
}

export type Fn = PagesFunction<Env>

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers })
}

export function fail(status: number, message: string): Response {
  return json({ error: message }, status)
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function idParam(value: string | string[] | undefined): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** Trimmed non-empty string capped at `max` chars, or null */
export function text(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

export function isIdList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => Number.isInteger(v) && v > 0)
}
