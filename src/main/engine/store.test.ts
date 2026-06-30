/**
 * Persistence tests — JSONL parsing is defensive (a corrupt line is skipped, not
 * fatal, and never produces NaN downstream), and the tasks-store round-trips.
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Task, WorklogEvent } from '@shared/types'
import {
  appendEvent,
  parseEventLine,
  readTasksStore,
  readWorklog,
  tasksStorePath,
  worklogPath,
  writeTasksStore
} from './store'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cadence-store-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parseEventLine', () => {
  it('parses a well-formed start/stop/heartbeat line', () => {
    expect(parseEventLine('{"ts":1000,"taskId":"a","action":"start","source":"user"}')).toEqual({
      ts: 1000,
      taskId: 'a',
      action: 'start',
      source: 'user'
    })
    expect(
      parseEventLine('{"ts":2000,"taskId":null,"action":"heartbeat","source":"heartbeat"}')
    ).toEqual({ ts: 2000, taskId: null, action: 'heartbeat', source: 'heartbeat' })
  })

  it('rejects malformed lines (returns null, never throws or yields NaN)', () => {
    expect(parseEventLine('')).toBeNull()
    expect(parseEventLine('   ')).toBeNull()
    expect(parseEventLine('not json')).toBeNull()
    expect(parseEventLine('{"ts":"oops","taskId":"a","action":"start"}')).toBeNull() // non-numeric ts
    expect(parseEventLine('{"taskId":"a","action":"start"}')).toBeNull() // missing ts
    expect(parseEventLine('{"ts":null,"taskId":"a","action":"start"}')).toBeNull()
    expect(parseEventLine('{"ts":1,"taskId":"a","action":"frobnicate"}')).toBeNull() // bad action
    expect(parseEventLine('{"ts":1,"taskId":null,"action":"start"}')).toBeNull() // start needs a task
    expect(parseEventLine('[1,2,3]')).toBeNull()
  })

  it('rejects a non-positive ts (epoch-ms is always > 0)', () => {
    expect(parseEventLine('{"ts":0,"taskId":"a","action":"start"}')).toBeNull()
    expect(parseEventLine('{"ts":-5,"taskId":"a","action":"start"}')).toBeNull()
  })

  it('defaults a heartbeat line with no source to "heartbeat"', () => {
    expect(parseEventLine('{"ts":1,"taskId":null,"action":"heartbeat"}')).toEqual({
      ts: 1,
      taskId: null,
      action: 'heartbeat',
      source: 'heartbeat'
    })
  })

  it('defaults an unknown/absent source to "user"', () => {
    expect(parseEventLine('{"ts":1,"taskId":"a","action":"start"}')).toEqual({
      ts: 1,
      taskId: 'a',
      action: 'start',
      source: 'user'
    })
    expect(parseEventLine('{"ts":1,"taskId":"a","action":"start","source":"???"}')?.source).toBe(
      'user'
    )
  })
})

describe('worklog read/append', () => {
  it('returns [] when the log does not exist yet', () => {
    expect(readWorklog(dir)).toEqual([])
  })

  it('round-trips appended events in order', () => {
    const a: WorklogEvent = { ts: 1, taskId: 'a', action: 'start', source: 'user' }
    const b: WorklogEvent = { ts: 2, taskId: 'a', action: 'stop', source: 'user' }
    appendEvent(dir, a)
    appendEvent(dir, b)
    expect(readWorklog(dir)).toEqual([a, b])
  })

  it('skips corrupt lines but keeps the good ones around them', () => {
    const path = worklogPath(dir)
    writeFileSync(
      path,
      [
        '{"ts":1,"taskId":"a","action":"start","source":"user"}',
        'garbage that is not json',
        '{"ts":bad}',
        '{"ts":2,"taskId":"a","action":"stop","source":"user"}',
        '' // trailing newline
      ].join('\n'),
      'utf8'
    )
    const events = readWorklog(dir)
    expect(events).toEqual([
      { ts: 1, taskId: 'a', action: 'start', source: 'user' },
      { ts: 2, taskId: 'a', action: 'stop', source: 'user' }
    ])
  })
})

describe('tasks-store read/write', () => {
  const sample: Task[] = [
    {
      id: 'a',
      name: 'Alpha',
      space: 'S',
      list: 'L',
      code: null,
      color: '#0091b3',
      glyph: 'task_alt',
      source: 'clickup'
    }
  ]

  it('returns [] when missing', () => {
    expect(readTasksStore(dir)).toEqual([])
  })

  it('round-trips an atomic write', () => {
    writeTasksStore(dir, sample)
    expect(readTasksStore(dir)).toEqual(sample)
  })

  it('overwrites cleanly on a second atomic write', () => {
    writeTasksStore(dir, sample)
    writeTasksStore(dir, [])
    expect(readTasksStore(dir)).toEqual([])
  })

  it('treats a corrupt tasks-store as empty rather than throwing', () => {
    writeFileSync(tasksStorePath(dir), '{ not valid json', 'utf8')
    expect(readTasksStore(dir)).toEqual([])
  })

  it('drops malformed rows from a valid-JSON array (no undefined-field cards)', () => {
    writeFileSync(
      tasksStorePath(dir),
      JSON.stringify([
        sample[0], // good
        { foo: 1 }, // missing every required field
        { ...sample[0], id: 'b', source: 'bogus' }, // bad source
        { ...sample[0], id: 'c', name: 42 } // wrong type
      ]),
      'utf8'
    )
    expect(readTasksStore(dir)).toEqual([sample[0]])
  })
})
