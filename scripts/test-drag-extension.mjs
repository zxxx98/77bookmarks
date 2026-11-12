import { chromium, expect } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const extensionPath = resolve('dist-extension')
const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), '77-drag-')), {
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
  viewport: { width: 1440, height: 1000 },
  args: [`--load-extension=${extensionPath}`, `--disable-extensions-except=${extensionPath}`, '--no-sandbox'],
})

try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    window.dropAnimations = []
    window.dropFrames = []
    window.dropFinished = false
    window.addEventListener('pointerup', () => {
      if (!window.trackDrop) return
      window.trackDrop = false
      const until = performance.now() + 400
      const sample = () => {
        window.dropFrames.push([...document.querySelectorAll('main .card-surface a[href]')].map((link) => link.getAttribute('href')))
        if (performance.now() < until) requestAnimationFrame(sample)
        else window.dropFinished = true
      }
      requestAnimationFrame(sample)
    })
    const animate = Element.prototype.animate
    Element.prototype.animate = function (keyframes, options) {
      if (this.querySelector('.card-lifted') && Array.isArray(keyframes)) {
        const start = new DOMMatrix(keyframes[0].transform)
        const end = new DOMMatrix(keyframes.at(-1).transform)
        // Cards scale up inside the overlay. Measure the visible card, as dnd-kit does.
        const rect = this.querySelector('.card-lifted').getBoundingClientRect()
        window.dropAnimations.push({
          from: { x: rect.left, y: rect.top },
          to: { x: rect.left + end.m41 - start.m41, y: rect.top + end.m42 - start.m42 },
          order: [...document.querySelectorAll('main .card-surface a[href]')].map((link) => link.getAttribute('href')),
        })
      }
      return animate.call(this, keyframes, options)
    }
  })
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`)
  const rpc = (method, ...args) => page.evaluate(async ({ method, args }) => {
    const result = await chrome.runtime.sendMessage({ type: '77bookmarks:data', method, args })
    if (!result?.ok) throw new Error(result?.error)
    return result.value
  }, { method, args })
  const initial = await rpc('board')
  const desktopId = initial.desktop.id
  await rpc('updateSettings', { siteName: 'Drag test', openInNewTab: true, layoutColumns: 1 })
  await rpc('updateDesktop', desktopId, { view: 'list' })
  for (const host of ['one.test', 'two.test', 'three.test']) await rpc('addBookmark', `https://${host}`, desktopId)
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const card = (host) => page.locator('div.relative.select-none').filter({ has: page.locator(`a[href="https://${host}"]`) }).first()
  const source = card('one.test')
  const beginDrag = async (handle, destination) => {
    await page.bringToFront()
    const start = await handle.boundingBox()
    const finish = await destination.boundingBox()
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 8, { steps: 3 })
    await page.mouse.move(finish.x + finish.width / 2, finish.y + finish.height / 2, { steps: 20 })
  }
  const prepareDrop = () => page.evaluate(() => {
    window.dropAnimations = []
    window.dropFrames = []
    window.dropFinished = false
    window.trackDrop = true
  })
  const assertDrop = async (host, order) => {
    await expect(page.locator('.card-lifted')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.dropFinished)).toBe(true)
    const settled = await card(host).boundingBox()
    const { animations, frames } = await page.evaluate(() => ({ animations: window.dropAnimations, frames: window.dropFrames }))
    expect(frames.length).toBeGreaterThan(0)
    for (const frame of frames) expect(frame, 'every rendered frame after drop must keep the new order').toEqual(order)
    for (const animation of animations) {
      expect(Math.abs(animation.to.x - settled.x), 'drop animation must land at the saved horizontal position').toBeLessThan(3)
      expect(Math.abs(animation.to.y - settled.y), 'drop animation must land at the saved vertical position').toBeLessThan(3)
      expect(animation.order, 'the animation must measure the committed layout').toEqual(order)
    }
  }
  await expect(source.getByRole('button', { name: '拖动排序', exact: true })).toBeVisible()
  await expect(source.locator('.animate-rise')).toHaveCSS('opacity', '1')
  await beginDrag(source.getByRole('button', { name: '拖动排序', exact: true }), card('three.test'))
  await prepareDrop()
  await page.mouse.up()
  const listOrder = ['https://two.test', 'https://three.test', 'https://one.test']
  await expect.poll(async () => (await rpc('board')).desktop.groups[0].sites.map((site) => site.origin)).toEqual(listOrder)
  await assertDrop('one.test', listOrder)
  console.log('✓ List drop lands at the committed position without a frame of the old order')

  await rpc('updateDesktop', desktopId, { view: 'large' })
  await expect(page.getByRole('radio', { name: '大卡片', exact: true })).toHaveAttribute('aria-checked', 'true')
  await beginDrag(source.getByRole('button', { name: '拖动排序', exact: true }), card('two.test'))
  await prepareDrop()
  await page.mouse.up()
  const largeOrder = ['https://one.test', 'https://two.test', 'https://three.test']
  await expect.poll(async () => (await rpc('board')).desktop.groups[0].sites.map((site) => site.origin)).toEqual(largeOrder)
  await assertDrop('one.test', largeOrder)
  console.log('✓ Large-card drop animation lands at the new position')

  await rpc('updateDesktop', desktopId, { view: 'small' })
  await expect(page.getByRole('radio', { name: '小卡片', exact: true })).toHaveAttribute('aria-checked', 'true')
  await beginDrag(source.getByRole('button', { name: '拖动排序', exact: true }), card('three.test'))
  await prepareDrop()
  await page.mouse.up()
  const smallOrder = ['https://two.test', 'https://three.test', 'https://one.test']
  await expect.poll(async () => (await rpc('board')).desktop.groups[0].sites.map((site) => site.origin)).toEqual(smallOrder)
  await assertDrop('one.test', smallOrder)
  console.log('✓ Small-card drop animation lands at the new position')

  await rpc('updateDesktop', desktopId, { view: 'list' })
  await expect(page.getByRole('radio', { name: '列表', exact: true })).toHaveAttribute('aria-checked', 'true')
  await rpc('createGroup', desktopId, '目标分组')
  const targetGroup = page.locator('section').filter({ has: page.getByRole('heading', { name: '目标分组', exact: true }) })
  await expect(targetGroup).toBeVisible()
  await beginDrag(source.getByRole('button', { name: '拖动排序', exact: true }), targetGroup.getByText('把卡片拖到这里，或点击右上角「添加」', { exact: true }))
  await expect(targetGroup.locator('a[href="https://one.test"]')).toBeVisible()
  await prepareDrop()
  await page.mouse.up()
  await expect.poll(async () => (await rpc('board')).desktop.groups.find((group) => group.name === '目标分组').sites.map((site) => site.origin)).toEqual(['https://one.test'])
  await assertDrop('one.test', smallOrder)
  console.log('✓ Cross-group drop lands in the destination group')

  const originalGroup = page.locator('section').filter({ has: page.getByRole('heading', { name: '默认', exact: true }) })
  const beforeCancel = (await rpc('board')).desktop.groups
  await beginDrag(source.getByRole('button', { name: '拖动排序', exact: true }), originalGroup)
  await expect(page.locator('.card-lifted')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.locator('.card-lifted')).toHaveCount(0)
  await expect(targetGroup.locator('a[href="https://one.test"]')).toBeVisible()
  expect((await rpc('board')).desktop.groups).toEqual(beforeCancel)
  console.log('✓ Escape cancels the preview without saving it')

  // Escape also exits the app's layout editing mode.
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  const groupSource = await originalGroup.boundingBox()
  const groupTarget = await targetGroup.boundingBox()
  const groupHandle = await originalGroup.getByRole('button', { name: '拖动分组排序' }).boundingBox()
  await page.mouse.move(groupHandle.x + groupHandle.width / 2, groupHandle.y + groupHandle.height / 2)
  await page.mouse.down()
  await page.mouse.move(groupHandle.x + groupHandle.width / 2, groupHandle.y + groupHandle.height / 2 + 8, { steps: 3 })
  await page.mouse.move(groupHandle.x + groupHandle.width / 2, groupHandle.y + groupHandle.height / 2 + groupTarget.y - groupSource.y, { steps: 20 })
  await prepareDrop()
  await page.mouse.up()
  await expect.poll(async () => (await rpc('board')).desktop.groups.map((group) => group.name)).toEqual(['目标分组', '默认'])
  await assertDrop('one.test', ['https://one.test', 'https://two.test', 'https://three.test'])
  console.log('✓ Group sorting keeps the committed layout after release')
  await page.reload()
  await expect(targetGroup.locator('a[href="https://one.test"]')).toBeVisible()
  expect((await rpc('board')).desktop.groups.map((group) => group.name)).toEqual(['目标分组', '默认'])
  expect(errors).toEqual([])
  console.log('All drag regression checks passed.')
} finally {
  await context.close()
}
