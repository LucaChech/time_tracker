/**
 * Stage-2 correctness gate — the pure derivation math (VERIFICATION_SPINE.md
 * Stage 2, the riskiest stage). Covers the plan's acceptance set PLUS the
 * spine's `missing_checks`: exactly-touching intervals, zero-length intervals,
 * corrupt log lines (never NaN), the pre-session open-interval boundary, a large
 * stable PAUSED sort, and a per-render perf guard.
 */

import { describe, it, expect } from 'vitest'
import type { Interval, Task, TaskRow, WorklogEvent } from '@shared/types'
import { comparePaused, deriveState, mergeIntervals, replay } from './derive'

const T0 = 1_700_000_000_000 // fixed epoch ms base
const S = 1000 // one second in ms
const HOUR = 3600 * S

const NO_REMOVED: ReadonlySet<string> = new Set()

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    name: over.name ?? id,
    space: over.space ?? 'Space',
    list: over.list ?? 'List',
    code: over.code ?? null,
    color: over.color ?? '#0091b3',
    glyph: over.glyph ?? 'task_alt',
    source: over.source ?? 'clickup'
  }
}

function ev(ts: number, taskId: string | null, action: WorklogEvent['action']): WorklogEvent {
  return { ts, taskId, action, source: action === 'heartbeat' ? 'heartbeat' : 'user' }
}

function row(over: Partial<TaskRow> & { id: string }): TaskRow {
  return {
    ...task(over.id, over),
    running: over.running ?? false,
    sessionElapsedMs: over.sessionElapsedMs ?? 0,
    allTimeElapsedMs: over.allTimeElapsedMs ?? 0,
    lastStartTs: over.lastStartTs ?? null
  }
}

describe('mergeIntervals — the union edge', () => {
  it('returns [] for no intervals', () => {
    expect(mergeIntervals([])).toEqual([])
  })

  it('merges EXACTLY-touching intervals (stopA === startB) into one — no gap, no double', () => {
    const merged = mergeIntervals([
      { start: 0, end: 100 },
      { start: 100, end: 200 }
    ])
    expect(merged).toEqual([{ start: 0, end: 200 }])
  })

  it('merges overlapping intervals (so parallel work is not double-counted)', () => {
    const merged = mergeIntervals([
      { start: 0, end: 100 },
      { start: 50, end: 150 }
    ])
    expect(merged).toEqual([{ start: 0, end: 150 }])
  })

  it('preserves a genuine gap as two intervals', () => {
    const merged = mergeIntervals([
      { start: 0, end: 100 },
      { start: 200, end: 300 }
    ])
    expect(merged).toEqual([
      { start: 0, end: 100 },
      { start: 200, end: 300 }
    ])
  })

  it('is order-independent (unsorted input merges the same)', () => {
    const ivs: Interval[] = [
      { start: 200, end: 300 },
      { start: 0, end: 100 },
      { start: 90, end: 210 }
    ]
    expect(mergeIntervals(ivs)).toEqual([{ start: 0, end: 300 }])
  })
})

describe('session union total = "how long I worked" (no double-count)', () => {
  it('3 tasks × 1h fully parallel ⇒ session total = 1h', () => {
    const tasks = [task('a'), task('b'), task('c')]
    const events = tasks.flatMap((t) => [ev(T0, t.id, 'start'), ev(T0 + HOUR, t.id, 'stop')])
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0,
      now: T0 + 2 * HOUR,
      removed: NO_REMOVED
    })
    expect(state.sessionWorkedMs).toBe(HOUR)
    // each task individually still records its own full hour
    for (const r of state.paused) expect(r.sessionElapsedMs).toBe(HOUR)
  })

  it('independent parallel timers report independent per-task elapsed', () => {
    const tasks = [task('a'), task('b')]
    const events = [
      ev(T0, 'a', 'start'),
      ev(T0, 'b', 'start'),
      ev(T0 + 100 * S, 'a', 'stop'),
      ev(T0 + 200 * S, 'b', 'stop')
    ]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0,
      now: T0 + 300 * S,
      removed: NO_REMOVED
    })
    const byId = new Map(state.paused.map((r) => [r.id, r]))
    expect(byId.get('a')!.sessionElapsedMs).toBe(100 * S)
    expect(byId.get('b')!.sessionElapsedMs).toBe(200 * S)
    expect(state.sessionWorkedMs).toBe(200 * S) // union, b contains a's window
  })

  it('staggered overlap unions correctly (a:[0,100] b:[50,150] ⇒ 150s)', () => {
    const tasks = [task('a'), task('b')]
    const events = [
      ev(T0, 'a', 'start'),
      ev(T0 + 100 * S, 'a', 'stop'),
      ev(T0 + 50 * S, 'b', 'start'),
      ev(T0 + 150 * S, 'b', 'stop')
    ]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0,
      now: T0 + 200 * S,
      removed: NO_REMOVED
    })
    expect(state.sessionWorkedMs).toBe(150 * S)
  })
})

describe('session-scope boundary (ts ≥ sessionStartTs)', () => {
  it('an open interval that began before the session counts only from sessionStartTs', () => {
    const tasks = [task('a')]
    const events = [ev(T0, 'a', 'start')] // still running, no stop
    const sessionStartTs = T0 + 50 * S
    const now = T0 + 200 * S
    const state = deriveState({ events, tasks, sessionStartTs, now, removed: NO_REMOVED })
    const a = state.active[0]
    expect(a.running).toBe(true)
    expect(a.sessionElapsedMs).toBe(150 * S) // now - sessionStartTs, NOT now - T0
    expect(a.allTimeElapsedMs).toBe(200 * S) // whole log
  })

  it('a closed interval entirely before the session contributes 0 to session, full to all-time', () => {
    const tasks = [task('a')]
    const events = [ev(T0, 'a', 'start'), ev(T0 + 100 * S, 'a', 'stop')]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0 + 500 * S,
      now: T0 + 600 * S,
      removed: NO_REMOVED
    })
    const a = state.paused[0]
    expect(a.sessionElapsedMs).toBe(0)
    expect(a.allTimeElapsedMs).toBe(100 * S)
  })
})

describe('zero-length and clock-step defenses (never negative, never NaN)', () => {
  it('a zero-length interval (start === stop) contributes 0 and does not destabilise', () => {
    const tasks = [task('a')]
    const events = [ev(T0, 'a', 'start'), ev(T0, 'a', 'stop')]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0 - 10 * S,
      now: T0 + 10 * S,
      removed: NO_REMOVED
    })
    const a = state.paused[0]
    expect(a.sessionElapsedMs).toBe(0)
    expect(a.allTimeElapsedMs).toBe(0)
    expect(state.sessionWorkedMs).toBe(0)
  })

  it('a backwards clock step (stop < start) clamps to 0, never negative', () => {
    const tasks = [task('a')]
    const events = [ev(T0 + 100 * S, 'a', 'start'), ev(T0, 'a', 'stop')]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0 - 10 * S,
      now: T0 + 200 * S,
      removed: NO_REMOVED
    })
    const a = state.paused[0]
    expect(a.sessionElapsedMs).toBe(0)
    expect(a.allTimeElapsedMs).toBe(0)
    expect(Number.isNaN(a.sessionElapsedMs)).toBe(false)
  })

  it('an open interval where now < start clamps to 0', () => {
    const tasks = [task('a')]
    const events = [ev(T0 + 200 * S, 'a', 'start')]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0,
      now: T0 + 100 * S, // before the start
      removed: NO_REMOVED
    })
    const a = state.active[0]
    expect(a.sessionElapsedMs).toBe(0)
    expect(a.allTimeElapsedMs).toBe(0)
  })
})

describe('corrupt / idempotent event sequences (handled, never NaN)', () => {
  it('a stop with no preceding start is ignored', () => {
    const tasks = [task('a')]
    const events = [ev(T0, 'a', 'stop')]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0 - S,
      now: T0 + S,
      removed: NO_REMOVED
    })
    const a = state.paused[0]
    expect(a.running).toBe(false)
    expect(a.sessionElapsedMs).toBe(0)
    expect(state.runningCount).toBe(0)
  })

  it('a start with no stop is an open (running) interval', () => {
    const tl = replay([ev(T0, 'a', 'start')]).get('a')!
    expect(tl.open).toBe(T0)
    expect(tl.intervals).toHaveLength(0)
  })

  it('a redundant double start opens only one interval (idempotent in replay)', () => {
    const tl = replay([
      ev(T0, 'a', 'start'),
      ev(T0 + 10 * S, 'a', 'start'),
      ev(T0 + 100 * S, 'a', 'stop')
    ]).get('a')!
    expect(tl.intervals).toEqual([{ start: T0, end: T0 + 100 * S }])
    expect(tl.open).toBeNull()
    expect(tl.lastStartTs).toBe(T0) // the start that actually opened the interval
  })

  it('a redundant double stop closes only once', () => {
    const tl = replay([
      ev(T0, 'a', 'start'),
      ev(T0 + 100 * S, 'a', 'stop'),
      ev(T0 + 200 * S, 'a', 'stop')
    ]).get('a')!
    expect(tl.intervals).toEqual([{ start: T0, end: T0 + 100 * S }])
    expect(tl.open).toBeNull()
  })

  it('heartbeat events never affect running-state', () => {
    const tl = replay([ev(T0, null, 'heartbeat'), ev(T0 + S, 'a', 'start')]).get('a')!
    expect(tl.open).toBe(T0 + S)
  })
})

describe('ACTIVE / PAUSED selection + ordering', () => {
  it('ACTIVE is most-recently-started first', () => {
    const tasks = [task('a'), task('b'), task('c')]
    const events = [
      ev(T0, 'a', 'start'),
      ev(T0 + 10 * S, 'b', 'start'),
      ev(T0 + 20 * S, 'c', 'start')
    ]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0 - S,
      now: T0 + 30 * S,
      removed: NO_REMOVED
    })
    expect(state.active.map((r) => r.id)).toEqual(['c', 'b', 'a'])
    expect(state.runningCount).toBe(3)
  })

  it('toggle moves a task ACTIVE↔PAUSED (running excluded from PAUSED)', () => {
    const tasks = [task('a')]
    const running = deriveState({
      events: [ev(T0, 'a', 'start')],
      tasks,
      sessionStartTs: T0 - S,
      now: T0 + S,
      removed: NO_REMOVED
    })
    expect(running.active.map((r) => r.id)).toEqual(['a'])
    expect(running.paused).toHaveLength(0)

    const stopped = deriveState({
      events: [ev(T0, 'a', 'start'), ev(T0 + S, 'a', 'stop')],
      tasks,
      sessionStartTs: T0 - S,
      now: T0 + 2 * S,
      removed: NO_REMOVED
    })
    expect(stopped.active).toHaveLength(0)
    expect(stopped.paused.map((r) => r.id)).toEqual(['a'])
  })

  it('removed ids disappear from both selectors but still count toward the union', () => {
    const tasks = [task('a'), task('b')]
    const events = [
      ev(T0, 'a', 'start'),
      ev(T0 + 100 * S, 'a', 'stop'),
      ev(T0, 'b', 'start'),
      ev(T0 + 50 * S, 'b', 'stop')
    ]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0 - S,
      now: T0 + 200 * S,
      removed: new Set(['a'])
    })
    expect(state.paused.map((r) => r.id)).toEqual(['b'])
    expect(state.pausedCount).toBe(1)
    expect(state.sessionWorkedMs).toBe(100 * S) // 'a' still worked, even though hidden
  })

  it('PAUSED sort honours the 5-key order, each tier in turn', () => {
    // session ↓
    expect(
      comparePaused(
        row({ id: 'hi', sessionElapsedMs: 200 }),
        row({ id: 'lo', sessionElapsedMs: 100 })
      )
    ).toBeLessThan(0)
    // tie session → all-time ↓
    expect(
      comparePaused(
        row({ id: 'hi', sessionElapsedMs: 100, allTimeElapsedMs: 500 }),
        row({ id: 'lo', sessionElapsedMs: 100, allTimeElapsedMs: 400 })
      )
    ).toBeLessThan(0)
    // tie session+all-time → space ↑
    expect(
      comparePaused(row({ id: 'x', space: 'Alpha' }), row({ id: 'y', space: 'Beta' }))
    ).toBeLessThan(0)
    // tie space → list ↑
    expect(
      comparePaused(
        row({ id: 'x', space: 'S', list: 'A' }),
        row({ id: 'y', space: 'S', list: 'B' })
      )
    ).toBeLessThan(0)
    // tie list → name ↑ (final tiebreak)
    expect(
      comparePaused(
        row({ id: 'x', space: 'S', list: 'L', name: 'Apple' }),
        row({ id: 'y', space: 'S', list: 'L', name: 'Banana' })
      )
    ).toBeLessThan(0)
  })

  it('end-to-end PAUSED ordering: worked-this-session floats above untouched, grouped by Space→List', () => {
    const tasks = [
      task('worked', { space: 'Zeta', list: 'Z' }),
      task('untouched-b', { space: 'Beta', list: 'L' }),
      task('untouched-a', { space: 'Alpha', list: 'L' })
    ]
    const events = [ev(T0, 'worked', 'start'), ev(T0 + 60 * S, 'worked', 'stop')]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0 - S,
      now: T0 + 120 * S,
      removed: NO_REMOVED
    })
    expect(state.paused.map((r) => r.id)).toEqual(['worked', 'untouched-a', 'untouched-b'])
  })
})

describe('review-panel regressions (per-task union, clamp-to-now, sort totality)', () => {
  it('per-task session elapsed is a UNION of its own intervals — a same-task clock-step overlap is not double-counted', () => {
    const tasks = [task('a')]
    // start → stop, then a re-start whose ts precedes the prior stop (clock stepped back).
    const events = [
      ev(T0, 'a', 'start'),
      ev(T0 + 100 * S, 'a', 'stop'),
      ev(T0 + 50 * S, 'a', 'start') // restart < prior stop
    ]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0,
      now: T0 + 200 * S,
      removed: NO_REMOVED
    })
    const a = state.active[0]
    expect(a.sessionElapsedMs).toBe(200 * S) // union [T0,+100s] ∪ [T0+50s,+200s], NOT 250s
    expect(a.allTimeElapsedMs).toBe(200 * S)
    // a per-card timer can never exceed the session union
    expect(a.sessionElapsedMs).toBeLessThanOrEqual(state.sessionWorkedMs)
    expect(state.sessionWorkedMs).toBe(200 * S)
  })

  it('a closed interval whose stop is later than now (clock stepped back after stop) is capped at now', () => {
    const tasks = [task('a')]
    const events = [ev(T0, 'a', 'start'), ev(T0 + 100 * S, 'a', 'stop')]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0,
      now: T0 + 50 * S, // below the recorded stop
      removed: NO_REMOVED
    })
    const a = state.paused[0]
    expect(a.sessionElapsedMs).toBe(50 * S) // can't have worked 100s in a 50s-old session
    expect(state.sessionWorkedMs).toBe(50 * S)
  })

  it('a closed interval straddling sessionStartTs counts only the post-boundary slice', () => {
    const tasks = [task('a')]
    const events = [ev(T0, 'a', 'start'), ev(T0 + 100 * S, 'a', 'stop')]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0 + 40 * S, // inside the interval
      now: T0 + 200 * S,
      removed: NO_REMOVED
    })
    const a = state.paused[0]
    expect(a.sessionElapsedMs).toBe(60 * S) // [T0+40s, T0+100s]
    expect(a.allTimeElapsedMs).toBe(100 * S)
  })

  it('an open interval (one task) overlapping a closed interval (another task) unions correctly', () => {
    const tasks = [task('a'), task('b')]
    const events = [
      ev(T0, 'a', 'start'),
      ev(T0 + 100 * S, 'a', 'stop'),
      ev(T0 + 50 * S, 'b', 'start') // open, overlaps a's closed window
    ]
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0,
      now: T0 + 200 * S,
      removed: NO_REMOVED
    })
    expect(state.sessionWorkedMs).toBe(200 * S) // [T0,+100] ∪ [T0+50,+200] = [T0,+200]
  })

  it('PAUSED order is deterministic even when name/space/list/elapsed all tie (id breaks it, total order)', () => {
    const dup = (id: string): Task => task(id, { name: 'Dup', space: 'S', list: 'L' })
    const forward = deriveState({
      events: [],
      tasks: [dup('z'), dup('a'), dup('m')],
      sessionStartTs: T0,
      now: T0 + S,
      removed: NO_REMOVED
    })
    const reversed = deriveState({
      events: [],
      tasks: [dup('m'), dup('a'), dup('z')], // different input order
      sessionStartTs: T0,
      now: T0 + S,
      removed: NO_REMOVED
    })
    expect(forward.paused.map((r) => r.id)).toEqual(['a', 'm', 'z'])
    expect(reversed.paused.map((r) => r.id)).toEqual(['a', 'm', 'z']) // same output regardless of input order
  })

  it('a zero-length interval among real rows does not destabilise ordering across input permutations', () => {
    const tasks = [
      task('worked', { name: 'B-worked' }),
      task('zero', { name: 'A-zero' }), // start==stop ⇒ 0
      task('untouched', { name: 'C-untouched' })
    ]
    const events = [
      ev(T0, 'worked', 'start'),
      ev(T0 + 60 * S, 'worked', 'stop'),
      ev(T0 + 5 * S, 'zero', 'start'),
      ev(T0 + 5 * S, 'zero', 'stop')
    ]
    const order = (input: Task[]): string[] =>
      deriveState({
        events,
        tasks: input,
        sessionStartTs: T0,
        now: T0 + 120 * S,
        removed: NO_REMOVED
      }).paused.map((r) => r.id)
    const a = order(tasks)
    const b = order([...tasks].reverse())
    expect(a).toEqual(b) // deterministic
    expect(a[0]).toBe('worked') // worked-this-session floats above the two 0/0 rows
  })
})

describe('PAUSED sort is deterministic + stable at scale (~250 tasks)', () => {
  // Deterministic LCG so the fixture is reproducible without Math.random.
  function* lcg(seed: number): Generator<number> {
    let s = seed >>> 0
    for (;;) {
      s = (s * 1664525 + 1013904223) >>> 0
      yield s
    }
  }

  function makeRows(n: number): TaskRow[] {
    const rnd = lcg(42)
    const sessions = [0, 60 * S, 30 * 60 * S, HOUR]
    const allTimes = [0, 1 * S, 7 * S, 7 * S, 13 * S]
    const spaces = ['Alpha', 'Beta', 'Gamma']
    const lists = ['L1', 'L2']
    const rows: TaskRow[] = []
    for (let i = 0; i < n; i++) {
      const a = rnd.next().value
      const b = rnd.next().value
      rows.push(
        row({
          id: `id-${i}`,
          // name unique across the set ⇒ a TOTAL order ⇒ output independent of input order
          name: `task-${((a % 1000) + 1000) % 1000}-${i}`,
          space: spaces[a % spaces.length],
          list: lists[b % lists.length],
          sessionElapsedMs: sessions[a % sessions.length],
          allTimeElapsedMs: allTimes[b % allTimes.length]
        })
      )
    }
    return rows
  }

  it('any input permutation yields the same sorted output, and re-sorting is idempotent', () => {
    const rows = makeRows(250)
    expect(new Set(rows.map((r) => r.name)).size).toBe(250) // names unique ⇒ total order

    const sortedA = [...rows].sort(comparePaused)
    const sortedFromReversed = [...rows].reverse().sort(comparePaused)
    const sortedAgain = [...sortedA].sort(comparePaused)

    expect(sortedFromReversed.map((r) => r.id)).toEqual(sortedA.map((r) => r.id))
    expect(sortedAgain.map((r) => r.id)).toEqual(sortedA.map((r) => r.id))

    // adjacency is non-decreasing under the comparator ⇒ genuinely sorted
    for (let i = 1; i < sortedA.length; i++) {
      expect(comparePaused(sortedA[i - 1], sortedA[i])).toBeLessThanOrEqual(0)
    }
  })
})

describe('perf guard — a full derive over a long log stays well under the 1s tick', () => {
  it('derives 300 tasks / ~60k events quickly', () => {
    const taskCount = 300
    const tasks = Array.from({ length: taskCount }, (_, i) => task(`t-${i}`))
    const events: WorklogEvent[] = []
    // 100 closed intervals per task ⇒ 60k events
    for (let i = 0; i < taskCount; i++) {
      let t = T0 + i * 10
      for (let k = 0; k < 100; k++) {
        events.push(ev(t, `t-${i}`, 'start'))
        events.push(ev(t + 5 * S, `t-${i}`, 'stop'))
        t += 60 * S
      }
    }
    expect(events.length).toBe(60_000)

    const start = performance.now()
    const state = deriveState({
      events,
      tasks,
      sessionStartTs: T0,
      now: T0 + 1000 * HOUR,
      removed: NO_REMOVED
    })
    const elapsed = performance.now() - start

    expect(state.paused).toHaveLength(taskCount)
    // Coarse regression flag (spine missing_check): one derive ≪ the 1s tick budget.
    // Generous bound (actual is ~tens of ms) to catch an accidental O(n²), not to
    // flake on a loaded runner.
    expect(elapsed).toBeLessThan(500)
  })
})
