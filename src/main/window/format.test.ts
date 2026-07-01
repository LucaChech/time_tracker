import { describe, expect, it } from 'vitest'
import { formatDuration, formatTrayTooltip, shouldHideOnBlur } from './format'

describe('formatDuration', () => {
  it('shows only minutes under an hour', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(59_000)).toBe('0m') // seconds floored away
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(59 * 60_000)).toBe('59m')
  })

  it('shows Xh YYm with zero-padded minutes past an hour', () => {
    expect(formatDuration(60 * 60_000)).toBe('1h 00m')
    expect(formatDuration(65 * 60_000)).toBe('1h 05m')
  })

  it('tolerates 3-digit hours without truncation (tray tooltip requirement)', () => {
    expect(formatDuration(100 * 3600_000)).toBe('100h 00m')
    expect(formatDuration((999 * 3600 + 59 * 60) * 1000)).toBe('999h 59m')
  })

  it('never returns a negative duration', () => {
    expect(formatDuration(-5000)).toBe('0m')
  })
})

describe('formatTrayTooltip', () => {
  it('reads as the session total when idle', () => {
    expect(formatTrayTooltip(0, 0)).toBe('Cadence — 0m worked this session')
  })

  it('appends the live-timer count while running', () => {
    expect(formatTrayTooltip(65 * 60_000, 3)).toBe('Cadence — 1h 05m worked this session · 3 live')
  })

  it('never truncates a 3-digit-hour session', () => {
    expect(formatTrayTooltip(100 * 3600_000, 1)).toContain('100h 00m')
  })
})

describe('shouldHideOnBlur', () => {
  it('hides on blur in production with DevTools unfocused', () => {
    expect(shouldHideOnBlur({ isDev: false, devToolsFocused: false })).toBe(true)
  })

  it('never hides in dev', () => {
    expect(shouldHideOnBlur({ isDev: true, devToolsFocused: false })).toBe(false)
  })

  it('never hides while DevTools is focused (else dev is unusable)', () => {
    expect(shouldHideOnBlur({ isDev: false, devToolsFocused: true })).toBe(false)
    expect(shouldHideOnBlur({ isDev: true, devToolsFocused: true })).toBe(false)
  })
})
