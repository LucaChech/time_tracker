/**
 * Pure derivation logic for the Cadence state engine — the mathematical core
 * the whole app projects from (IMPLEMENTATION_PLAN.md Phase 2). Everything here
 * is a pure function of its inputs: no I/O, no clock, no Electron. `now` is
 * always passed in. This is what the Vitest fixtures pin (VERIFICATION_SPINE.md
 * Stage 2 — the hard, automated correctness gate).
 *
 * Invariants enforced here:
 *  - Events are replayed in LOG (insertion) order, never re-sorted by `ts`. The
 *    order events were appended is the truth; `ts` may glitch (NTP / manual
 *    clock steps), so every interval delta is clamped to ≥ 0 rather than trusted.
 *  - `start`/`stop` are idempotent: a `start` while running and a `stop` while
 *    stopped are no-ops. A `stop` with no open interval, or a `start`/`stop`
 *    with a null taskId, is treated as corrupt and ignored — never NaN.
 *  - Session elapsed counts only the portion of each interval at or after
 *    `sessionStartTs`, so an interval that began before the session but is still
 *    running contributes only from `sessionStartTs` onward.
 *  - The session total is the wall-clock UNION of all run-intervals, so parallel
 *    overlaps never double-count (3 tasks × 1h in parallel ⇒ 1h). Exactly
 *    touching intervals (`stopA === startB`) merge into one — no gap, no double.
 */

import type { Interval, StateSnapshot, Task, TaskRow, WorklogEvent } from '@shared/types'

/** Per-task replay result. `open` is the start ts of the currently-running
 *  interval (null if stopped). `lastStartTs` is the ts at which the current or
 *  most-recent interval began (ignores redundant idempotent starts). */
export interface Timeline {
  intervals: Interval[]
  open: number | null
  lastStartTs: number | null
}

/** Inputs to {@link deriveState}: the full event log, the known task catalogue
 *  (ClickUp ∪ tasks-store snapshot), the session boundary, the clock, and the
 *  session-only removed-set. */
export interface DeriveInput {
  events: readonly WorklogEvent[]
  tasks: readonly Task[]
  sessionStartTs: number
  now: number
  removed: ReadonlySet<string>
}

/** Deterministic, locale-independent ascending string compare (code-unit order)
 *  — chosen over `localeCompare` so the PAUSED sort is reproducible on any host. */
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Replay the log into per-task timelines, in insertion order. */
export function replay(events: readonly WorklogEvent[]): Map<string, Timeline> {
  const map = new Map<string, Timeline>()
  for (const ev of events) {
    if (ev.action === 'heartbeat') continue
    if (ev.taskId === null) continue // start/stop must name a task; corrupt otherwise
    let tl = map.get(ev.taskId)
    if (!tl) {
      tl = { intervals: [], open: null, lastStartTs: null }
      map.set(ev.taskId, tl)
    }
    if (ev.action === 'start') {
      if (tl.open === null) {
        tl.open = ev.ts
        tl.lastStartTs = ev.ts
      }
      // already running → idempotent no-op (no new interval, lastStartTs unchanged)
    } else {
      // stop
      if (tl.open !== null) {
        const start = tl.open
        const end = ev.ts < start ? start : ev.ts // clamp delta ≥ 0
        tl.intervals.push({ start, end })
        tl.open = null
      }
      // stop with no open interval → corrupt / idempotent, ignore
    }
  }
  return map
}

/**
 * Normalize a raw run-interval into a clean `[start, end]` with `start ≤ end ≤ now`
 * and `start ≥ lo`, or `null` if nothing is left. One rule defends every clock
 * pathology at once:
 *  - `end < start` (backward step within an interval) → clamp `end` up to `start`;
 *  - `end > now` (a stop recorded in the future after a backward step) → cap at `now`,
 *    since no run-interval can extend past the moment of derivation;
 *  - `start < lo` → clip to the lower bound (`sessionStartTs`, or `-∞` for all-time).
 * Under a normal forward clock every stop ≤ now, so the `now` cap is a no-op and
 * this reduces to a plain session clip.
 */
function normInterval(start: number, rawEnd: number, now: number, lo: number): Interval | null {
  let end = rawEnd < start ? start : rawEnd
  if (end > now) end = now
  const s = start > lo ? start : lo
  return end > s ? { start: s, end } : null
}

/** A task's normalized run-intervals (closed + the open one, clipped to `lo`). */
function collectIntervals(tl: Timeline, now: number, lo: number): Interval[] {
  const out: Interval[] = []
  for (const iv of tl.intervals) {
    const n = normInterval(iv.start, iv.end, now, lo)
    if (n) out.push(n)
  }
  if (tl.open !== null) {
    const n = normInterval(tl.open, now, now, lo)
    if (n) out.push(n)
  }
  return out
}

/** Total length of the UNION of a set of intervals (merges overlaps/touches). */
function unionLength(intervals: Interval[]): number {
  let sum = 0
  for (const iv of mergeIntervals(intervals)) sum += iv.end - iv.start
  return sum
}

/**
 * Per-task elapsed THIS SESSION = wall-clock UNION of this task's own run-intervals
 * with `ts ≥ sessionStartTs`. Using the union (not a naive Σ) means a same-task
 * self-overlap — only possible when a clock step puts a re-`start` before the prior
 * `stop` — can't double-count, so a per-card timer can never exceed the session
 * total. With a sane clock (no self-overlap) the union equals Σ exactly.
 */
function taskSessionMs(tl: Timeline, sessionStartTs: number, now: number): number {
  return unionLength(collectIntervals(tl, now, sessionStartTs))
}

/** Per-task elapsed over the WHOLE log (union) — PAUSED-sort tiebreaker only. */
function taskAllTimeMs(tl: Timeline, now: number): number {
  return unionLength(collectIntervals(tl, now, Number.NEGATIVE_INFINITY))
}

/**
 * Merge overlapping AND exactly-touching intervals into a minimal disjoint set,
 * sorted by start. Touching (`a.end === b.start`) merges — the strict `>` gap
 * test means no phantom gap and no double-count. Zero-length inputs are assumed
 * pre-filtered by callers (see {@link sessionUnionMs}).
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Interval[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    const last = merged[merged.length - 1]
    if (cur.start > last.end) merged.push({ ...cur })
    else if (cur.end > last.end) last.end = cur.end
  }
  return merged
}

/**
 * Session total = wall-clock union of every task's run-intervals this session
 * (each normalized + clipped to `sessionStartTs`). Parallel overlaps collapse, so
 * this is literally "how long ≥ 1 timer ran" — and, being a union over all tasks,
 * it is always ≥ any single task's session elapsed.
 */
export function sessionUnionMs(
  timelines: Iterable<Timeline>,
  sessionStartTs: number,
  now: number
): number {
  const all: Interval[] = []
  for (const tl of timelines) {
    for (const iv of collectIntervals(tl, now, sessionStartTs)) all.push(iv)
  }
  return unionLength(all)
}

/**
 * PAUSED sort comparator — descending priority:
 * (1) session elapsed ↓, (2) all-time elapsed ↓, (3) Space ↑, (4) List ↑,
 * (5) name ↑. Tasks worked this session float up, then tasks worked in earlier
 * sessions, then the untouched catalogue grouped Space → List → name.
 *
 * `id` is appended as an ultimate stabilizer: ClickUp does not enforce unique task
 * names, so two rows can tie on all five spec keys; without a unique final key the
 * order would fall to fetch-dependent input order (non-deterministic across
 * refreshes). `id` only ever orders genuine 5-key ties — `name` remains the last
 * MEANINGFUL key — so the spec ordering is unchanged and the result is total.
 */
export function comparePaused(a: TaskRow, b: TaskRow): number {
  return (
    b.sessionElapsedMs - a.sessionElapsedMs ||
    b.allTimeElapsedMs - a.allTimeElapsedMs ||
    cmpStr(a.space, b.space) ||
    cmpStr(a.list, b.list) ||
    cmpStr(a.name, b.name) ||
    cmpStr(a.id, b.id)
  )
}

/** ACTIVE sort — most-recently-started first; name then id as deterministic
 *  tiebreakers so the order is total and stable. */
function compareActive(a: TaskRow, b: TaskRow): number {
  return (b.lastStartTs ?? 0) - (a.lastStartTs ?? 0) || cmpStr(a.name, b.name) || cmpStr(a.id, b.id)
}

function toRow(task: Task, tl: Timeline | undefined, sessionStartTs: number, now: number): TaskRow {
  if (!tl) {
    return { ...task, running: false, sessionElapsedMs: 0, allTimeElapsedMs: 0, lastStartTs: null }
  }
  return {
    ...task,
    running: tl.open !== null,
    sessionElapsedMs: taskSessionMs(tl, sessionStartTs, now),
    allTimeElapsedMs: taskAllTimeMs(tl, now),
    lastStartTs: tl.lastStartTs
  }
}

/**
 * Derive the full session-scoped projection the renderer consumes. Pure: same
 * inputs ⇒ same snapshot, always. Removed tasks are excluded from both lists but
 * their past run-time still counts toward the session union (the work happened).
 */
export function deriveState(input: DeriveInput): StateSnapshot {
  const { events, tasks, sessionStartTs, now, removed } = input
  const timelines = replay(events)
  const rows = tasks.map((t) => toRow(t, timelines.get(t.id), sessionStartTs, now))

  const active = rows.filter((r) => r.running && !removed.has(r.id)).sort(compareActive)
  const paused = rows.filter((r) => !r.running && !removed.has(r.id)).sort(comparePaused)

  return {
    active,
    paused,
    runningCount: active.length,
    pausedCount: paused.length,
    sessionWorkedMs: sessionUnionMs(timelines.values(), sessionStartTs, now),
    sessionStartTs
  }
}
