/**
 * ClickUp READ client (Cadence Phase 5 / Stage 5a).
 *
 * Fetches the task catalogue — ALL open tasks + subtasks across every authorized
 * workspace, space and list — and maps it to the local {@link Task} model. v0 is
 * strictly read-only: this module issues GETs only and NEVER touches ClickUp's
 * live timer or writes a time entry (the single-live-timer constraint — see
 * CLAUDE.md). The push-ready seam exists but ships nothing.
 *
 * Design (mirrors the engine): **no Electron import**, all I/O injected. The
 * traversal takes an injected `fetchFn` and the token as plain data, so the whole
 * client — token parsing, pagination, dedupe, breadcrumb resolution, mapping — is
 * unit-testable under Vitest with a fake fetch and no network (see
 * clickup.test.ts), and re-runnable live against the real workspace with the
 * `.env.local` token (see scripts/clickup-verify.mjs).
 *
 * Verified ClickUp v2 facts this client is built to (re-confirmed live against
 * Luca's Free-plan workspace 2026-07-01, and the current docs):
 *  - Auth: personal `pk_` token in the `Authorization` header, **no `Bearer`**.
 *  - Get Tasks (`/list/{id}/task`) paginates with `page` (0-indexed), 100/page,
 *    and the response carries a `last_page` boolean; we stop on `last_page === true`
 *    OR a short page (< 100) as a belt-and-suspenders.
 *  - A task's own `space` field is `{ id }` only — **no name** — so the
 *    `Space › List` breadcrumb is taken from the per-list TRAVERSAL context (which
 *    knows the space name), not from the task. This is why per-list traversal is
 *    mandated. `task.list` does carry `{ id, name }`.
 *  - Folderless lists report a synthetic `folder: { name: "hidden" }`; we ignore
 *    the folder entirely (breadcrumb is Space › List) so "hidden" never shows.
 *  - `custom_id` is `null` on Free/non-Business workspaces → the `code` chip hides.
 *  - Lists have no API `color` → card color is a deterministic LOCAL palette hashed
 *    by list-id (a list keeps the same color run-to-run).
 *  - `user.id` and `assignees[].id` are NUMBERS → normalized to strings so they
 *    compare cleanly against the filter's string `currentUserId`.
 *
 * Deferred to Stage 5b (do not add here): cache-first launch, manual refresh,
 * 100-req/min throttle, `429` / `X-RateLimit-Reset` backoff, per-list failure
 * skipping, the "Connect ClickUp" empty state, and the `safeStorage`-encrypted
 * in-app token field. 5a fetches once and either returns the real catalogue or
 * throws; the caller degrades non-fatally.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Task } from '@shared/types'

/** ClickUp API v2 base. */
export const CLICKUP_BASE = 'https://api.clickup.com/api/v2'

/** Per-request timeout (ms). Bounds each GET so a hung connection can't stall the
 *  launch fetch or the verify harness. Not a retry/backoff policy — that's Stage 5b. */
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000

/**
 * The card palette for ClickUp lists — the exact five signed-off `3a` card colors
 * (design tokens "Kinetic Logic"). **No green** (hard design rule). A list-id is
 * hashed into this palette deterministically, so a list keeps its color run-to-run
 * and tasks inherit their list's color.
 */
export const CLICKUP_PALETTE = ['#0058bc', '#fe9400', '#c64f00', '#4b3fb0', '#0091b3'] as const

/** Glyph for ClickUp catalogue rows. `glyph` is carried but not currently rendered
 *  (the UI shows the breadcrumb icon, not a per-task glyph); a valid, stable
 *  Material Symbols name keeps the data model well-formed. */
const CLICKUP_GLYPH = 'task_alt'

/** Raised when a ClickUp GET returns a non-2xx status. Carries the status (for the
 *  caller to branch on, e.g. 401/403 auth vs 429 rate-limit in 5b) and the path —
 *  **never the token** (which lives only in the request header, never in a URL or
 *  message), so an error can be logged safely on a public-repo build. */
export class ClickUpApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string
  ) {
    super(`ClickUp GET ${path} failed with HTTP ${status}`)
    this.name = 'ClickUpApiError'
  }
}

// ── token resolution ─────────────────────────────────────────────────────────

/** Extract `CLICKUP_TOKEN` from a `.env.local`-style file body. Tolerates
 *  surrounding quotes/whitespace and CRLF; returns null if absent/empty. Kept pure
 *  (takes the file text, not a path) so it is trivially unit-testable.
 *  NOTE: `scripts/clickup-verify.mjs` keeps a copy of this parse (it runs before the
 *  TS build and can't import this module) — keep the two rules in sync. */
export function parseTokenFromEnv(fileText: string): string | null {
  const m = fileText.match(/^\s*CLICKUP_TOKEN\s*=\s*(.*)\s*$/m)
  if (!m) return null
  const raw = m[1]
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
  return raw.length > 0 ? raw : null
}

/**
 * Resolve the ClickUp token for a DEV / unpackaged run. Precedence:
 *   1. `process.env.CLICKUP_TOKEN` (lets a harness/CI inject it without file I/O);
 *   2. `<envDir>/.env.local` (the untracked dev secret file).
 * `envDir` defaults to the process cwd, but the app's callers pass
 * `app.getAppPath()` — the app root, which is the project root under
 * `electron-vite dev` / `electron .` (so `.env.local` resolves there), and inside
 * the packaged asar/resources in a shipped build (where no `.env.local` exists →
 * `null` → the fetch is skipped, deferring to the Stage-5b `safeStorage` token +
 * "Connect ClickUp" prompt). Returns null when neither source yields a token; the
 * token is treated as opaque and is never logged.
 */
export function resolveToken(envDir: string = process.cwd()): string | null {
  const fromEnv = process.env.CLICKUP_TOKEN?.trim()
  if (fromEnv) return fromEnv
  const path = join(envDir, '.env.local')
  if (!existsSync(path)) return null
  try {
    return parseTokenFromEnv(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// ── deterministic list-id → color ────────────────────────────────────────────

/** Stable, platform-independent string hash (djb2, folded to uint32). Deterministic
 *  across runs/machines so a list's color never changes between launches. */
function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return h >>> 0
}

/** Deterministic card color for a list, hashed by its id into {@link CLICKUP_PALETTE}. */
export function colorForList(listId: string): string {
  return CLICKUP_PALETTE[hashString(listId) % CLICKUP_PALETTE.length]
}

// ── minimal raw response shapes (only the fields we read) ─────────────────────

interface RawUser {
  user?: { id?: number | string }
}
interface RawTeams {
  teams?: Array<{ id?: string | number }>
}
interface RawSpaces {
  spaces?: Array<{ id?: string | number; name?: string }>
}
interface RawList {
  id?: string | number
  name?: string
}
interface RawFolders {
  folders?: Array<{ lists?: RawList[] }>
}
interface RawLists {
  lists?: RawList[]
}
interface RawTask {
  id?: string | number
  name?: string
  custom_id?: string | null
  status?: { status?: string | null } | null
  assignees?: Array<{ id?: string | number }> | null
}
interface RawTaskPage {
  tasks?: RawTask[]
  last_page?: boolean
}

/** The list breadcrumb context carried from the traversal into each task's mapping. */
interface ListContext {
  /** Space NAME (resolved from the space traversal — a task can't supply it). */
  space: string
  /** List NAME. */
  list: string
  /** List id — the key the deterministic color is hashed from. */
  listId: string
}

/** The result of a full catalogue fetch. */
export interface Catalogue {
  /** The authenticated user's id (as a string) — the "Assigned to me" filter key. */
  currentUserId: string
  /** All open tasks + subtasks across every space/list, deduped by id. */
  tasks: Task[]
}

/** Injected dependencies for {@link fetchCatalogue} — the token plus optional
 *  overrides for `fetch`, the base URL, and the per-request timeout, so tests drive
 *  a fake transport. */
export interface FetchCatalogueDeps {
  token: string
  fetchFn?: typeof fetch
  base?: string
  /** Per-request timeout in ms (default {@link DEFAULT_REQUEST_TIMEOUT_MS}). */
  perRequestTimeoutMs?: number
}

// ── mapping ──────────────────────────────────────────────────────────────────

/**
 * Map one raw ClickUp task + its list breadcrumb to a local {@link Task}. Pure.
 * - `space`/`list` come from `ctx` (the traversal), never from the task's own
 *   name-less `space` field.
 * - `code` = `custom_id` when it is a non-empty string, else `null` (chip hidden).
 * - `color` is the list's deterministic palette color.
 * - `status`/`assigneeIds` are carried through for the Stage-5b PAUSED filter;
 *   assignee ids are normalized to strings (the API returns numbers).
 */
export function mapTask(raw: RawTask, ctx: ListContext): Task {
  const code = typeof raw.custom_id === 'string' && raw.custom_id.length > 0 ? raw.custom_id : null
  const status = typeof raw.status?.status === 'string' ? raw.status.status : null
  const assigneeIds = (Array.isArray(raw.assignees) ? raw.assignees : [])
    .map((a) => (a?.id === undefined || a?.id === null ? null : String(a.id)))
    .filter((x): x is string => x !== null)
  return {
    id: String(raw.id),
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : '(untitled)',
    space: ctx.space,
    list: ctx.list,
    code,
    color: colorForList(ctx.listId),
    glyph: CLICKUP_GLYPH,
    source: 'clickup',
    status,
    assigneeIds
  }
}

// ── traversal ────────────────────────────────────────────────────────────────

/**
 * Fetch the whole catalogue via the mandated per-list traversal:
 *   `/user` → `/team` → per space (`/team/{id}/space`) → per space's lists
 *   (`/space/{id}/folder` folders' lists + `/space/{id}/list` folderless) → per list
 *   (`/list/{id}/task`, paginated).
 * Tasks are deduped by id with **first-breadcrumb-wins**: the first list reached in
 * traversal order supplies a repeated task's breadcrumb. Traversal follows
 * ClickUp's RETURNED ordering of teams/spaces/lists (not independently sorted), so
 * a task genuinely in multiple lists resolves stably only as far as that ordering
 * is stable — the card COLOR is stable regardless (hashed by list-id). On the
 * Free-plan target one task has one list, so dedupe here only ever collapses
 * pagination/subtask repeats, which already share a breadcrumb.
 * Read-only; propagates a {@link ClickUpApiError} on any non-2xx (the caller
 * degrades — resilience/backoff is Stage 5b). Each request is bounded by a
 * per-request timeout so a hung connection can't stall launch indefinitely.
 */
export async function fetchCatalogue(deps: FetchCatalogueDeps): Promise<Catalogue> {
  const fetchFn = deps.fetchFn ?? fetch
  const base = deps.base ?? CLICKUP_BASE
  const timeoutMs = deps.perRequestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  const get = async <T>(path: string): Promise<T> => {
    // A per-request deadline (not full retry/backoff — that's Stage 5b): a clean
    // throw beats an unbounded await if a connection hangs. `AbortSignal.timeout`
    // aborts the fetch after `timeoutMs`, surfacing as a rejection the caller
    // handles (non-fatal on launch; a clean, attributable FAIL in the harness).
    const res = await fetchFn(base + path, {
      headers: { Authorization: deps.token },
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) throw new ClickUpApiError(res.status, path)
    try {
      return (await res.json()) as T
    } catch {
      // A 2xx with a non-JSON body (proxy interstitial, empty response) surfaces
      // through the typed error channel rather than as a raw SyntaxError.
      throw new ClickUpApiError(res.status, path)
    }
  }

  const user = await get<RawUser>('/user')
  const currentUserId = user.user?.id === undefined ? '' : String(user.user.id)

  const seen = new Set<string>()
  const tasks: Task[] = []

  // ClickUp-supplied ids are URL-encoded before interpolation — the base host is
  // fixed, but a malformed id must never reshape the request path.
  const teams = (await get<RawTeams>('/team')).teams ?? []
  for (const team of teams) {
    if (team.id === undefined || team.id === null) continue
    const teamId = encodeURIComponent(String(team.id))
    const spaces = (await get<RawSpaces>(`/team/${teamId}/space?archived=false`)).spaces ?? []
    for (const space of spaces) {
      if (space.id === undefined || space.id === null) continue
      const spaceId = encodeURIComponent(String(space.id))
      const spaceName = typeof space.name === 'string' ? space.name : '(space)'

      // Lists in folders, then folderless lists — one deterministic order.
      const lists: RawList[] = []
      const folders =
        (await get<RawFolders>(`/space/${spaceId}/folder?archived=false`)).folders ?? []
      for (const folder of folders) for (const l of folder.lists ?? []) lists.push(l)
      const folderless = (await get<RawLists>(`/space/${spaceId}/list?archived=false`)).lists ?? []
      for (const l of folderless) lists.push(l)

      for (const list of lists) {
        if (list.id === undefined || list.id === null) continue
        const ctx: ListContext = {
          space: spaceName,
          list: typeof list.name === 'string' ? list.name : '(list)',
          listId: String(list.id)
        }
        for (const raw of await fetchAllListTasks(get, String(list.id))) {
          const id = String(raw.id)
          if (raw.id === undefined || raw.id === null || seen.has(id)) continue
          seen.add(id) // first breadcrumb wins
          tasks.push(mapTask(raw, ctx))
        }
      }
    }
  }

  return { currentUserId, tasks }
}

/** Page through one list's open tasks + subtasks. Stops on `last_page === true`
 *  OR a short page (< 100), with a hard page cap as a runaway guard. */
async function fetchAllListTasks(
  get: <T>(path: string) => Promise<T>,
  listId: string
): Promise<RawTask[]> {
  const PAGE_SIZE = 100
  const MAX_PAGES = 200 // guard: 200 × 100 = 20k tasks/list is far beyond any real list
  const encodedListId = encodeURIComponent(listId)
  const all: RawTask[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await get<RawTaskPage>(
      `/list/${encodedListId}/task?subtasks=true&include_closed=false&archived=false&page=${page}`
    )
    const batch = Array.isArray(body.tasks) ? body.tasks : []
    all.push(...batch)
    if (body.last_page === true || batch.length < PAGE_SIZE) break
  }
  return all
}
