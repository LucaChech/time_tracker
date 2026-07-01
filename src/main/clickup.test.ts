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
  computeBackoffMs,
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

// ── Stage 5b: resilience (throttle · 429 backoff · per-list skip) ──────────────

const BASE = 'https://api.clickup.com/api/v2'

/** Case-insensitive Headers-like bag (what the 429 backoff reads). */
function headerBag(map: Record<string, string>): { get(name: string): string | null } {
  const lower: Record<string, string> = {}
  for (const k of Object.keys(map)) lower[k.toLowerCase()] = map[k]
  return { get: (name: string) => lower[name.toLowerCase()] ?? null }
}

/** A fake Response with a status, JSON body, and optional headers. */
function res(status: number, body: unknown, headers: Record<string, string> = {}): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headerBag(headers),
    json: async () => body
  }
}

/** Build a fake `fetch` from a per-path handler (receives the path minus the base). */
function handlerFetch(handler: (path: string) => unknown): typeof fetch {
  return (async (input: string) => handler(input.replace(BASE, ''))) as unknown as typeof fetch
}

/** A virtual clock: `now` reads it, `sleep` records the wait AND advances it, so the
 *  throttle + backoff run instantly and deterministically with no real waiting. */
function virtualClock(start = 1_000_000): {
  now: () => number
  sleep: (ms: number) => Promise<void>
  sleeps: number[]
} {
  let t = start
  const sleeps: number[] = []
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
    sleeps
  }
}

describe('computeBackoffMs', () => {
  it('honors X-RateLimit-Reset (epoch seconds) with a small buffer', () => {
    // reset = 1005s, now = 1_000_000ms (1000s) → ~5s wait + 500ms buffer.
    expect(computeBackoffMs(headerBag({ 'x-ratelimit-reset': '1005' }), 1_000_000, 0)).toBe(5_500)
  })

  it('falls back to Retry-After (seconds) when no reset header', () => {
    expect(computeBackoffMs(headerBag({ 'retry-after': '3' }), 1_000_000, 0)).toBe(3_500)
  })

  it('falls back to an attempt-scaled default when no usable header', () => {
    expect(computeBackoffMs(headerBag({}), 1_000_000, 0)).toBe(2_000)
    expect(computeBackoffMs(headerBag({}), 1_000_000, 2)).toBe(6_000)
    expect(computeBackoffMs(undefined, 1_000_000, 0)).toBe(2_000)
  })

  it('never returns negative and caps a bogus/huge header', () => {
    // reset in the PAST (negative wait — clock skew) is unusable → the default
    // backoff, not a tight 0ms retry loop.
    expect(computeBackoffMs(headerBag({ 'x-ratelimit-reset': '1' }), 1_000_000, 0)).toBe(2_000)
    // reset absurdly far in the future → capped, not unbounded.
    expect(computeBackoffMs(headerBag({ 'x-ratelimit-reset': '999999999' }), 1_000_000, 0)).toBe(
      60_000
    )
  })
})

describe('fetchCatalogue — 429 backoff', () => {
  it('honors a 429 with X-RateLimit-Reset, retries, then succeeds', async () => {
    const clock = virtualClock()
    let userCalls = 0
    const fetchFn = handlerFetch((path) => {
      if (path === '/user') {
        userCalls++
        if (userCalls <= 2) {
          // reset 3s past the current virtual now → a positive, bounded wait each time.
          const resetSec = Math.floor(clock.now() / 1000) + 3
          return res(429, {}, { 'x-ratelimit-reset': String(resetSec) })
        }
        return res(200, { user: { id: 42 } })
      }
      if (path === '/team') return res(200, { teams: [] })
      return res(404, {})
    })

    const cat = await fetchCatalogue({
      token: 'pk_x',
      fetchFn,
      now: clock.now,
      sleep: clock.sleep
    })

    expect(userCalls).toBe(3) // two 429s + one success
    expect(clock.sleeps.length).toBe(2) // one backoff per 429
    expect(clock.sleeps.every((s) => s > 0 && s <= 60_000)).toBe(true)
    expect(cat.currentUserId).toBe('42')
    expect(cat.partial).toBe(false)
  })

  it('gives up with a ClickUpApiError(429) after exhausting retries', async () => {
    const clock = virtualClock()
    let calls = 0
    const fetchFn = handlerFetch((path) => {
      if (path === '/user') {
        calls++
        return res(429, {}, { 'retry-after': '1' })
      }
      return res(404, {})
    })

    await expect(
      fetchCatalogue({
        token: 'pk_x',
        fetchFn,
        now: clock.now,
        sleep: clock.sleep,
        maxRetriesPer429: 2
      })
    ).rejects.toMatchObject({ status: 429 })
    expect(calls).toBe(3) // attempts 0,1,2 → the third 429 (attempt==maxRetries) throws
  })
})

describe('fetchCatalogue — per-space / per-list failure skipping', () => {
  const skeleton: Record<string, unknown> = {
    '/user': res(200, { user: { id: 7 } }),
    '/team': res(200, { teams: [{ id: 'T1' }] })
  }

  it('skips a single failing list and flags the catalogue partial (others survive)', async () => {
    const routes: Record<string, unknown> = {
      ...skeleton,
      '/team/T1/space?archived=false': res(200, { spaces: [{ id: 'S1', name: 'Space' }] }),
      '/space/S1/folder?archived=false': res(200, { folders: [] }),
      '/space/S1/list?archived=false': res(200, {
        lists: [
          { id: 'GOOD', name: 'Good List' },
          { id: 'BAD', name: 'Bad List' }
        ]
      }),
      [`/list/GOOD/task?${TASK_QS}&page=0`]: res(200, {
        tasks: [{ id: 'g1', name: 'Good task', assignees: [] }],
        last_page: true
      }),
      [`/list/BAD/task?${TASK_QS}&page=0`]: res(500, {})
    }
    const cat = await fetchCatalogue({
      token: 'pk_x',
      fetchFn: handlerFetch((p) => routes[p] ?? res(404, {}))
    })

    expect(cat.partial).toBe(true)
    expect(cat.tasks.map((t) => t.id)).toEqual(['g1']) // the bad list is skipped, not fatal
  })

  it('skips a whole space whose list listing fails, keeps the other space', async () => {
    const routes: Record<string, unknown> = {
      ...skeleton,
      '/team/T1/space?archived=false': res(200, {
        spaces: [
          { id: 'S1', name: 'Broken Space' },
          { id: 'S2', name: 'Fine Space' }
        ]
      }),
      // S1's folder listing 500s → whole space skipped.
      '/space/S1/folder?archived=false': res(500, {}),
      '/space/S2/folder?archived=false': res(200, { folders: [] }),
      '/space/S2/list?archived=false': res(200, { lists: [{ id: 'L2', name: 'L2' }] }),
      [`/list/L2/task?${TASK_QS}&page=0`]: res(200, {
        tasks: [{ id: 's2t', name: 'From S2', assignees: [] }],
        last_page: true
      })
    }
    const cat = await fetchCatalogue({
      token: 'pk_x',
      fetchFn: handlerFetch((p) => routes[p] ?? res(404, {}))
    })

    expect(cat.partial).toBe(true)
    expect(cat.tasks.map((t) => t.id)).toEqual(['s2t'])
  })

  it('a failure at /user or /team is FATAL (throws, not partial)', async () => {
    const userFail = handlerFetch((p) => (p === '/user' ? res(401, {}) : res(200, {})))
    await expect(fetchCatalogue({ token: 'pk_x', fetchFn: userFail })).rejects.toMatchObject({
      status: 401
    })
  })
})

describe('fetchCatalogue — throttle stays under the request cap', () => {
  it('paces requests via sleep when the sliding window is full, without dropping any', async () => {
    const clock = virtualClock()
    const routes: Record<string, unknown> = {
      '/user': res(200, { user: { id: 1 } }),
      '/team': res(200, { teams: [{ id: 'T1' }] }),
      '/team/T1/space?archived=false': res(200, { spaces: [{ id: 'S1', name: 'S' }] }),
      '/space/S1/folder?archived=false': res(200, { folders: [] }),
      '/space/S1/list?archived=false': res(200, { lists: [{ id: 'L1', name: 'L' }] }),
      [`/list/L1/task?${TASK_QS}&page=0`]: res(200, {
        tasks: [{ id: 'a', name: 'A', assignees: [] }],
        last_page: true
      })
    }
    // 6 GETs with a cap of 2/window → the throttle must sleep to pace them.
    const cat = await fetchCatalogue({
      token: 'pk_x',
      fetchFn: handlerFetch((p) => routes[p] ?? res(404, {})),
      now: clock.now,
      sleep: clock.sleep,
      maxRequestsPerMinute: 2
    })

    expect(clock.sleeps.length).toBeGreaterThan(0) // throttle kicked in
    expect(cat.tasks.map((t) => t.id)).toEqual(['a']) // all requests still completed
    expect(cat.partial).toBe(false)
  })

  it('a 0/negative cap is clamped to 1 — completes instead of busy-looping (would time out)', async () => {
    const clock = virtualClock()
    const routes: Record<string, unknown> = {
      '/user': res(200, { user: { id: 1 } }),
      '/team': res(200, { teams: [] })
    }
    const cat = await fetchCatalogue({
      token: 'pk_x',
      fetchFn: handlerFetch((p) => routes[p] ?? res(404, {})),
      now: clock.now,
      sleep: clock.sleep,
      maxRequestsPerMinute: 0 // clamped to 1 — must not NaN-sleep / spin forever
    })
    expect(cat.currentUserId).toBe('1')
  })
})
