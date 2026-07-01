import type { JSX } from 'react'
import type { TaskRow } from '@shared/types'
import { Icon } from './Icon'
import { fmtShort, ringTint } from './format'

/**
 * PAUSED section row. Pure render of one `TaskRow`: a colored attention bar, the
 * task name + `Space · List` subtitle, the short session elapsed (hidden when 0 to
 * keep the untouched catalogue tail clean), a round outlined Play button, and the
 * v0 per-row remove (×). Resume/remove are wired in 3b.
 */
export function PausedRow({
  row,
  onPlay,
  onRemove
}: {
  row: TaskRow
  onPlay?: (id: string) => void
  onRemove?: (id: string) => void
}): JSX.Element {
  return (
    <div className="row">
      <span className="row-bar" style={{ background: row.color }} />
      <div className="row-main">
        <div className="row-name">{row.name}</div>
        <div className="row-crumb">
          {row.space} · {row.list}
        </div>
      </div>
      {row.sessionElapsedMs > 0 && (
        <div className="row-short">{fmtShort(row.sessionElapsedMs)}</div>
      )}
      <button
        type="button"
        className="play-btn"
        style={{ border: `1.5px solid ${ringTint(row.color)}`, color: row.color }}
        aria-label={`Resume ${row.name}`}
        onClick={() => onPlay?.(row.id)}
      >
        <Icon name="play_arrow" fill />
      </button>
      <button
        type="button"
        className="remove-btn"
        aria-label={`Remove ${row.name}`}
        title="Hide for this session"
        onClick={() => onRemove?.(row.id)}
      >
        <Icon name="close" />
      </button>
    </div>
  )
}
