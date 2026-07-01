import { useState, type JSX } from 'react'
import type { StateSnapshot } from '@shared/types'
import { Icon } from './Icon'
import { ActiveCard } from './ActiveCard'
import { PausedRow } from './PausedRow'
import { Composer, type ManualDraft } from './Composer'
import { FilterControl } from './FilterControl'
import { EMPTY_FILTER, type FilterState, isFilterActive } from './filter'
import { fmtHM } from './format'

type InsetPanel = 'none' | 'composer' | 'filter'

/**
 * The 3a tray flyout — a pure render of a `StateSnapshot` (the shape the engine's
 * getState() returns). Stage 3a is the static, pixel-faithful panel BEFORE it is
 * wired to the engine; operation handlers (start/stop/remove/add) are optional and
 * wired over IPC in Stage 3b. Only view state (which inset panel is open, the
 * filter selection) lives here — no business logic, no timing recompute.
 */
export function Flyout({
  snapshot,
  initialPanel = 'none',
  onMinimize,
  onClose,
  onPause,
  onPlay,
  onRemove,
  onAddManual
}: {
  snapshot: StateSnapshot
  /** Which inset panel starts open — used to capture the composer/filter states. */
  initialPanel?: InsetPanel
  onMinimize?: () => void
  onClose?: () => void
  onPause?: (id: string) => void
  onPlay?: (id: string) => void
  onRemove?: (id: string) => void
  onAddManual?: (draft: ManualDraft) => void
}): JSX.Element {
  const [panel, setPanel] = useState<InsetPanel>(initialPanel)
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)

  const { active, paused, runningCount, pausedCount, sessionWorkedMs } = snapshot

  return (
    <div className="stage">
      <div className="flyout">
        {/* Title bar — minimize + close only (maximize removed for a fixed flyout) */}
        <div className="titlebar">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="timer" fill />
            </span>
            <span className="brand-name">Cadence</span>
          </div>
          <div className="window-controls">
            <button type="button" className="winbtn" aria-label="Minimize" onClick={onMinimize}>
              <Icon name="remove" />
            </button>
            <button type="button" className="winclose" aria-label="Close" onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
        </div>

        <div className="content">
          {/* Current-session line: total = wall-clock union; pill = live/idle counts */}
          <div className="session-line">
            <div className="session-heading">
              <span className="session-title">Current session</span>
              <span className="session-total">{fmtHM(sessionWorkedMs)}</span>
            </div>
            <div className="live-pill">
              <span className="live-dot" />
              {runningCount} live · {pausedCount} idle
            </div>
          </div>

          {/* ACTIVE */}
          <div className="section-label">ACTIVE</div>
          {active.length > 0 ? (
            active.map((row) => <ActiveCard key={row.id} row={row} onPause={onPause} />)
          ) : (
            <div className="section-empty">No timers running</div>
          )}

          {/* PAUSED */}
          <div className="section-label section-label--gap">PAUSED</div>
          {paused.length > 0 ? (
            paused.map((row) => (
              <PausedRow key={row.id} row={row} onPlay={onPlay} onRemove={onRemove} />
            ))
          ) : (
            <div className="section-empty">No paused tasks</div>
          )}

          {panel === 'composer' && (
            <Composer onAdd={onAddManual} onCancel={() => setPanel('none')} />
          )}
          {panel === 'filter' && <FilterControl value={filter} onChange={setFilter} />}
        </div>

        {/* Footer: refresh status + filter (left), add untracked task (right) */}
        <div className="footer">
          <div className="footer-left">
            <button type="button" className="footer-btn">
              <Icon name="sync" />
              Tasks refreshed 2m ago
            </button>
            <button
              type="button"
              className={`footer-btn${isFilterActive(filter) || panel === 'filter' ? ' footer-btn--on' : ''}`}
              aria-expanded={panel === 'filter'}
              onClick={() => setPanel((p) => (p === 'filter' ? 'none' : 'filter'))}
            >
              <Icon name="filter_list" />
              Filter
            </button>
          </div>
          <button
            type="button"
            className="footer-btn footer-btn--accent"
            aria-expanded={panel === 'composer'}
            onClick={() => setPanel((p) => (p === 'composer' ? 'none' : 'composer'))}
          >
            <Icon name="edit_note" />
            Add untracked task
          </button>
        </div>
      </div>
    </div>
  )
}
