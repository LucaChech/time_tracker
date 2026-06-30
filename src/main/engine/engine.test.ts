/**
 * Engine orchestration tests — operations (idempotent start/stop/toggle), manual
 * tasks + palette cycling, the session removed-set, persistence + new-session
 * reset across a simulated relaunch, catalogue-absent rendering, and crash
 * hygiene (dangling open intervals closed with no phantom time).
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Task } from '@shared/types'
import { CadenceEngine } from './engine'
import { appendEvent, readWorklog } from './store'

const T0 = 1_700_000_000_000
const S = 1000
const HOUR = 3600 * S

/** A controllable injected clock. */
function makeClock(start: number): {
  now: () => number
  set: (v: number) => void
  advance: (ms: number) => void
} {
  let cur = start
  return {
    now: () => cur,
    set: (v) => {
      cur = v
    },
    advance: (ms) => {
      cur += ms
    }
  }
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cadence-engine-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function clickupTask(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    name: over.name ?? id,
    space: over.space ?? 'Space',
    list: over.list ?? 'List',
    code: over.code ?? null,
    color: over.color ?? '#0091b3',
    glyph: over.glyph ?? 'task_alt',
    source: 'clickup'
  }
}

describe('start / stop / toggle idempotency', () => {
  it('start is a no-op when already running; stop a no-op when already stopped', () => {
    const clock = makeClock(T0)
    const engine = CadenceEngine.create({ dir, now: clock.now })
    engine.setCatalogue([clickupTask('a')])

    engine.start('a')
    clock.advance(10 * S)
    engine.start('a') // redundant — must NOT append a second start
    clock.advance(10 * S)
    engine.stop('a')
    engine.stop('a') // redundant — must NOT append a second stop

    const events = readWorklog(dir).filter((e) => e.taskId === 'a')
    expect(events.map((e) => e.action)).toEqual(['start', 'stop'])

    const state = engine.getState()
    expect(state.runningCount).toBe(0)
    expect(state.paused.find((r) => r.id === 'a')!.sessionElapsedMs).toBe(20 * S)
  })

  it('toggle flips running state and moves the task between sections', () => {
    const clock = makeClock(T0)
    const engine = CadenceEngine.create({ dir, now: clock.now })
    engine.setCatalogue([clickupTask('a')])

    engine.toggle('a')
    expect(engine.getState().active.map((r) => r.id)).toEqual(['a'])
    clock.advance(5 * S)
    engine.toggle('a')
    const state = engine.getState()
    expect(state.active).toHaveLength(0)
    expect(state.paused.map((r) => r.id)).toEqual(['a'])
  })

  it('parallel timers union to wall-clock worked time', () => {
    const clock = makeClock(T0)
    const engine = CadenceEngine.create({ dir, now: clock.now })
    engine.setCatalogue([clickupTask('a'), clickupTask('b'), clickupTask('c')])

    engine.start('a')
    engine.start('b')
    engine.start('c')
    clock.advance(HOUR)
    engine.stopAllRunning('user')

    clock.advance(S)
    const state = engine.getState()
    expect(state.sessionWorkedMs).toBe(HOUR) // 3×1h parallel ⇒ 1h
    for (const r of state.paused) expect(r.sessionElapsedMs).toBe(HOUR)
  })
})

describe('manual tasks', () => {
  it('creates a paused manual task with Untracked defaults and null code', () => {
    const engine = CadenceEngine.create({ dir, now: makeClock(T0).now })
    const t = engine.addManualTask({ name: '  Write report  ' })
    expect(t.name).toBe('Write report')
    expect(t.space).toBe('Untracked')
    expect(t.list).toBe('Untracked')
    expect(t.code).toBeNull()
    expect(t.source).toBe('manual')

    const state = engine.getState()
    expect(state.paused.map((r) => r.id)).toContain(t.id)
    expect(state.active).toHaveLength(0)
  })

  it('cycles color/glyph through the manual palette by manual-task count', () => {
    const engine = CadenceEngine.create({ dir, now: makeClock(T0).now })
    const colors = Array.from(
      { length: 5 },
      (_, i) => engine.addManualTask({ name: `m${i}` }).color
    )
    expect(colors).toEqual(['#c64f00', '#4b3fb0', '#0091b3', '#fe9400', '#c64f00'])
  })

  it('uses provided space/list when given', () => {
    const engine = CadenceEngine.create({ dir, now: makeClock(T0).now })
    const t = engine.addManualTask({ name: 'x', space: 'Personal', list: 'Errands' })
    expect(t.space).toBe('Personal')
    expect(t.list).toBe('Errands')
  })
})

describe('session removed-set', () => {
  it('removeFromList hides a paused row this session, and it reappears next launch', () => {
    const clock = makeClock(T0)
    const engine = CadenceEngine.create({ dir, now: clock.now })
    const t = engine.addManualTask({ name: 'temp' })

    engine.removeFromList(t.id)
    expect(engine.getState().paused.map((r) => r.id)).not.toContain(t.id)

    // simulate relaunch: a fresh engine on the same dir clears the removed-set
    clock.advance(60 * S)
    const relaunched = CadenceEngine.create({ dir, now: clock.now })
    expect(relaunched.getState().paused.map((r) => r.id)).toContain(t.id)
  })
})

describe('persistence + new-session reset across relaunch', () => {
  it('zeroes session elapsed on relaunch while the log retains all-time history', () => {
    const clock = makeClock(T0)
    const session1 = CadenceEngine.create({ dir, now: clock.now })
    session1.setCatalogue([clickupTask('a')])
    session1.start('a')
    clock.advance(10 * 60 * S) // 10 min
    session1.stop('a')

    const s1 = session1.getState().paused.find((r) => r.id === 'a')!
    expect(s1.sessionElapsedMs).toBe(10 * 60 * S)
    expect(s1.allTimeElapsedMs).toBe(10 * 60 * S)

    // relaunch much later: new session, catalogue refetched
    clock.advance(24 * HOUR)
    const session2 = CadenceEngine.create({ dir, now: clock.now })
    session2.setCatalogue([clickupTask('a')])
    const s2 = session2.getState().paused.find((r) => r.id === 'a')!

    expect(s2.sessionElapsedMs).toBe(0) // fresh session
    expect(s2.allTimeElapsedMs).toBe(10 * 60 * S) // history preserved
    expect(session2.getState().sessionWorkedMs).toBe(0)
  })

  it('manual tasks persist across relaunch', () => {
    const clock = makeClock(T0)
    const session1 = CadenceEngine.create({ dir, now: clock.now })
    const t = session1.addManualTask({ name: 'persisted', space: 'P', list: 'L' })

    clock.advance(HOUR)
    const session2 = CadenceEngine.create({ dir, now: clock.now })
    const found = session2.getState().paused.find((r) => r.id === t.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe('persisted')
    expect(found!.space).toBe('P')
  })

  it('a catalogue-absent task still renders from tasks-store with its time', () => {
    const clock = makeClock(T0)
    const session1 = CadenceEngine.create({ dir, now: clock.now })
    session1.setCatalogue([
      clickupTask('ghost', { name: 'Ghost task', space: 'Old', list: 'Gone' })
    ])
    session1.start('ghost')
    clock.advance(5 * 60 * S)
    session1.stop('ghost')

    // relaunch with the task NO LONGER in the ClickUp catalogue
    clock.advance(HOUR)
    const session2 = CadenceEngine.create({ dir, now: clock.now })
    session2.setCatalogue([]) // ghost is gone from ClickUp
    const found = session2.getState().paused.find((r) => r.id === 'ghost')
    expect(found).toBeDefined()
    expect(found!.name).toBe('Ghost task') // metadata survived in tasks-store
    expect(found!.allTimeElapsedMs).toBe(5 * 60 * S)
  })
})

describe('crash hygiene + graceful quit', () => {
  it('closes a dangling open interval on launch at max(ts) — no phantom time', () => {
    // Simulate a crash: a lone `start` written to the log with no matching stop.
    appendEvent(dir, { ts: T0, taskId: 'a', action: 'start', source: 'user' })
    appendEvent(dir, { ts: T0 + 30 * S, taskId: null, action: 'heartbeat', source: 'heartbeat' })

    // Relaunch well after the crash.
    const clock = makeClock(T0 + 10 * HOUR)
    const engine = CadenceEngine.create({ dir, now: clock.now })
    engine.setCatalogue([clickupTask('a')])

    // The open interval is closed in the log at max(ts) = the last heartbeat.
    const aEvents = readWorklog(dir).filter((e) => e.taskId === 'a')
    expect(aEvents.map((e) => e.action)).toEqual(['start', 'stop'])
    const stopEvent = aEvents[1]
    expect(stopEvent.ts).toBe(T0 + 30 * S)
    expect(stopEvent.source).toBe('crash-close')

    // New session: task is paused with 0 session time (no phantom carry-over).
    const state = engine.getState()
    expect(state.runningCount).toBe(0)
    expect(state.paused.find((r) => r.id === 'a')!.sessionElapsedMs).toBe(0)
  })

  it('stopAllRunning records the auto-pause cause (suspend / lock)', () => {
    const clock = makeClock(T0)
    const engine = CadenceEngine.create({ dir, now: clock.now })
    engine.setCatalogue([clickupTask('a'), clickupTask('b')])

    engine.start('a')
    engine.start('b')
    clock.advance(30 * S)
    engine.stopAllRunning('suspend')
    expect(engine.getState().runningCount).toBe(0)

    clock.advance(S)
    engine.start('a')
    clock.advance(30 * S)
    engine.stopAllRunning('lock')

    const stops = readWorklog(dir).filter((e) => e.action === 'stop')
    const sources = stops.map((e) => e.source)
    expect(sources.filter((s) => s === 'suspend')).toHaveLength(2)
    expect(sources.filter((s) => s === 'lock')).toHaveLength(1)
  })

  it('graceful quit stops every running timer with source "quit"', () => {
    const clock = makeClock(T0)
    const engine = CadenceEngine.create({ dir, now: clock.now })
    engine.setCatalogue([clickupTask('a'), clickupTask('b')])
    engine.start('a')
    engine.start('b')
    clock.advance(60 * S)
    engine.quit()

    expect(engine.getState().runningCount).toBe(0)
    const stops = readWorklog(dir).filter((e) => e.action === 'stop')
    expect(stops).toHaveLength(2)
    expect(stops.every((e) => e.source === 'quit')).toBe(true)

    // A subsequent relaunch sees no open intervals to crash-close.
    clock.advance(HOUR)
    const before = readWorklog(dir).length
    CadenceEngine.create({ dir, now: clock.now })
    expect(readWorklog(dir).length).toBe(before)
  })
})
