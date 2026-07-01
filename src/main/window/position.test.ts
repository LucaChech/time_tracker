import { describe, expect, it } from 'vitest'
import { computeFlyoutPosition, inferTaskbarEdge, type Rect, type Size } from './position'

// A 1920×1080 primary display at the origin; each case reshapes the work area to
// simulate the taskbar on a different edge. The flyout is the real Stage-4 size.
const DISPLAY: Rect = { x: 0, y: 0, width: 1920, height: 1080 }
const WIN: Size = { width: 408, height: 560 }
const TB = 48 // taskbar thickness

describe('inferTaskbarEdge', () => {
  it('detects each edge from the reclaimed work-area gap', () => {
    expect(inferTaskbarEdge({ x: 0, y: 0, width: 1920, height: 1032 }, DISPLAY)).toBe('bottom')
    expect(inferTaskbarEdge({ x: 0, y: 48, width: 1920, height: 1032 }, DISPLAY)).toBe('top')
    expect(inferTaskbarEdge({ x: 48, y: 0, width: 1872, height: 1080 }, DISPLAY)).toBe('left')
    expect(inferTaskbarEdge({ x: 0, y: 0, width: 1872, height: 1080 }, DISPLAY)).toBe('right')
  })

  it('defaults to bottom when nothing is reclaimed (fullscreen / no taskbar)', () => {
    expect(inferTaskbarEdge(DISPLAY, DISPLAY)).toBe('bottom')
  })
})

describe('computeFlyoutPosition', () => {
  it('bottom taskbar: sits above it, right-clamped near the tray', () => {
    const work: Rect = { x: 0, y: 0, width: 1920, height: 1080 - TB } // 1032 tall
    const tray: Rect = { x: 1850, y: 1040, width: 24, height: 24 }
    // y pins the flyout bottom to the work-area bottom; x centres on the tray but
    // clamps to the right edge of the work area.
    expect(computeFlyoutPosition(WIN, tray, work, DISPLAY)).toEqual({ x: 1512, y: 472 })
  })

  it('top taskbar: hangs from the top edge', () => {
    const work: Rect = { x: 0, y: TB, width: 1920, height: 1080 - TB }
    const tray: Rect = { x: 1850, y: 12, width: 24, height: 24 }
    expect(computeFlyoutPosition(WIN, tray, work, DISPLAY)).toEqual({ x: 1512, y: 48 })
  })

  it('left taskbar: hugs the left edge, vertically clamped near the tray', () => {
    const work: Rect = { x: TB, y: 0, width: 1920 - TB, height: 1080 }
    const tray: Rect = { x: 12, y: 1040, width: 24, height: 24 }
    expect(computeFlyoutPosition(WIN, tray, work, DISPLAY)).toEqual({ x: 48, y: 520 })
  })

  it('right taskbar: hugs the right edge, vertically clamped near the tray', () => {
    const work: Rect = { x: 0, y: 0, width: 1920 - TB, height: 1080 }
    const tray: Rect = { x: 1896, y: 1040, width: 24, height: 24 }
    expect(computeFlyoutPosition(WIN, tray, work, DISPLAY)).toEqual({ x: 1464, y: 520 })
  })

  it('unknown tray (null) falls back to the far corner of the work area', () => {
    const work: Rect = { x: 0, y: 0, width: 1920, height: 1032 }
    expect(computeFlyoutPosition(WIN, null, work, DISPLAY)).toEqual({ x: 1512, y: 472 })
  })

  it('a zero-size tray rect is treated as unknown', () => {
    const work: Rect = { x: 0, y: 0, width: 1920, height: 1032 }
    const zeroTray: Rect = { x: 0, y: 0, width: 0, height: 0 }
    expect(computeFlyoutPosition(WIN, zeroTray, work, DISPLAY)).toEqual({ x: 1512, y: 472 })
  })

  it('never places the top-left off-screen when the window is taller than the work area', () => {
    const work: Rect = { x: 0, y: 0, width: 1920, height: 400 }
    const tall: Size = { width: 408, height: 900 }
    const tray: Rect = { x: 1850, y: 380, width: 24, height: 24 }
    const pos = computeFlyoutPosition(tall, tray, work, DISPLAY)
    expect(pos.y).toBe(0) // clamped to the work-area origin, not a negative offset
    expect(pos.x).toBeGreaterThanOrEqual(work.x)
  })

  it('respects a non-origin work area (secondary-style offset)', () => {
    const work: Rect = { x: 100, y: 50, width: 1920, height: 1032 }
    const display: Rect = { x: 100, y: 50, width: 1920, height: 1080 }
    const tray: Rect = { x: 1950, y: 1090, width: 24, height: 24 }
    const pos = computeFlyoutPosition(WIN, tray, work, display)
    expect(pos.x).toBeGreaterThanOrEqual(work.x)
    expect(pos.x).toBeLessThanOrEqual(work.x + work.width - WIN.width)
    expect(pos.y).toBe(work.y + work.height - WIN.height) // 50 + 1032 - 560 = 522
  })
})
