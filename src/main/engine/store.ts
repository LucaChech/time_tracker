/**
 * On-disk persistence for the state engine. The storage directory is injected
 * (the running app passes Electron's `app.getPath('userData')`; tests pass a
 * temp dir), so this module never imports Electron and stays unit-testable with
 * a real filesystem.
 *
 * Three files (IMPLEMENTATION_PLAN.md Phase 2 + Phase 5):
 *  - `worklog.jsonl` — append-only `start`/`stop`/`heartbeat` events, kept across
 *    sessions as history (the source of truth).
 *  - `tasks-store.json` — metadata snapshot of every task that is manual OR has
 *    ever been started, so a tracked task that later leaves the ClickUp catalogue
 *    still renders with its name/space/list/color.
 *  - `clickup-cache.json` (Stage 5b) — the last GOOD full ClickUp catalogue
 *    (`{ currentUserId, fetchedAt, tasks }`), so launch renders instantly from the
 *    cache and then refreshes from the API, and an offline launch still shows the
 *    last-known catalogue. It holds NO secrets (the token lives only in the
 *    `safeStorage`-encrypted `clickup-token.enc`, written by `token-store.ts`).
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
export const CLICKUP_CACHE_FILE = 'clickup-cache.json'

export function worklogPath(dir: string): string {
  return join(dir, WORKLOG_FILE)
}

export function tasksStorePath(dir: string): string {
  return join(dir, TASKS_STORE_FILE)
}

export function clickupCachePath(dir: string): string {
  return join(dir, CLICKUP_CACHE_FILE)
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
    (t.source === 'clickup' || t.source === 'manual') &&
    // Optional Phase-5 filter metadata: validate WHEN present so a corrupt row
    // can't feed a non-string status / a non-array assigneeIds to the filter (whose
    // `.includes` would otherwise misbehave). Absent is fine (manual tasks).
    (t.status === undefined || t.status === null || typeof t.status === 'string') &&
    (t.assigneeIds === undefined ||
      (Array.isArray(t.assigneeIds) && t.assigneeIds.every((a) => typeof a === 'string')))
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

// ── clickup-cache.json (Stage 5b: cache-first / offline launch) ───────────────

/**
 * The last good ClickUp catalogue on disk. Holds the fetched task rows plus the
 * `currentUserId` (so the "Assigned to me" filter works offline, before the first
 * refresh returns) and `fetchedAt` (epoch ms — drives the footer's "refreshed Xm
 * ago"). Never holds the token: secrets live only in the encrypted token store.
 */
export interface ClickUpCache {
  /** The authenticated user id when the catalogue was fetched (filter key). */
  currentUserId: string | null
  /** Epoch ms of the successful fetch this cache came from. */
  fetchedAt: number
  /** The catalogue rows. */
  tasks: Task[]
}

/** Shape-guard the cache envelope, dropping malformed task rows (mirrors
 *  `readTasksStore`) rather than failing the whole cache for one bad row. */
function isClickUpCache(value: unknown): value is ClickUpCache {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    (c.currentUserId === null || typeof c.currentUserId === 'string') &&
    typeof c.fetchedAt === 'number' &&
    Number.isFinite(c.fetchedAt) &&
    c.fetchedAt > 0 &&
    Array.isArray(c.tasks)
  )
}

/** Read the cached catalogue. Returns `null` when missing or corrupt; drops any
 *  individual malformed task row from an otherwise-valid envelope. */
export function readClickUpCache(dir: string): ClickUpCache | null {
  const path = clickupCachePath(dir)
  if (!existsSync(path)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isClickUpCache(parsed)) return null
    return { ...parsed, tasks: parsed.tasks.filter(isTask) }
  } catch {
    return null
  }
}

/** Atomically overwrite the cached catalogue (temp file + rename). */
export function writeClickUpCache(dir: string, cache: ClickUpCache): void {
  ensureDir(dir)
  const path = clickupCachePath(dir)
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8')
  renameSync(tmp, path)
}
