import { describe, expect, it } from 'vitest'
import { GripPointerSensor, LongPressPointerSensor } from './BoardView'

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

  it('accepts regular card elements and links for long press', () => {
    const fakeCard = {
      closest: () => null,
    } as unknown as Element

    expect(
      handler({
        nativeEvent: { isPrimary: true, button: 0, target: fakeCard },
      } as any),
    ).toBe(true)
  })
})
