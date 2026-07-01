import { useMemo, useState, type JSX } from 'react'
import type { CatalogueMeta, StateSnapshot } from '@shared/types'
import { Icon } from './Icon'
import { ActiveCard } from './ActiveCard'
import { PausedRow } from './PausedRow'
import { Composer, type ManualDraft } from './Composer'
import { FilterControl } from './FilterControl'
import { ConnectPrompt } from './ConnectPrompt'
import { applyPausedFilter, EMPTY_FILTER, type FilterState, isFilterActive } from './filter'
import { DEFAULT_META, footerRefreshLabel, shouldShowConnectPrompt } from './connect'
import { fmtHM } from './format'

type InsetPanel = 'none' | 'composer' | 'filter'

/**
 * The 3a tray flyout — a pure render of a `StateSnapshot` plus the ClickUp
 * connection `meta` (Stage 5b). It holds only view state (which inset panel is
 * open, the filter selection): all timing/union/sort math is main's, and the
 * connection state machine is main's — this projects them. Stage-5b additions: the
 * PAUSED filter is threaded with the real `currentUserId`, the status chips come
 * from the loaded catalogue, the footer shows the live refresh state, and a
 * "Connect ClickUp" prompt appears when there is no usable token.
 */
export function Flyout({
  snapshot,
  meta = DEFAULT_META,
  now = 0,
  initialPanel = 'none',
  connectOpen = false,
  onMinimize,
  onClose,
  onPause,
  onPlay,
  onRemove,
  onAddManual,
  onRefresh,
  onConnect,
  onDismissConnect
}: {
  snapshot: StateSnapshot
  meta?: CatalogueMeta
  /** Current time for the "refreshed Xm ago" label (passed in so the render stays
   *  pure; the app bumps it on a slow interval). */
  now?: number
  /** Which inset panel starts open — used to capture the composer/filter states. */
  initialPanel?: InsetPanel
  /** Force the connect prompt open (tray "Connect ClickUp…") even when connected. */
  connectOpen?: boolean
  onMinimize?: () => void
  onClose?: () => void
  onPause?: (id: string) => void
  onPlay?: (id: string) => void
  onRemove?: (id: string) => void
  onAddManual?: (draft: ManualDraft) => void
  onRefresh?: () => void
  onConnect?: (token: string) => void
  onDismissConnect?: () => void
}): JSX.Element {
  const [panel, setPanel] = useState<InsetPanel>(initialPanel)
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)

  const { active, paused, runningCount, pausedCount, sessionWorkedMs } = snapshot

  // The filter is VIEW-ONLY: it narrows which paused rows render, and nothing else.
  // ACTIVE is never filtered (a running task is always visible), and the "M idle"
  // pill below keeps `pausedCount` (the full paused total), never this filtered
  // length — so "247 idle" stays truthful while the list is narrowed. The current
  // user id (Stage 5b) powers the "Assigned to me" predicate.
  const visiblePaused = applyPausedFilter(paused, filter, meta.currentUserId)

  // The workspace's actual statuses for the filter chips: the distinct, non-null
  // statuses across everything we can show (pure projection of the snapshot).
  const statusOptions = useMemo(() => {
    const set = new Set<string>()
    for (const row of [...active, ...paused]) if (row.status) set.add(row.status)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [active, paused])

  const showConnect = connectOpen || shouldShowConnectPrompt(meta.status)
  // A dismiss is offered only when the prompt was opened manually over a working
  // token — when there's no usable token, it's the primary affordance, no backing out.
  const connectDismiss = shouldShowConnectPrompt(meta.status) ? undefined : onDismissConnect

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

          {/* Connect ClickUp prompt (Stage 5b) — no usable token, or tray-triggered */}
          {showConnect && (
            <ConnectPrompt
              meta={meta}
              onConnect={onConnect ?? (() => {})}
              onDismiss={connectDismiss}
            />
          )}

          {/* ACTIVE */}
          <div className="section-label">ACTIVE</div>
          {active.length > 0 ? (
            active.map((row) => <ActiveCard key={row.id} row={row} onPause={onPause} />)
          ) : (
            <div className="section-empty">No timers running</div>
          )}

          {/* PAUSED — the filtered view; the pill above still counts them all */}
          <div className="section-label section-label--gap">PAUSED</div>
          {visiblePaused.length > 0 ? (
            visiblePaused.map((row) => (
              <PausedRow key={row.id} row={row} onPlay={onPlay} onRemove={onRemove} />
            ))
          ) : (
            <div className="section-empty">
              {pausedCount > 0 ? 'No paused tasks match the filter' : 'No paused tasks'}
            </div>
          )}

          {panel === 'composer' && (
            <Composer onAdd={onAddManual} onCancel={() => setPanel('none')} />
          )}
          {panel === 'filter' && (
            <FilterControl value={filter} onChange={setFilter} statusOptions={statusOptions} />
          )}
        </div>

        {/* Footer: refresh status + filter (left), add untracked task (right) */}
        <div className="footer">
          <div className="footer-left">
            <button
              type="button"
              className={`footer-btn${meta.status === 'connecting' ? ' footer-btn--on' : ''}`}
              disabled={meta.status === 'connecting'}
              onClick={() => onRefresh?.()}
              title="Refresh tasks from ClickUp"
            >
              <Icon name="sync" />
              {footerRefreshLabel(meta, now)}
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
