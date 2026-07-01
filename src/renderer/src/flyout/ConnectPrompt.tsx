import { useState, type JSX } from 'react'
import type { CatalogueMeta } from '@shared/types'

/**
 * "Connect ClickUp" prompt (Stage 5b) — the inset panel shown when there is no
 * usable token (first run, or a rejected token), and on demand from the tray's
 * "Connect ClickUp…" item. The pasted token is `type=password` (masked, no
 * autofill/spellcheck), sent to main over IPC where it is encrypted at rest; the
 * renderer keeps it only in this transient field. View state only — no logic.
 */
export function ConnectPrompt({
  meta,
  onConnect,
  onDismiss
}: {
  meta: CatalogueMeta
  onConnect: (token: string) => void
  /** Present only when a working token already exists (manual reopen): lets the
   *  user back out. Absent when there is nothing else to show. */
  onDismiss?: () => void
}): JSX.Element {
  const [token, setToken] = useState('')
  const rejected = meta.status === 'invalid-token'

  function submit(): void {
    const trimmed = token.trim()
    if (!trimmed) return
    onConnect(trimmed)
    setToken('')
  }

  return (
    <form
      className="inset-panel"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDismiss?.()
      }}
    >
      <div className="inset-eyebrow">Connect ClickUp</div>
      <div className="connect-copy">
        {rejected
          ? 'That token was rejected. Paste a current ClickUp personal token (starts with pk_).'
          : 'Paste your ClickUp personal API token (starts with pk_) to load your tasks.'}
      </div>
      <input
        className="ci connect-input"
        type="password"
        aria-label="ClickUp API token"
        placeholder="pk_…"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        autoFocus
        autoComplete="off"
        spellCheck={false}
      />
      {!meta.encryptionAvailable && (
        <div className="connect-warn">
          Secure storage is unavailable on this device, so the token can’t be saved.
        </div>
      )}
      <div className="composer-actions">
        {onDismiss && (
          <button type="button" className="btn-cancel" onClick={onDismiss}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn-add" disabled={token.trim().length === 0}>
          Connect
        </button>
      </div>
    </form>
  )
}
