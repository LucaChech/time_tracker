/**
 * Static fixtures for Stage 3a.
 *
 * Stage 3a is the pixel-faithful UI **before** it is wired to the state engine
 * (that wiring is Stage 3b). The components are pure renders of a `StateSnapshot`
 * — exactly the shape the engine's `getState()` returns — so here we hand them
 * fixture snapshots instead of the live engine. Three scenarios exercise the
 * states the verification spine requires: populated (both sections), empty, and a
 * long PAUSED list (scroll).
 *
 * The "populated" scenario reuses the prototype's five tasks so the recreated UI
 * can be diffed against the `3a` prototype. Two intentional differences from the
 * prototype, both driven by settled specs — NOT fidelity regressions:
 *   • PAUSED rows are in the Phase-2 sort order (session-elapsed desc …), which the
 *     prototype does not apply (it renders raw array order).
 *   • The session total is the wall-clock UNION (`sessionWorkedMs`), not the sum of
 *     per-task elapsed the prototype shows — union is the Phase-2 semantic.
 */
import type { StateSnapshot, TaskRow, TaskSource } from '@shared/types'

const SEC = 1000

interface RowSpec {
  id: string
  name: string
  space: string
  list: string
  code: string | null
  color: string
  glyph: string
  /** Session elapsed in whole seconds (converted to ms). */
  sec: number
  source?: TaskSource
}

function makeRow(spec: RowSpec, running: boolean, order: number): TaskRow {
  return {
    id: spec.id,
    name: spec.name,
    space: spec.space,
    list: spec.list,
    code: spec.code,
    color: spec.color,
    glyph: spec.glyph,
    source: spec.source ?? 'clickup',
    running,
    sessionElapsedMs: spec.sec * SEC,
    // All-time ≥ session; only used as a PAUSED-sort tiebreaker. Fixture keeps it
    // equal to session elapsed — the engine supplies the real historical value.
    allTimeElapsedMs: spec.sec * SEC,
    // Most-recently-started first for ACTIVE; `order` descends so array order == sort.
    lastStartTs: running ? 1_700_000_000_000 - order * 60_000 : null
  }
}

// ---- Populated: the prototype's five tasks ---------------------------------
const ACTIVE_SPECS: RowSpec[] = [
  {
    id: 't1',
    name: 'Fix checkout payment bug',
    space: 'Engineering',
    list: 'Sprint 24',
    code: 'CU-482',
    color: '#0058bc',
    glyph: 'bug_report',
    sec: 4521
  },
  {
    id: 't2',
    name: 'Draft Q3 roadmap doc',
    space: 'Marketing',
    list: 'Q3 Planning',
    code: 'CU-455',
    color: '#fe9400',
    glyph: 'description',
    sec: 1985
  }
]

// Given in Phase-2 PAUSED sort order: session-elapsed desc, then all-time, Space,
// List, name. (t4 7320s → t5 540s → t3 0s.)
const PAUSED_SPECS: RowSpec[] = [
  {
    id: 't4',
    name: 'Client onboarding notes',
    space: 'Client Services',
    list: 'Acme Corp',
    code: 'CU-310',
    color: '#4b3fb0',
    glyph: 'forum',
    sec: 7320
  },
  {
    id: 't5',
    name: 'Update API reference',
    space: 'Product',
    list: 'API Docs',
    code: 'CU-377',
    color: '#0091b3',
    glyph: 'code',
    sec: 540
  },
  {
    id: 't3',
    name: 'Review PR #482',
    space: 'Engineering',
    list: 'Code Review',
    code: 'CU-491',
    color: '#c64f00',
    glyph: 'rate_review',
    sec: 0
  }
]

const populated: StateSnapshot = {
  active: ACTIVE_SPECS.map((s, i) => makeRow(s, true, i)),
  paused: PAUSED_SPECS.map((s, i) => makeRow(s, false, i)),
  runningCount: ACTIVE_SPECS.length,
  pausedCount: PAUSED_SPECS.length,
  // Wall-clock union of run-intervals this session (≤ per-task sum, ≥ max single
  // task). A representative fixture value; the engine computes the real union.
  sessionWorkedMs: 9240 * SEC, // 2h 34m
  sessionStartTs: 1_700_000_000_000 - 9240 * SEC
}

// ---- Empty: a fresh session, nothing tracked yet ---------------------------
const empty: StateSnapshot = {
  active: [],
  paused: [],
  runningCount: 0,
  pausedCount: 0,
  sessionWorkedMs: 0,
  sessionStartTs: 1_700_000_000_000
}

// ---- Long list: forces the PAUSED scroll region ----------------------------
const PALETTE = ['#0058bc', '#fe9400', '#c64f00', '#4b3fb0', '#0091b3']
const GLYPHS = ['bug_report', 'description', 'rate_review', 'forum', 'code', 'task_alt']
const SPACES = ['Engineering', 'Marketing', 'Product', 'Client Services', 'Operations']
const LISTS = ['Sprint 24', 'Backlog', 'Q3 Planning', 'API Docs', 'Acme Corp', 'Triage']

const longActive: RowSpec[] = [
  {
    id: 'l1',
    name: 'Investigate flaky CI run',
    space: 'Engineering',
    list: 'Sprint 24',
    code: 'CU-902',
    color: '#0058bc',
    glyph: 'bug_report',
    sec: 3110
  },
  {
    // code: null → the ClickUp id chip must be HIDDEN on this active card
    // (v0 deviation: Free-plan workspaces return no custom_id).
    id: 'l2',
    name: 'Pair on onboarding flow',
    space: 'Operations',
    list: 'Triage',
    code: null,
    color: '#c64f00',
    glyph: 'forum',
    sec: 745
  }
]

const longPaused: RowSpec[] = Array.from({ length: 32 }, (_, i) => {
  const isManual = i % 9 === 8
  // Descending elapsed so the array is already in session-desc sort order; a few
  // trailing rows sit at 0s to exercise the "short elapsed hidden when 0" rule.
  const sec = i < 26 ? (32 - i) * 137 : 0
  return {
    id: `l${i + 3}`,
    name: isManual
      ? `Ad-hoc: follow up item ${i + 1}`
      : `${['Refactor', 'Document', 'Review', 'Spec', 'Triage', 'Estimate'][i % 6]} ${SPACES[i % SPACES.length]} task ${i + 1}`,
    space: isManual ? 'Untracked' : SPACES[i % SPACES.length],
    list: isManual ? 'Untracked' : LISTS[i % LISTS.length],
    code: isManual ? null : `CU-${600 + i}`,
    color: PALETTE[i % PALETTE.length],
    glyph: GLYPHS[i % GLYPHS.length],
    sec,
    source: isManual ? 'manual' : 'clickup'
  }
})

const longList: StateSnapshot = {
  active: longActive.map((s, i) => makeRow(s, true, i)),
  paused: longPaused.map((s, i) => makeRow(s, false, i)),
  runningCount: longActive.length,
  pausedCount: longPaused.length,
  sessionWorkedMs: 6820 * SEC, // 1h 53m
  sessionStartTs: 1_700_000_000_000 - 6820 * SEC
}

export type ScenarioName = 'populated' | 'empty' | 'long'

const SCENARIOS: Record<ScenarioName, StateSnapshot> = { populated, empty, long: longList }

/** Resolve a scenario by name, defaulting to the populated prototype fixture. */
export function getScenario(name: string | null): StateSnapshot {
  if (name === 'empty' || name === 'long' || name === 'populated') return SCENARIOS[name]
  return populated
}
