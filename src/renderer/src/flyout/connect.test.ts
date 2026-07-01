import { describe, expect, it } from 'vitest'
import type { CatalogueMeta } from '@shared/types'
import { footerRefreshLabel, shouldShowConnectPrompt } from './connect'
import { fmtRefreshedAgo } from './format'

/**
 * Stage 5b — the pure view-logic mapping the pushed connection meta to the footer
 * label + connect-prompt visibility. The components stay dumb; this is where the
 * status→UI decision lives, so it's the piece worth pinning.
 */

const meta = (over: Partial<CatalogueMeta> = {}): CatalogueMeta => ({
  status: 'connected',
  currentUserId: '302553911',
  refreshedAt: null,
  hasToken: true,
  encryptionAvailable: true,
  ...over
})

describe('shouldShowConnectPrompt', () => {
  it('is true only when there is no usable token (no-token / invalid-token)', () => {
    expect(shouldShowConnectPrompt('no-token')).toBe(true)
    expect(shouldShowConnectPrompt('invalid-token')).toBe(true)
  })
  it('is false while connecting or when a catalogue is in hand', () => {
    for (const s of ['connecting', 'connected', 'partial', 'offline'] as const) {
      expect(shouldShowConnectPrompt(s)).toBe(false)
    }
  })
})

describe('fmtRefreshedAgo', () => {
  const now = 1_000_000_000_000
  it('renders "never" with no timestamp', () => {
    expect(fmtRefreshedAgo(null, now)).toBe('never')
  })
  it('buckets recent → just now / minutes / hours / days', () => {
    expect(fmtRefreshedAgo(now - 10_000, now)).toBe('just now')
    expect(fmtRefreshedAgo(now - 120_000, now)).toBe('2m ago')
    expect(fmtRefreshedAgo(now - 2 * 3_600_000, now)).toBe('2h ago')
    expect(fmtRefreshedAgo(now - 3 * 86_400_000, now)).toBe('3d ago')
  })
  it('never goes negative for a future timestamp (clock step)', () => {
    expect(fmtRefreshedAgo(now + 60_000, now)).toBe('just now')
  })
})

describe('footerRefreshLabel', () => {
  const now = 1_000_000_000_000
  it('shows "refreshed Xm ago" when connected with a timestamp', () => {
    expect(footerRefreshLabel(meta({ status: 'connected', refreshedAt: now - 120_000 }), now)).toBe(
      'Tasks refreshed 2m ago'
    )
  })
  it('reflects the failure/connect states honestly (never a false "refreshed")', () => {
    expect(footerRefreshLabel(meta({ status: 'connecting' }), now)).toBe('Refreshing…')
    expect(footerRefreshLabel(meta({ status: 'no-token' }), now)).toBe('Connect ClickUp')
    expect(footerRefreshLabel(meta({ status: 'invalid-token' }), now)).toBe('Reconnect ClickUp')
    expect(footerRefreshLabel(meta({ status: 'offline', refreshedAt: now - 3_600_000 }), now)).toBe(
      'Offline · cached 1h ago'
    )
    expect(footerRefreshLabel(meta({ status: 'partial', refreshedAt: now - 60_000 }), now)).toBe(
      'Some lists failed · 1m ago'
    )
  })
})
