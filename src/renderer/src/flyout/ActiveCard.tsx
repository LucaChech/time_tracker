import type { JSX } from 'react'
import type { TaskRow } from '@shared/types'
import { Icon } from './Icon'
import { cardGradient, fmtHMS, softTint } from './format'

/**
 * ACTIVE section card — a running timer. Pure render of one `TaskRow`:
 * Space › List breadcrumb, task title, pinging status dot, big HH:MM:SS timer
 * (= this task's session elapsed) and a Pause pill. The ClickUp code chip is
 * rendered only when `code != null` (v0: Free-plan workspaces return none). No
 * remove (×) here — remove lives on paused rows only. Toggling is wired in 3b.
 */
export function ActiveCard({
  row,
  onPause
}: {
  row: TaskRow
  onPause?: (id: string) => void
}): JSX.Element {
  return (
    <div
      className="card"
      style={{
        background: cardGradient(row.color),
        boxShadow: `0 10px 22px -8px ${softTint(row.color)}`
      }}
    >
      <div className="card-top">
        <div style={{ minWidth: 0 }}>
          <div className="card-crumb">
            <span className="crumb-space">
              <Icon name="folder_open" />
              {row.space}
            </span>
            <Icon name="chevron_right" className="crumb-chevron" />
            <span className="crumb-list">{row.list}</span>
          </div>
          <div className="card-title">{row.name}</div>
        </div>
        <span className="ping">
          <span className="ping-core" />
          <span className="ping-ring" />
        </span>
      </div>
      <div className="card-bottom">
        <div className="card-timer-wrap">
          <div className="card-timer">{fmtHMS(row.sessionElapsedMs)}</div>
          {row.code !== null && <span className="card-code">{row.code}</span>}
        </div>
        <button type="button" className="pause-btn" onClick={() => onPause?.(row.id)}>
          <Icon name="pause" fill />
          Pause
        </button>
      </div>
    </div>
  )
}
