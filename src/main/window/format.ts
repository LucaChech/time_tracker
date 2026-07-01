/**
 * Main-process display helpers — pure, no Electron import (unit-tested under
 * Vitest). The renderer has its own formatters in `flyout/format.ts`; the tray
 * lives in main and can't import renderer code, so the session-total formatter is
 * duplicated here deliberately and kept behaviourally identical (`Xh YYm` / `Mm`,
 * no seconds, tolerant of 3-digit hours — the tooltip must never truncate at
 * 100h+, per the Stage-4 spine).
 */

/**
 * Session total as `Xh YYm` (minutes zero-padded) once past an hour, else `Mm`.
 * Never negative (the engine already clamps), never capped — 100h renders as
 * `100h 00m`, not a truncated value.
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

/**
 * The tray tooltip: the session total ("worked this session" — the wall-clock
 * union), plus a live-timer count when any timer runs. Mirrors what the panel's
 * session line shows so the tray and the flyout never disagree.
 */
export function formatTrayTooltip(sessionWorkedMs: number, runningCount: number): string {
  const worked = formatDuration(sessionWorkedMs)
  const live = runningCount > 0 ? ` · ${runningCount} live` : ''
  return `Cadence — ${worked} worked this session${live}`
}

/**
 * Whether a blur should hide the flyout. Hide only when NOT in dev and the
 * DevTools aren't focused — otherwise opening/clicking DevTools would blur the
 * window and hide it out from under the developer, making dev unusable.
 */
export function shouldHideOnBlur(ctx: { isDev: boolean; devToolsFocused: boolean }): boolean {
  return !ctx.isDev && !ctx.devToolsFocused
}
