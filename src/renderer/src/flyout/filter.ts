import type { TaskRow } from '@shared/types'

/**
 * Filter state for the PAUSED list (view-only). Kept separate from the
 * FilterControl component so the component file only exports a component
 * (React Fast Refresh requirement).
 */
export interface FilterState {
  /** Show only tasks assigned to the current ClickUp user. */
  assignedToMe: boolean
  /** Task statuses to include (empty = all). */
  statuses: string[]
}

export const EMPTY_FILTER: FilterState = { assignedToMe: false, statuses: [] }

/** Any filter active? Drives the footer control's accent state. */
export function isFilterActive(f: FilterState): boolean {
  return f.assignedToMe || f.statuses.length > 0
}

/**
 * A paused row as seen by the filter. `status` and `assigneeIds` are the ClickUp
 * catalogue metadata the filter narrows on; Phase 5 attaches them to the fetched
 * `Task` and populates them (and threads the current user id). Until then they
 * are simply absent, so a strict filter matches nothing — which is correct: a
 * task we can't classify by status/assignee isn't "In Progress" or "mine".
 */
export type FilterableRow = TaskRow & {
  status?: string | null
  assigneeIds?: readonly string[]
}

/**
 * Narrow the PAUSED rows to those matching the active filter. **View-only**: it
 * is a pure, non-mutating projection of what to RENDER — it never touches the
 * fetch, persistence, the ACTIVE list, or the snapshot's `pausedCount` (the "M
 * idle" pill must always show the full paused total, so callers pass the filtered
 * result to the list but keep `pausedCount` from the snapshot). An inactive
 * filter is an identity pass-through.
 *
 * Predicate (a row is kept iff it satisfies BOTH active groups):
 *  - **status:** no statuses selected → all pass; otherwise the row's `status`
 *    must be one of the selected set.
 *  - **assigned to me:** off → all pass; on → the row's `assigneeIds` must
 *    include `currentUserId` (so with no known user, nothing matches).
 */
export function applyPausedFilter(
  rows: readonly FilterableRow[],
  filter: FilterState,
  currentUserId?: string | null
): FilterableRow[] {
  if (!isFilterActive(filter)) return [...rows]
  return rows.filter((row) => {
    const statusOk =
      filter.statuses.length === 0 || (row.status != null && filter.statuses.includes(row.status))
    const assigneeOk =
      !filter.assignedToMe ||
      (currentUserId != null && (row.assigneeIds?.includes(currentUserId) ?? false))
    return statusOk && assigneeOk
  })
}
