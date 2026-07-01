/**
 * Unit tests for the ClickUp READ client (Stage 5a). Network is INJECTED (a fake
 * `fetchFn` returning canned JSON), so the full traversal — pagination, dedupe,
 * breadcrumb resolution, mapping — is exercised deterministically with no live
 * calls. The live real-data check is scripts/clickup-verify.mjs.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CLICKUP_PALETTE,
  ClickUpApiError,
  colorForList,
  fetchCatalogue,
  mapTask,
  parseTokenFromEnv,
  resolveToken
} from './clickup'

// ── token parsing / resolution ───────────────────────────────────────────────

describe('parseTokenFromEnv', () => {
  it('extracts CLICKUP_TOKEN and tolerates quotes / whitespace / CRLF / other keys', () => {
    expect(parseTokenFromEnv('CLICKUP_TOKEN=pk_abc')).toBe('pk_abc')
    expect(parseTokenFromEnv('  CLICKUP_TOKEN = "pk_xyz" \r\n')).toBe('pk_xyz')
    expect(parseTokenFromEnv("OTHER=1\nCLICKUP_TOKEN='pk_q'\nMORE=2")).toBe('pk_q')
  })

  it('returns null when absent or empty', () => {
    expect(parseTokenFromEnv('NOPE=1')).toBeNull()
    expect(parseTokenFromEnv('CLICKUP_TOKEN=')).toBeNull()
    expect(parseTokenFromEnv('CLICKUP_TOKEN=   ')).toBeNull()
  })
})

describe('resolveToken', () => {
  const saved = process.env.CLICKUP_TOKEN
  afterEach(() => {
    if (saved === undefined) delete process.env.CLICKUP_TOKEN
    else process.env.CLICKUP_TOKEN = saved
  })

  it('prefers process.env.CLICKUP_TOKEN', () => {
    process.env.CLICKUP_TOKEN = 'pk_env'
    expect(resolveToken('/nonexistent-dir')).toBe('pk_env')
  })

  it('falls back to <dir>/.env.local, and is null when neither exists', () => {
    delete process.env.CLICKUP_TOKEN
    const dir = mkdtempSync(join(tmpdir(), 'cadence-token-'))
    try {
      expect(resolveToken(dir)).toBeNull() // no file yet
      writeFileSync(join(dir, '.env.local'), 'CLICKUP_TOKEN=pk_file\n')
      expect(resolveToken(dir)).toBe('pk_file')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── deterministic color ──────────────────────────────────────────────────────

describe('colorForList', () => {
  it('is deterministic, stable, and always a palette member', () => {
    for (const id of ['L1', 'L2', '901218910949', 'anything']) {
      const c = colorForList(id)
      expect(CLICKUP_PALETTE).toContain(c)
      expect(colorForList(id)).toBe(c) // stable across calls (run-to-run)
    }
  })

  it('spreads across the palette (not a constant)', () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => colorForList(`list-${i}`)))
    expect(seen.size).toBeGreaterThan(1)
  })
})

// ── mapping ──────────────────────────────────────────────────────────────────

describe('mapTask', () => {
  const ctx = { space: 'Space One', list: 'My List', listId: 'L1' }

  it('takes breadcrumb from ctx, normalizes assignees to strings, reads nested status', () => {
    const t = mapTask(
      {
        id: 869,
        name: 'Do the thing',
        custom_id: null,
        status: { status: 'in progress' },
        // Note: the task's own `space` field is name-less and must be ignored.
        assignees: [{ id: 999 }, { id: 5 }]
      } as never,
      ctx
    )
    expect(t.space).toBe('Space One')
    expect(t.list).toBe('My List')
    expect(t.id).toBe('869')
    expect(t.code).toBeNull()
    expect(t.status).toBe('in progress')
    expect(t.assigneeIds).toEqual(['999', '5'])
    expect(t.color).toBe(colorForList('L1'))
    expect(t.source).toBe('clickup')
  })

  it('maps a present custom_id to code and falls back for a missing name', () => {
    const t = mapTask({ id: 'x', custom_id: 'CU-42', assignees: null } as never, ctx)
    expect(t.code).toBe('CU-42')
    expect(t.name).toBe('(untitled)')
    expect(t.assigneeIds).toEqual([])
    expect(t.status).toBeNull()
  })
})

// ── full traversal via injected fetch ────────────────────────────────────────

/** Build a fake `fetch` from a path→data table. Throws (as a non-ok Response) for
 *  any unrouted path so a wrong URL surfaces loudly. */
function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: string) => {
    const path = input.replace('https://api.clickup.com/api/v2', '')
    if (!(path in routes)) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => routes[path] }
  }) as unknown as typeof fetch
}

const TASK_QS = 'subtasks=true&include_closed=false&archived=false'

describe('fetchCatalogue', () => {
  it('traverses folders + folderless lists, paginates, dedupes first-breadcrumb-wins, maps correctly', async () => {
    // L2 page 0: exactly 100 tasks (forces a second page). page 1: a DUPLICATE of
    // L1's task 'a' (must be dropped, keeping L1's breadcrumb) + one fresh task.
    const l2page0 = Array.from({ length: 100 }, (_, i) => ({
      id: `b${i}`,
      name: `B${i}`,
      custom_id: i === 0 ? 'CU-1' : null,
      status: { status: 'to do' },
      assignees: []
    }))
    const routes: Record<string, unknown> = {
      '/user': { user: { id: 999 } },
      '/team': { teams: [{ id: 'T1' }] },
      '/team/T1/space?archived=false': {
        spaces: [
          { id: 'S1', name: 'Space One' },
          { id: 'S2', name: 'Space Two' }
        ]
      },
      '/space/S1/folder?archived=false': {
        folders: [{ lists: [{ id: 'L1', name: 'List In Folder' }] }]
      },
      '/space/S1/list?archived=false': { lists: [{ id: 'L2', name: 'Folderless List' }] },
      '/space/S2/folder?archived=false': { folders: [] },
      '/space/S2/list?archived=false': { lists: [{ id: 'L3', name: 'Second Space List' }] },
      [`/list/L1/task?${TASK_QS}&page=0`]: {
        tasks: [
          {
            id: 'a',
            name: 'Shared task',
            custom_id: null,
            status: { status: 'to do' },
            assignees: [{ id: 999 }, { id: 7 }]
          }
        ],
        last_page: true
      },
      [`/list/L2/task?${TASK_QS}&page=0`]: { tasks: l2page0, last_page: false },
      [`/list/L2/task?${TASK_QS}&page=1`]: {
        tasks: [
          { id: 'a', name: 'Shared task (dup in L2)', assignees: [] }, // duplicate → dropped
          { id: 'b100', name: 'B100', assignees: [] }
        ],
        last_page: true
      },
      [`/list/L3/task?${TASK_QS}&page=0`]: {
        tasks: [{ id: 'c', name: '', assignees: null, status: null }],
        last_page: true
      }
    }

    const { currentUserId, tasks } = await fetchCatalogue({
      token: 'pk_test',
      fetchFn: fakeFetch(routes)
    })

    expect(currentUserId).toBe('999')

    // Count: L1 (a) + L2 (b0..b99 = 100, plus b100 = 1; 'a' dup dropped) + L3 (c) = 103.
    expect(tasks.length).toBe(103)
    const ids = tasks.map((t) => t.id)
    expect(new Set(ids).size).toBe(103) // all unique

    // Dedupe first-breadcrumb-wins: the single 'a' keeps L1's breadcrumb.
    const a = tasks.filter((t) => t.id === 'a')
    expect(a).toHaveLength(1)
    expect(a[0].space).toBe('Space One')
    expect(a[0].list).toBe('List In Folder')
    expect(a[0].assigneeIds).toEqual(['999', '7'])
    expect(a[0].color).toBe(colorForList('L1'))

    // custom_id → code on b0; pagination reached b100.
    expect(tasks.find((t) => t.id === 'b0')?.code).toBe('CU-1')
    expect(tasks.find((t) => t.id === 'b100')).toBeDefined()

    // Second space + name fallback + null assignees.
    const c = tasks.find((t) => t.id === 'c')
    expect(c?.space).toBe('Space Two')
    expect(c?.list).toBe('Second Space List')
    expect(c?.name).toBe('(untitled)')
    expect(c?.assigneeIds).toEqual([])
    expect(c?.status).toBeNull()

    // Per-list color consistency: all L2 tasks share one color.
    const l2colors = new Set(tasks.filter((t) => t.id.startsWith('b')).map((t) => t.color))
    expect(l2colors.size).toBe(1)
    expect(l2colors.has(colorForList('L2'))).toBe(true)
  })

  it('throws a ClickUpApiError (with status, no token) on a non-2xx response', async () => {
    const fetchFn = (async () => ({
      ok: false,
      status: 401,
      json: async () => ({})
    })) as unknown as typeof fetch
    await expect(fetchCatalogue({ token: 'pk_bad', fetchFn })).rejects.toBeInstanceOf(
      ClickUpApiError
    )
    await expect(fetchCatalogue({ token: 'pk_bad', fetchFn })).rejects.toMatchObject({
      status: 401
    })
  })
})
