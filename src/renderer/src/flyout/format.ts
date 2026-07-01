/**
 * Display formatters + color helpers for the 3a flyout.
 *
 * These mirror the prototype's helpers 1:1 (Cadence Tracker.dc.html, renderVals)
 * so the recreated UI reads identically — the only change is the input unit: the
 * engine's StateSnapshot carries elapsed as **milliseconds**, so every formatter
 * takes ms and floors to whole seconds first (matching the prototype's per-second
 * granularity). Pure functions, no side effects.
 */

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Whole seconds from ms, floored (never negative — the engine already clamps). */
const toSec = (ms: number): number => Math.floor(Math.max(0, ms) / 1000)

/** Big per-task timer: `HH:MM:SS`, tabular. Prototype `fmt`. */
export function fmtHMS(ms: number): string {
  const sec = toSec(ms)
  return `${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor((sec % 3600) / 60))}:${pad2(sec % 60)}`
}

/** Paused-row short elapsed: `Xh YYm` when ≥1h else `Mm SSs`. Prototype `fmtShort`. */
export function fmtShort(ms: number): string {
  const sec = toSec(ms)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${pad2(m)}m` : `${m}m ${pad2(sec % 60)}s`
}

/** Session total: `Xh YYm` (no seconds) when ≥1h else `Mm`. Prototype `totalHM`. */
export function fmtHM(ms: number): string {
  const sec = toSec(ms)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${pad2(m)}m` : `${m}m`
}

/** `#rrggbb` → `rgba(r,g,b,a)`. Prototype `rgba`. */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Darken a hex by multiplying each channel by `f`. Prototype `shade`. */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`
}

/** Active-card 135° gradient: `<color>` → `<color>×0.68`. Prototype `grad`. */
export function cardGradient(color: string): string {
  return `linear-gradient(135deg, ${color} 0%, ${shade(color, 0.68)} 100%)`
}

/** Soft colored card shadow tint: `<color>@16%`. Prototype `soft`. */
export const softTint = (color: string): string => rgba(color, 0.16)

/** Paused-row play-button ring: `<color>@28%`. Prototype `ring`. */
export const ringTint = (color: string): string => rgba(color, 0.28)
