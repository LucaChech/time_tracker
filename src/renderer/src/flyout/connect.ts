import type { CatalogueMeta, ConnectionStatus } from '@shared/types'
import { fmtRefreshedAgo } from './format'

/**
 * Pure view-logic for the Stage-5b ClickUp connection UI, kept out of the
 * components so it is unit-testable (and so component files export only
 * components, for React Fast Refresh). The renderer holds no business logic — this
 * just maps the pushed {@link CatalogueMeta} to what the footer + connect prompt
 * should show.
 */

/** A connected, catalogue-in-hand default for the static / browser render (no
 *  bridge) so it behaves like the shipped app past its first fetch — never the
 *  connect prompt. The real meta is pushed from main under Electron. */
export const DEFAULT_META: CatalogueMeta = {
  status: 'connected',
  currentUserId: '999',
  refreshedAt: null,
  hasToken: true,
  encryptionAvailable: true
}

/**
 * Whether to show the "Connect ClickUp" prompt. True only when there is no usable
 * token — no token at all, or one the API rejected (401/403). Every other status
 * (connecting / connected / partial / offline) keeps whatever catalogue we have on
 * screen rather than blanking it behind a prompt.
 */
export function shouldShowConnectPrompt(status: ConnectionStatus): boolean {
  return status === 'no-token' || status === 'invalid-token'
}

/**
 * The footer's refresh-status label. Mirrors the connection state so the footer
 * never claims "refreshed" when a fetch failed or no token is set. `now` is passed
 * in (not read from the clock) so it stays pure/testable.
 */
export function footerRefreshLabel(meta: CatalogueMeta, now: number): string {
  const ago = (): string => fmtRefreshedAgo(meta.refreshedAt, now)
  switch (meta.status) {
    case 'connecting':
      return 'Refreshing…'
    case 'no-token':
      return 'Connect ClickUp'
    case 'invalid-token':
      return 'Reconnect ClickUp'
    case 'offline':
      return meta.refreshedAt != null ? `Offline · cached ${ago()}` : 'Offline'
    case 'partial':
      return meta.refreshedAt != null ? `Some lists failed · ${ago()}` : 'Some lists failed'
    case 'connected':
    default:
      return meta.refreshedAt != null ? `Tasks refreshed ${ago()}` : 'Tasks refreshed'
  }
}
