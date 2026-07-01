import type { JSX } from 'react'
import { Icon } from './Icon'
import type { FilterState } from './filter'

// Representative statuses for the static UI. The real, workspace-specific status
// set arrives with the ClickUp catalogue in Phase 5; the filter stays view-only
// (it narrows the PAUSED list, never the fetch or persistence — wired in 3b).
// No green anywhere — "Done" uses the neutral/blue chip like the rest.
const STATUS_OPTIONS = ['To Do', 'In Progress', 'In Review', 'Blocked', 'Done']

/**
 * Filter control — the one affordance `3a` lacks (IMPLEMENTATION_PLAN.md Phase 3).
 * Two independent, multi-select toggle groups: Assigned-to-me and Task-status.
 * View-only. Rendered as an inset panel matching the composer surface.
 */
export function FilterControl({
  value,
  onChange
}: {
  value: FilterState
  onChange: (next: FilterState) => void
}): JSX.Element {
  function toggleStatus(status: string): void {
    const has = value.statuses.includes(status)
    onChange({
      ...value,
      statuses: has ? value.statuses.filter((s) => s !== status) : [...value.statuses, status]
    })
  }

  return (
    <div className="inset-panel">
      <div className="inset-eyebrow">Filter · view only</div>

      <div className="filter-group">
        <div className="filter-group-label">Assignee</div>
        <div className="chip-row">
          <button
            type="button"
            className={`chip${value.assignedToMe ? ' chip--on' : ''}`}
            aria-pressed={value.assignedToMe}
            onClick={() => onChange({ ...value, assignedToMe: !value.assignedToMe })}
          >
            <Icon name="person" />
            Assigned to me
          </button>
        </div>
      </div>

      <div className="filter-group">
        <div className="filter-group-label">Task status</div>
        <div className="chip-row">
          {STATUS_OPTIONS.map((status) => {
            const on = value.statuses.includes(status)
            return (
              <button
                key={status}
                type="button"
                className={`chip${on ? ' chip--on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleStatus(status)}
              >
                {status}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
