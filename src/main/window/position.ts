/**
 * Flyout positioning — pure geometry, no Electron import, so it unit-tests under
 * Vitest (node env) the same way the state engine does.
 *
 * The flyout floats above the taskbar near the tray. Windows can put the taskbar
 * on any edge, so we infer the taskbar edge from the difference between the full
 * display bounds and its work area (the work area excludes the taskbar), anchor
 * the flyout to the tray along the taskbar's axis, then clamp the whole rectangle
 * back inside the work area. Clamping — not just the anchor — is what the Stage-4
 * spine's `missing_checks` require for top/left/right taskbars, not only bottom.
 */

/** A screen rectangle (matches Electron's `Rectangle` structurally). */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Just the size of the window being placed. */
export interface Size {
  width: number
  height: number
}

export type TaskbarEdge = 'top' | 'bottom' | 'left' | 'right'

/** Clamp `v` into `[lo, hi]`; if the window is larger than the work area
 *  (`hi < lo`) prefer the work-area origin so the top-left stays on screen. */
function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo
  return Math.min(Math.max(v, lo), hi)
}

/**
 * Infer which edge the taskbar occupies by comparing the work area to the full
 * display bounds. The edge with the largest reclaimed gap is the taskbar; ties
 * (e.g. a fullscreen display with no reclaimed space) resolve to `bottom`, the
 * Windows default.
 */
export function inferTaskbarEdge(work: Rect, display: Rect): TaskbarEdge {
  const gaps: Record<TaskbarEdge, number> = {
    bottom: display.y + display.height - (work.y + work.height),
    top: work.y - display.y,
    left: work.x - display.x,
    right: display.x + display.width - (work.x + work.width)
  }
  // Iterate bottom-first so a no-taskbar tie stays 'bottom'.
  let edge: TaskbarEdge = 'bottom'
  let max = -Infinity
  for (const e of ['bottom', 'top', 'left', 'right'] as const) {
    if (gaps[e] > max) {
      max = gaps[e]
      edge = e
    }
  }
  return edge
}

/**
 * Top-left position for the flyout so it sits just inside the work area against
 * the taskbar edge, centred on the tray along that edge's axis, fully on screen.
 *
 * @param win     the flyout window size
 * @param tray    tray icon bounds, or `null` when unknown (some platforms report
 *                a zero rect) — then the flyout falls back to the far corner
 * @param work    the display work area (excludes the taskbar)
 * @param display the full display bounds (includes the taskbar)
 */
export function computeFlyoutPosition(
  win: Size,
  tray: Rect | null,
  work: Rect,
  display: Rect
): { x: number; y: number } {
  const edge = inferTaskbarEdge(work, display)
  const hasTray = tray !== null && tray.width > 0 && tray.height > 0
  const trayCenterX = hasTray ? tray.x + tray.width / 2 : null
  const trayCenterY = hasTray ? tray.y + tray.height / 2 : null

  const rightCorner = work.x + work.width - win.width
  const bottomCorner = work.y + work.height - win.height

  let x: number
  let y: number
  switch (edge) {
    case 'top':
      y = work.y
      x = trayCenterX !== null ? trayCenterX - win.width / 2 : rightCorner
      break
    case 'left':
      x = work.x
      y = trayCenterY !== null ? trayCenterY - win.height / 2 : bottomCorner
      break
    case 'right':
      x = rightCorner
      y = trayCenterY !== null ? trayCenterY - win.height / 2 : bottomCorner
      break
    case 'bottom':
    default:
      y = bottomCorner
      x = trayCenterX !== null ? trayCenterX - win.width / 2 : rightCorner
      break
  }

  return {
    x: Math.round(clamp(x, work.x, rightCorner)),
    y: Math.round(clamp(y, work.y, bottomCorner))
  }
}
