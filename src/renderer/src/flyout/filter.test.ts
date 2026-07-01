import { describe, expect, it } from 'vitest'
import {
  applyPausedFilter,
  EMPTY_FILTER,
  isFilterActive,
  type FilterableRow,
  type FilterState
} from './filter'

/**
 * Stage 3b — the one piece of genuinely new renderer logic: the view-only PAUSED
 * filter. The wiring invariants (it never touches ACTIVE, the fetch, persistence,
 * or the `pausedCount` pill) live in the Flyout; here we pin the pure predicate.
 *
 * The `status` / `assigneeIds` fields it narrows on land on the catalogue row in
 * Phase 5, so these fixtures supply them directly to prove the predicate is
 * correct now — decoupled from the fact that live 3b rows don't yet carry them.
 */

let seq = 0
function row(over: Partial<FilterableRow> = {}): FilterableRow {
  seq += 1
  return {
    id: `t${seq}`,
    name: `Task ${seq}`,
    space: 'Space',
    list: 'List',
    code: null,
    color: '#0058bc',
    glyph: 'task_alt',
    source: 'clickup',
    running: false,
    sessionElapsedMs: 0,
    allTimeElapsedMs: 0,
    lastStartTs: null,
    ...over
  }
}

const withStatuses = (statuses: string[]): FilterState => ({ assignedToMe: false, statuses })
const assignedOnly = (): FilterState => ({ assignedToMe: true, statuses: [] })

describe('isFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
  })
  it('is true when assignedToMe or any status is set', () => {
    expect(isFilterActive({ assignedToMe: true, statuses: [] })).toBe(true)
    expect(isFilterActive({ assignedToMe: false, statuses: ['To Do'] })).toBe(true)
  })
})

describe('applyPausedFilter — inactive filter is identity', () => {
  it('returns every row when no filter is active', () => {
    const rows = [row(), row(), row()]
    expect(applyPausedFilter(rows, EMPTY_FILTER)).toEqual(rows)
  })

  it('returns a new array (never the same reference) so callers cannot alias state', () => {
    const rows = [row()]
    const out = applyPausedFilter(rows, EMPTY_FILTER)
    expect(out).not.toBe(rows)
    expect(out).toEqual(rows)
  })
})

describe('applyPausedFilter — status group', () => {
  it('keeps only rows whose status is in the selected set', () => {
    const todo = row({ status: 'To Do' })
    const doing = row({ status: 'In Progress' })
    const review = row({ status: 'In Review' })
    const out = applyPausedFilter([todo, doing, review], withStatuses(['In Progress', 'In Review']))
    expect(out).toEqual([doing, review])
  })

  it('drops rows with no status (null / undefined) under an active status filter', () => {
    const nullStatus = row({ status: null })
    const noStatus = row() // status field absent entirely
    const match = row({ status: 'Blocked' })
    const out = applyPausedFilter([nullStatus, noStatus, match], withStatuses(['Blocked']))
    expect(out).toEqual([match])
  })

  it('empties the list when no row matches the selected status', () => {
    const out = applyPausedFilter([row({ status: 'To Do' })], withStatuses(['Done']))
    expect(out).toEqual([])
  })
})

describe('applyPausedFilter — assigned-to-me group', () => {
  it('keeps only rows whose assigneeIds include the current user', () => {
    const mine = row({ assigneeIds: ['u1', 'u2'] })
    const theirs = row({ assigneeIds: ['u2'] })
    const none = row({ assigneeIds: [] })
    const out = applyPausedFilter([mine, theirs, none], assignedOnly(), 'u1')
    expect(out).toEqual([mine])
  })

  it('matches nothing when the current user id is unknown (null / undefined)', () => {
    const rows = [row({ assigneeIds: ['u1'] }), row({ assigneeIds: ['u2'] })]
    expect(applyPausedFilter(rows, assignedOnly(), null)).toEqual([])
    expect(applyPausedFilter(rows, assignedOnly())).toEqual([])
  })
})

describe('applyPausedFilter — groups combine with AND', () => {
  it('requires both the status and the assignee predicate to pass', () => {
    const both = row({ status: 'In Progress', assigneeIds: ['u1'] })
    const statusOnly = row({ status: 'In Progress', assigneeIds: ['u9'] })
    const assigneeOnly = row({ status: 'Done', assigneeIds: ['u1'] })
    const filter: FilterState = { assignedToMe: true, statuses: ['In Progress'] }
    const out = applyPausedFilter([both, statusOnly, assigneeOnly], filter, 'u1')
    expect(out).toEqual([both])
  })
})

describe('applyPausedFilter — purity & view-only guarantees', () => {
  it('never mutates the input array or its rows', () => {
    const rows = [row({ status: 'To Do' }), row({ status: 'Done' })]
    const snapshot = structuredClone(rows)
    applyPausedFilter(rows, withStatuses(['To Do']), 'u1')
    expect(rows).toEqual(snapshot)
  })

  it('always returns a subset of the input (adds nothing, reorders nothing)', () => {
    const rows = [row({ status: 'A' }), row({ status: 'B' }), row({ status: 'C' })]
    const out = applyPausedFilter(rows, withStatuses(['A', 'C']))
    // every returned row is one of the inputs, in original order
    expect(rows).toEqual(expect.arrayContaining(out))
    expect(out).toEqual([rows[0], rows[2]])
  })
})
