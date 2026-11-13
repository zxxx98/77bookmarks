// @vitest-environment node
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateService } from './update'

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, rename: vi.fn(fs.rename) }
})

const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
let appDir: string

beforeEach(async () => {
  vi.mocked(rename).mockImplementation(realFs.rename)
  appDir = await mkdtemp(join(tmpdir(), '77bookmarks-update-test-'))
  await mkdir(join(appDir, 'public', 'assets'), { recursive: true })
  await writeFile(join(appDir, 'server.mjs'), 'old-server')
  await writeFile(join(appDir, 'public', 'index.html'), 'old-html')
  await writeFile(join(appDir, 'public', 'assets', 'old.js'), 'old-asset')
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(appDir, { recursive: true, force: true })
})

async function checkedUpdater() {
  const onRestart = vi.fn()
  const service = new UpdateService({
    currentVersion: '2.2.2',
    appDir,
    onRestart,
    fetchFn: vi.fn(async (url) => String(url).includes('api.github.com')
      ? Response.json({
        tag_name: 'v2.2.3',
        assets: [{ name: '77bookmarks-selfhost-v2.2.3.tar.gz', browser_download_url: 'https://downloads.example/update.tar.gz' }],
      })
      : new Response('archive')),
    extractFn: async (_archive, destDir) => {
      await mkdir(join(destDir, 'public', 'assets'), { recursive: true })
      await writeFile(join(destDir, 'server.mjs'), 'new-server')
      await writeFile(join(destDir, 'public', 'index.html'), 'new-html')
      await writeFile(join(destDir, 'public', 'assets', 'new.js'), 'new-asset')
    },
  })
  expect(await service.check()).toMatchObject({ hasUpdate: true, canTriggerUpdate: true })
  return { service, onRestart }
}

function simulateOverlayFs() {
  vi.mocked(rename).mockImplementation(async (source, destination) => {
    if (source === join(appDir, 'public')) {
      throw Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' })
    }
    await realFs.rename(source, destination)
  })
}

describe('updates on Docker OverlayFS', () => {
  it('applies an update when the image-layer public directory cannot be renamed', async () => {
    simulateOverlayFs()
    const { service, onRestart } = await checkedUpdater()
    vi.useFakeTimers()

    expect(await service.apply()).toMatchObject({ triggered: true })
    expect(await readFile(join(appDir, 'server.mjs'), 'utf8')).toBe('new-server')
    expect(await readFile(join(appDir, 'public', 'index.html'), 'utf8')).toBe('new-html')
    expect(await readFile(join(appDir, 'public', 'assets', 'new.js'), 'utf8')).toBe('new-asset')
    await expect(stat(join(appDir, 'public', 'assets', 'old.js'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(appDir, 'public.old'))).rejects.toMatchObject({ code: 'ENOENT' })
    await vi.runAllTimersAsync()
    expect(onRestart).toHaveBeenCalledTimes(1)
  })

  it.each(['public', 'server.mjs'])('restores the old app if replacing %s fails after the EXDEV fallback', async (target) => {
    // Only fail the install; allow the backup directory to be restored afterwards.
    simulateOverlayFs()
    const overlayRename = vi.mocked(rename).getMockImplementation()!
    vi.mocked(rename).mockImplementation(async (source, destination) => {
      if (source === join(appDir, target === 'public' ? 'public.new' : 'server.mjs.new')) {
        throw new Error('replacement failed')
      }
      return overlayRename(source, destination)
    })
    const { service, onRestart } = await checkedUpdater()

    await expect(service.apply()).rejects.toThrow('replacement failed')
    expect(await readFile(join(appDir, 'server.mjs'), 'utf8')).toBe('old-server')
    expect(await readFile(join(appDir, 'public', 'index.html'), 'utf8')).toBe('old-html')
    expect(await readFile(join(appDir, 'public', 'assets', 'old.js'), 'utf8')).toBe('old-asset')
    await expect(stat(join(appDir, 'public', 'assets', 'new.js'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(appDir, 'public.new'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(appDir, 'server.mjs.new'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(onRestart).not.toHaveBeenCalled()
  })

  it('keeps the current app intact when the initial rename fails for another reason', async () => {
    vi.mocked(rename).mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
    const { service, onRestart } = await checkedUpdater()

    await expect(service.apply()).rejects.toThrow('permission denied')
    expect(await readFile(join(appDir, 'server.mjs'), 'utf8')).toBe('old-server')
    expect(await readFile(join(appDir, 'public', 'index.html'), 'utf8')).toBe('old-html')
    await expect(stat(join(appDir, 'public.old'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(onRestart).not.toHaveBeenCalled()
  })
})
