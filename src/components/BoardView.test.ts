import { describe, expect, it } from 'vitest'
import { collisionDetection, GripPointerSensor, LongPressPointerSensor } from './BoardView'

describe('GripPointerSensor activators', () => {
  const handler = GripPointerSensor.activators[0].handler

  it('rejects secondary buttons and right click', () => {
    const fakeHandle = {
      closest: (sel: string) => (sel === '[data-drag-handle]' ? fakeHandle : null),
    } as unknown as Element

    expect(
      handler({
        nativeEvent: { isPrimary: true, button: 2, target: fakeHandle },
      } as any),
    ).toBe(false)

    expect(
      handler({
        nativeEvent: { isPrimary: false, button: 0, target: fakeHandle },
      } as any),
    ).toBe(false)
  })

  it('accepts touch input on a drag handle', () => {
    const fakeHandle = {
      closest: (sel: string) => (sel === '[data-drag-handle]' ? fakeHandle : null),
    } as unknown as Element

    expect(handler({ nativeEvent: { isPrimary: true, button: 0, pointerType: 'touch', target: fakeHandle } } as any)).toBe(true)
  })

  it('accepts elements matching data-drag-handle', () => {
    const fakeHandle = {
      closest: (sel: string) => (sel === '[data-drag-handle]' ? fakeHandle : null),
    } as unknown as Element

    expect(
      handler({
        nativeEvent: { isPrimary: true, button: 0, target: fakeHandle },
      } as any),
    ).toBe(true)
  })

  it('rejects card body elements without data-drag-handle', () => {
    const fakeCard = {
      closest: () => null,
    } as unknown as Element

    expect(
      handler({
        nativeEvent: { isPrimary: true, button: 0, target: fakeCard },
      } as any),
    ).toBe(false)
  })
})

describe('LongPressPointerSensor activators', () => {
  const handler = LongPressPointerSensor.activators[0].handler

  it('rejects secondary buttons and right click', () => {
    const fakeCard = {
      closest: () => null,
    } as unknown as Element

    expect(
      handler({
        nativeEvent: { isPrimary: true, button: 2, target: fakeCard },
      } as any),
    ).toBe(false)
  })

  it('rejects touch input on a card body', () => {
    const fakeCard = {
      closest: () => null,
    } as unknown as Element

    expect(handler({ nativeEvent: { isPrimary: true, button: 0, pointerType: 'touch', target: fakeCard } } as any)).toBe(false)
  })

  it('rejects drag handles (handled by GripPointerSensor)', () => {
    const fakeHandle = {
      closest: (sel: string) => (sel === '[data-drag-handle]' ? fakeHandle : null),
    } as unknown as Element

    expect(
      handler({
        nativeEvent: { isPrimary: true, button: 0, target: fakeHandle },
      } as any),
    ).toBe(false)
  })

  it('rejects action buttons and open popovers', () => {
    const fakeButton = {
      closest: (sel: string) => (sel.includes('button') ? fakeButton : null),
    } as unknown as Element

    expect(
      handler({
        nativeEvent: { isPrimary: true, button: 0, target: fakeButton },
      } as any),
    ).toBe(false)

    const fakeDropdown = {
      closest: (sel: string) => (sel.includes('[data-open]') ? fakeDropdown : null),
    } as unknown as Element

    expect(
      handler({
        nativeEvent: { isPrimary: true, button: 0, target: fakeDropdown },
      } as any),
    ).toBe(false)
  })

  it('accepts mouse input on regular card elements and links for long press', () => {
    const fakeCard = {
      closest: () => null,
    } as unknown as Element

    expect(
      handler({
        nativeEvent: { isPrimary: true, button: 0, pointerType: 'mouse', target: fakeCard },
      } as any),
    ).toBe(true)
  })
})

describe('collisionDetection for groups', () => {
  const rect = (top: number) => ({ top, left: 0, width: 100, height: 40, bottom: top + 40, right: 100 })
  const container = (id: string, top: number, pinned?: boolean) => ({ id, data: { current: { pinned } }, rect: { current: rect(top) }, disabled: false })
  // Two pinned groups on top, two unpinned below, and a card that must never be a group target
  const containers = [container('g-1', 0, true), container('g-2', 50, true), container('g-3', 100, false), container('g-4', 150, false), container('s-9', 100)]
  const over = (id: string, pinned: boolean, top: number) =>
    collisionDetection({
      active: { id, data: { current: { pinned } }, rect: { current: { initial: null, translated: null } } },
      collisionRect: rect(top),
      droppableRects: new Map(containers.map((c) => [c.id, c.rect.current])),
      droppableContainers: containers,
      pointerCoordinates: null,
    } as any)[0]?.id

  it('keeps a pinned group among the pinned ones when dragged below them', () => {
    expect(over('g-1', true, 150)).toBe('g-2')
  })

  it('keeps an unpinned group out of the pinned ones when dragged above them', () => {
    expect(over('g-4', false, 0)).toBe('g-3')
  })

  it('still sorts inside a segment', () => {
    expect(over('g-2', true, 0)).toBe('g-1')
    expect(over('g-3', false, 150)).toBe('g-4')
  })
})
