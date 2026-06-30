/**
 * On-disk persistence for the state engine. The storage directory is injected
 * (the running app passes Electron's `app.getPath('userData')`; tests pass a
 * temp dir), so this module never imports Electron and stays unit-testable with
 * a real filesystem.
 *
 * Two files (IMPLEMENTATION_PLAN.md Phase 2):
 *  - `worklog.jsonl` — append-only `start`/`stop`/`heartbeat` events, kept across
 *    sessions as history (the source of truth).
 *  - `tasks-store.json` — metadata snapshot of every task that is manual OR has
 *    ever been started, so a tracked task that later leaves the ClickUp catalogue
 *    still renders with its name/space/list/color.
 *
 * (`clickup-cache.json` is a Phase-5 concern and intentionally not here yet.)
 *
 * Reads are defensive: a malformed `worklog.jsonl` line is skipped (never
 * crashes, never yields NaN downstream) and a corrupt `tasks-store.json` is
 * treated as empty rather than throwing. Writes to `tasks-store.json` are atomic
 * (write a temp file, then rename over the target).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  appendFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { EventAction, EventSource, Task, WorklogEvent } from '@shared/types'

export const WORKLOG_FILE = 'worklog.jsonl'
export const TASKS_STORE_FILE = 'tasks-store.json'

export function worklogPath(dir: string): string {
  return join(dir, WORKLOG_FILE)
}

export function tasksStorePath(dir: string): string {
  return join(dir, TASKS_STORE_FILE)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

const ACTIONS: ReadonlySet<string> = new Set<EventAction>(['start', 'stop', 'heartbeat'])
const SOURCES: ReadonlySet<string> = new Set<EventSource>([
  'user',
  'suspend',
  'lock',
  'quit',
  'crash-close',
  'heartbeat'
])

/**
 * Parse + validate one worklog line. Returns null for anything malformed so a
 * single corrupt line can be skipped without poisoning the replay. Guarantees a
 * POSITIVE finite numeric `ts` (epoch-ms is always > 0 — a non-positive value is
 * corrupt and would otherwise feed bogus intervals and the `max(ts)` crash-close),
 * a known `action`, a string-or-null `taskId` (non-null for start/stop), and a
 * known `source` (heartbeat lines default to `'heartbeat'`, others to `'user'`).
 */
export function parseEventLine(line: string): WorklogEvent | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>

  if (typeof o.ts !== 'number' || !Number.isFinite(o.ts) || o.ts <= 0) return null
  if (typeof o.action !== 'string' || !ACTIONS.has(o.action)) return null
  const action = o.action as EventAction

  const taskId = typeof o.taskId === 'string' ? o.taskId : null
  if (action !== 'heartbeat' && taskId === null) return null // start/stop must name a task

  const fallbackSource: EventSource = action === 'heartbeat' ? 'heartbeat' : 'user'
  const source: EventSource =
    typeof o.source === 'string' && SOURCES.has(o.source)
      ? (o.source as EventSource)
      : fallbackSource

  return { ts: o.ts, taskId, action, source }
}

/** Read the full event log in append order, skipping malformed lines. Returns
 *  `[]` when the file does not exist yet. */
export function readWorklog(dir: string): WorklogEvent[] {
  const path = worklogPath(dir)
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  const events: WorklogEvent[] = []
  for (const line of text.split('\n')) {
    const ev = parseEventLine(line)
    if (ev !== null) events.push(ev)
  }
  return events
}

/** Append one event as a JSONL line (creating the dir/file if needed). */
export function appendEvent(dir: string, event: WorklogEvent): void {
  ensureDir(dir)
  appendFileSync(worklogPath(dir), JSON.stringify(event) + '\n', 'utf8')
}

/** Shape-guard one task entry: every field the UI/sort relies on must be present
 *  and the right type, so a corrupt/partial row can't surface as a `name:undefined`
 *  card or a `space:undefined` sort key. */
function isTask(value: unknown): value is Task {
  if (typeof value !== 'object' || value === null) return false
  const t = value as Record<string, unknown>
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.space === 'string' &&
    typeof t.list === 'string' &&
    (typeof t.code === 'string' || t.code === null) &&
    typeof t.color === 'string' &&
    typeof t.glyph === 'string' &&
    (t.source === 'clickup' || t.source === 'manual')
  )
}

/** Read the task metadata snapshot. Returns `[]` if missing or corrupt, and drops
 *  any individual malformed row (mirrors the worklog's per-line skipping). */
export function readTasksStore(dir: string): Task[] {
  const path = tasksStorePath(dir)
  if (!existsSync(path)) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter(isTask) : []
  } catch {
    return []
  }
}

/** Atomically overwrite the task metadata snapshot. */
export function writeTasksStore(dir: string, tasks: readonly Task[]): void {
  ensureDir(dir)
  const path = tasksStorePath(dir)
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf8')
  renameSync(tmp, path) // libuv rename replaces an existing file on Windows + POSIX
}
