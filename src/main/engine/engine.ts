/**
 * CadenceEngine — the orchestrator that owns the worklog, the task-metadata
 * snapshot, and the session-only state, and exposes the operations the UI drives
 * over IPC (start / stop / toggle / addManualTask / removeFromList) plus the
 * derived {@link StateSnapshot}.
 *
 * Dependencies are injected (IMPLEMENTATION_PLAN.md Phase 2): `now()` is the
 * clock and `dir` is the storage directory (Electron's userData in the app, a
 * temp dir in tests). Nothing here imports Electron, so the whole engine is
 * unit-testable with a real filesystem.
 *
 * Session model: a session is one app run. `CadenceEngine.create()` loads the
 * persistent log, closes any intervals left open by a previous crash, and starts
 * a FRESH session — `sessionStartTs = now()`, an empty removed-set, zero running
 * timers. The log persists across sessions as history; session elapsed and the
 * session union always derive from `sessionStartTs` onward, so a normal forward
 * clock yields 0 session-elapsed at launch with no UI restore of prior totals.
 */

import { randomUUID } from 'node:crypto'
import type { EventSource, ManualTaskInput, StateSnapshot, Task, WorklogEvent } from '@shared/types'
import { deriveState, replay } from './derive'
import { appendEvent, readTasksStore, readWorklog, writeTasksStore } from './store'

export interface EngineDeps {
  /** Storage directory for `worklog.jsonl` + `tasks-store.json`. */
  dir: string
  /** Injected clock (epoch ms). */
  now: () => number
}

/** Re-exported from the shared data model so existing engine consumers keep
 *  importing it from here; the canonical definition lives in `@shared/types`. */
export type { ManualTaskInput } from '@shared/types'

/** Cycled palette for manual tasks (IMPLEMENTATION_PLAN.md Phase 2). */
const MANUAL_COLORS = ['#c64f00', '#4b3fb0', '#0091b3', '#fe9400'] as const
const MANUAL_GLYPHS = ['edit_note', 'draw', 'task_alt', 'bolt'] as const

export class CadenceEngine {
  private readonly dir: string
  private readonly now: () => number

  /** In-memory mirror of `worklog.jsonl`, kept in sync with every append, so
   *  `getState()` derives without touching disk (cheap enough for the 1s tick). */
  private readonly events: WorklogEvent[]
  /** Persisted metadata for every manual / ever-started task. */
  private readonly tasksStore: Map<string, Task>
  /** Live catalogue this session (manual adds + ClickUp refresh in Phase 5). */
  private readonly catalogue = new Map<string, Task>()
  /** Ids running right now — mirrors the log's open intervals; drives idempotency. */
  private readonly runningIds = new Set<string>()
  /** Session-only ids hidden from PAUSED (cleared every launch). */
  private readonly removed = new Set<string>()

  private readonly sessionStartTs: number

  private constructor(deps: EngineDeps, events: WorklogEvent[], tasksStore: Map<string, Task>) {
    this.dir = deps.dir
    this.now = deps.now
    this.events = events
    this.tasksStore = tasksStore
    this.sessionStartTs = deps.now()
    // After crash-hygiene (below) every interval is closed, so nothing is running.
  }

  /**
   * Load persistent state and begin a new session. Crash hygiene: any interval
   * left open by a previous run is closed in the log at `max(ts)` across all
   * events (heartbeats included), so history stays clean with no phantom time.
   */
  static create(deps: EngineDeps): CadenceEngine {
    const events = readWorklog(deps.dir)

    let maxTs = 0
    for (const ev of events) if (ev.ts > maxTs) maxTs = ev.ts

    const timelines = replay(events)
    for (const [taskId, tl] of timelines) {
      if (tl.open !== null) {
        const closeEvent: WorklogEvent = {
          ts: maxTs,
          taskId,
          action: 'stop',
          source: 'crash-close'
        }
        appendEvent(deps.dir, closeEvent)
        events.push(closeEvent)
      }
    }

    const tasksStore = new Map<string, Task>()
    for (const t of readTasksStore(deps.dir)) tasksStore.set(t.id, t)

    return new CadenceEngine(deps, events, tasksStore)
  }

  // ── operations ──────────────────────────────────────────────────────────

  /** Start a task's timer. No-op if already running (idempotent). Upserts the
   *  task's metadata snapshot on each start. */
  start(taskId: string, source: EventSource = 'user'): void {
    if (this.runningIds.has(taskId)) return
    const task = this.catalogue.get(taskId) ?? this.tasksStore.get(taskId)
    if (task) this.upsertStore(task)
    this.append({ ts: this.now(), taskId, action: 'start', source })
    this.runningIds.add(taskId)
  }

  /** Stop a task's timer. No-op if not running (idempotent). */
  stop(taskId: string, source: EventSource = 'user'): void {
    if (!this.runningIds.has(taskId)) return
    this.append({ ts: this.now(), taskId, action: 'stop', source })
    this.runningIds.delete(taskId)
  }

  /** UI affordance: running → stop, otherwise → start. */
  toggle(taskId: string): void {
    if (this.runningIds.has(taskId)) this.stop(taskId)
    else this.start(taskId)
  }

  /** Stop every running timer (graceful quit, system suspend, screen lock). */
  stopAllRunning(source: EventSource): void {
    for (const taskId of [...this.runningIds]) this.stop(taskId, source)
  }

  /** Graceful Quit: append a `stop` for every running task. */
  quit(): void {
    this.stopAllRunning('quit')
  }

  /** Append a global heartbeat (Phase 6 writer). Ignored for running-state;
   *  bounds the crash tail via the `max(ts)` used by {@link create}. */
  heartbeat(): void {
    this.append({ ts: this.now(), taskId: null, action: 'heartbeat', source: 'heartbeat' })
  }

  /**
   * Add an ad-hoc task not in ClickUp. Created paused, `source:'manual'`,
   * `code:null`; color/glyph cycle through the manual palette by how many manual
   * tasks already exist; space/list default to 'Untracked'. Returns the new task.
   */
  addManualTask(input: ManualTaskInput): Task {
    const idx = this.countManualTasks() % MANUAL_COLORS.length
    const name = input.name.trim()
    const space = input.space?.trim() || 'Untracked'
    const list = input.list?.trim() || 'Untracked'
    const task: Task = {
      id: randomUUID(),
      name,
      space,
      list,
      code: null,
      color: MANUAL_COLORS[idx],
      glyph: MANUAL_GLYPHS[idx],
      source: 'manual'
    }
    this.catalogue.set(task.id, task)
    this.upsertStore(task)
    return task
  }

  /** Hide a task from PAUSED for this session (reappears next launch). The UI
   *  exposes this only on paused rows, so a running task is paused first. */
  removeFromList(taskId: string): void {
    this.removed.add(taskId)
  }

  /** Replace the live catalogue from a ClickUp refresh (Phase 5) and upsert each
   *  task's metadata snapshot. Never touches the worklog or intervals. The store
   *  is rewritten ONCE (not per task), so a ~250-task refresh is one atomic write,
   *  not 250. */
  setCatalogue(tasks: readonly Task[]): void {
    this.catalogue.clear()
    for (const t of tasks) {
      this.catalogue.set(t.id, t)
      this.tasksStore.set(t.id, t)
    }
    this.persistStore()
  }

  // ── queries ─────────────────────────────────────────────────────────────

  /** Derive the full session-scoped projection for the renderer. */
  getState(): StateSnapshot {
    return deriveState({
      events: this.events,
      tasks: this.knownTasks(),
      sessionStartTs: this.sessionStartTs,
      now: this.now(),
      removed: this.removed
    })
  }

  getSessionStartTs(): number {
    return this.sessionStartTs
  }

  /** Whether any timer is currently running — an O(1) check the display tick uses
   *  to skip re-deriving the log when nothing would change. */
  hasRunning(): boolean {
    return this.runningIds.size > 0
  }

  /** Whether an id names a task we can render (in the live catalogue or the
   *  persisted metadata snapshot). The IPC layer guards operations with this so a
   *  malformed id can never open a phantom, unstoppable interval — one that would
   *  inflate the session union with no row to stop it. */
  hasTask(taskId: string): boolean {
    return this.catalogue.has(taskId) || this.tasksStore.has(taskId)
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Every task we can render: the persisted snapshot, with live catalogue
   *  metadata overlaid. Tasks absent from the live catalogue still render from
   *  the snapshot (so a tracked task keeps its row + time after leaving ClickUp). */
  private knownTasks(): Task[] {
    const merged = new Map<string, Task>()
    for (const [id, t] of this.tasksStore) merged.set(id, t)
    for (const [id, t] of this.catalogue) merged.set(id, t)
    return [...merged.values()]
  }

  private countManualTasks(): number {
    let n = 0
    for (const t of this.tasksStore.values()) if (t.source === 'manual') n++
    return n
  }

  private upsertStore(task: Task): void {
    this.tasksStore.set(task.id, task)
    this.persistStore()
  }

  private persistStore(): void {
    writeTasksStore(this.dir, [...this.tasksStore.values()])
  }

  private append(event: WorklogEvent): void {
    this.events.push(event)
    appendEvent(this.dir, event)
  }
}
