/**
 * Cadence domain types — shared across the state engine (main), the typed IPC
 * bridge (preload), and the renderer. This is the single source of truth for
 * the data model described in IMPLEMENTATION_PLAN.md Phase 2.
 *
 * Design rule: nothing in here imports Node or Electron, so the engine that
 * consumes these types stays pure and unit-testable in a plain Node/Vitest
 * environment (see src/main/engine).
 */

/** Where a task came from. ClickUp tasks are read-only catalogue rows; manual
 *  tasks are ad-hoc rows the user adds in-app. */
export type TaskSource = 'clickup' | 'manual'

/**
 * A trackable task. ClickUp supplies catalogue rows (Phase 5); `addManualTask`
 * mints local ones. `code` is the ClickUp custom id and is `null` unless the
 * workspace returns one (Business+ only — null on the target Free plan, so the
 * chip is hidden). `color`/`glyph` are always assigned locally.
 */
export interface Task {
  id: string
  name: string
  space: string
  list: string
  /** ClickUp `custom_id` (e.g. "CU-482"); `null` when absent — chip hidden. */
  code: string | null
  /** Hex from the local palette (ClickUp lists have no API color). */
  color: string
  /** Material Symbols glyph name. */
  glyph: string
  source: TaskSource
}

/** The three event kinds in the append-only worklog. `heartbeat` is global
 *  (taskId null) and is ignored when deriving running-state; it only bounds the
 *  crash tail and contributes to the `max(ts)` used to close dangling intervals. */
export type EventAction = 'start' | 'stop' | 'heartbeat'

/**
 * What caused an event. The plan's event line is `{ ts, taskId, action }`; the
 * charter (CLAUDE.md) lists the event triple as "timestamp + task id + source",
 * so `source` is carried as the reconciling fourth field. It is informational
 * only — derivation never branches on it — but it keeps the log self-explaining
 * (e.g. distinguishing a user pause from an auto-pause on suspend/lock/quit, and
 * marking intervals closed by crash-recovery). Defaults to `'user'`.
 */
export type EventSource = 'user' | 'suspend' | 'lock' | 'quit' | 'crash-close' | 'heartbeat'

/** One append-only line in `worklog.jsonl`. `ts` is epoch milliseconds. */
export interface WorklogEvent {
  ts: number
  /** Task the event applies to; `null` only for global `heartbeat`. */
  taskId: string | null
  action: EventAction
  source: EventSource
}

/** A half-open run interval `[start, end)` in epoch ms, with `end >= start`
 *  always (deltas are clamped to defend against clock steps). For a still-open
 *  interval, `end` is the moment of derivation (`now`). */
export interface Interval {
  start: number
  end: number
}

/**
 * A task plus its derived timing for the current session. Returned by the engine
 * as a plain, serializable row (safe to send over IPC). `lastStartTs` is the ts
 * of the most recent `start` (used to order the ACTIVE list).
 */
export interface TaskRow extends Task {
  running: boolean
  /** Elapsed this session: Σ run-time with `end > sessionStartTs`, clamped ≥ 0. */
  sessionElapsedMs: number
  /** Elapsed over the whole log — used only as a PAUSED-sort tiebreaker. */
  allTimeElapsedMs: number
  /** ts of the most recent `start` event, or `null` if never started. */
  lastStartTs: number | null
}

/**
 * The complete session-scoped projection the renderer consumes. The renderer is
 * a pure render of this snapshot — it never recomputes timing or re-sums.
 */
export interface StateSnapshot {
  /** Running tasks, most-recently-started first. */
  active: TaskRow[]
  /** Non-running, non-removed tasks, sorted by the 5-key PAUSED order. */
  paused: TaskRow[]
  /** Number of live timers (= `active.length`). The pill's "N live". */
  runningCount: number
  /** The pill's "M idle" — count of ALL paused tasks (catalogue minus running and
   *  session-removed). Equals `paused.length` today, but once 3b applies the
   *  view-only filter, the filter narrows which rows RENDER while this count must
   *  stay the full paused total (plan: "intentionally can be large, e.g. 247 idle").
   *  So the renderer must show this field, never a filtered `paused.length`. */
  pausedCount: number
  /** Wall-clock UNION of all run-intervals this session ("how long I worked").
   *  Parallel overlaps do not double-count: 3×1h parallel ⇒ 1h. Tray tooltip
   *  shows this same value. */
  sessionWorkedMs: number
  /** When the current session began (epoch ms). */
  sessionStartTs: number
}
