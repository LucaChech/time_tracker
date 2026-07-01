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
