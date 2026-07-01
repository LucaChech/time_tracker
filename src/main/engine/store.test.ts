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
  clickupCachePath,
  parseEventLine,
  readClickUpCache,
  readTasksStore,
  readWorklog,
  tasksStorePath,
  worklogPath,
  writeClickUpCache,
  writeTasksStore,
  type ClickUpCache
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

describe('clickup-cache read/write', () => {
  const task: Task = {
    id: 'ck1',
    name: 'Cached task',
    space: 'Space',
    list: 'List',
    code: null,
    color: '#0058bc',
    glyph: 'task_alt',
    source: 'clickup',
    status: 'to do',
    assigneeIds: ['302553911']
  }
  const cache: ClickUpCache = {
    currentUserId: '302553911',
    fetchedAt: 1_700_000_000_000,
    tasks: [task]
  }

  it('returns null when missing', () => {
    expect(readClickUpCache(dir)).toBeNull()
  })

  it('round-trips an atomic write (currentUserId + fetchedAt + tasks)', () => {
    writeClickUpCache(dir, cache)
    expect(readClickUpCache(dir)).toEqual(cache)
  })

  it('preserves a null currentUserId', () => {
    const noUser: ClickUpCache = { ...cache, currentUserId: null }
    writeClickUpCache(dir, noUser)
    expect(readClickUpCache(dir)?.currentUserId).toBeNull()
  })

  it('returns null for corrupt JSON rather than throwing', () => {
    writeFileSync(clickupCachePath(dir), '{ not json', 'utf8')
    expect(readClickUpCache(dir)).toBeNull()
  })

  it('returns null when fetchedAt is missing or non-positive (envelope invalid)', () => {
    writeFileSync(clickupCachePath(dir), JSON.stringify({ currentUserId: 'u', tasks: [] }), 'utf8')
    expect(readClickUpCache(dir)).toBeNull()
    writeFileSync(
      clickupCachePath(dir),
      JSON.stringify({ currentUserId: 'u', fetchedAt: 0, tasks: [] }),
      'utf8'
    )
    expect(readClickUpCache(dir)).toBeNull()
  })

  it('drops malformed task rows but keeps the good ones', () => {
    writeFileSync(
      clickupCachePath(dir),
      JSON.stringify({
        currentUserId: 'u',
        fetchedAt: 1_700_000_000_000,
        tasks: [task, { foo: 1 }, { ...task, id: 'bad', color: 42 }]
      }),
      'utf8'
    )
    expect(readClickUpCache(dir)?.tasks).toEqual([task])
  })
})
