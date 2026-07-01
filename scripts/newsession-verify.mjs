// Cadence — Stage-6 new-session / persistence-hardening verify.
//
// Run AFTER `npm run build`. Seeds an ISOLATED userData dir with a realistic PRIOR
// state — a worklog carrying earlier-session history PLUS a dangling OPEN interval
// and a trailing heartbeat (a prior crash), a tasks-store, and a clickup-cache — then
// spawns the compiled app (out/) under CADENCE_NEWSESSIONTEST=1. The main process
// drives the REAL launch helpers (engine.create → crash-close, loadCachedCatalogue →
// offline render, startHeartbeat → the ~30s writer, sped up here via CADENCE_HEARTBEAT_MS)
// and asserts new-session reset, no phantom time, log-history integrity, and that the
// heartbeat writer fires, writing newsession-result.json. This orchestrator reads it
// and exits 0 (pass) / 1 (fail). This is the Stage-6 automated launch-hardening gate.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import electronPath from 'electron'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(tmpdir(), 'cadence-newsession-verify')
const dataDir = join(outDir, 'userData')
const resultFile = join(outDir, 'newsession-result.json')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

// ── Seed a crashed prior run ───────────────────────────────────────────────────
// Two days ago: an earlier session that completed a 1h interval, then a crash left a
// second task's interval OPEN (a `start` with no `stop`), with a trailing heartbeat as
// the last-known-good timestamp. This is exactly the state the new launch must harden
// against: close the open interval at max(ts) (no phantom time), keep the history, and
// start a fresh 0-total session.
const S = 1000
const T0 = Date.now() - 2 * 24 * 3600 * S
const worklog =
  [
    { ts: T0, taskId: 'seedA', action: 'start', source: 'user' },
    { ts: T0 + 3600 * S, taskId: 'seedA', action: 'stop', source: 'user' }, // 1h of history
    { ts: T0 + 7200 * S, taskId: 'seedB', action: 'start', source: 'user' }, // OPEN (crash)
    { ts: T0 + 7230 * S, taskId: null, action: 'heartbeat', source: 'heartbeat' } // last heartbeat = max(ts)
  ]
    .map((e) => JSON.stringify(e))
    .join('\n') + '\n'
writeFileSync(join(dataDir, 'worklog.jsonl'), worklog, 'utf8')

const task = (id, name, color, glyph) => ({
  id,
  name,
  space: 'Seed Space',
  list: 'Seed List',
  code: null,
  color,
  glyph,
  source: 'clickup',
  status: 'to do',
  assigneeIds: []
})
// seedA + seedB were tracked (ever-started) → in the metadata snapshot; the cache holds
// the full catalogue including seedC (never started) so all three render offline.
const seedA = task('seedA', 'Historical task', '#c64f00', 'task_alt')
const seedB = task('seedB', 'Crashed-open task', '#4b3fb0', 'bolt')
const seedC = task('seedC', 'Untouched catalogue task', '#0091b3', 'draw')
writeFileSync(join(dataDir, 'tasks-store.json'), JSON.stringify([seedA, seedB], null, 2), 'utf8')
writeFileSync(
  join(dataDir, 'clickup-cache.json'),
  JSON.stringify(
    { currentUserId: '302553911', fetchedAt: T0 + 7230 * S, tasks: [seedA, seedB, seedC] },
    null,
    2
  ),
  'utf8'
)

const child = spawn(electronPath, ['.'], {
  cwd: root,
  env: {
    ...process.env,
    CADENCE_NEWSESSIONTEST: '1',
    CADENCE_NEWSESSIONTEST_OUT: outDir,
    CADENCE_NEWSESSIONTEST_DIR: dataDir,
    CADENCE_HEARTBEAT_MS: '100', // speed the writer up so the test proves it without a 30s wait
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (d) => (stdout += d))
child.stderr.on('data', (d) => (stderr += d))

const killTimer = setTimeout(() => {
  console.error('newsession-verify: timed out after 30s; killing electron')
  child.kill('SIGKILL')
}, 30000)

child.on('exit', (code) => {
  clearTimeout(killTimer)
  finish(code)
})

function finish(code) {
  if (!existsSync(resultFile)) {
    console.error('NEWSESSION-VERIFY FAIL — no result file was written (exit code ' + code + ')')
    if (stdout.trim()) console.error('--- stdout ---\n' + stdout)
    if (stderr.trim()) console.error('--- stderr ---\n' + stderr)
    process.exit(1)
  }

  const result = JSON.parse(readFileSync(resultFile, 'utf8'))
  console.log('\n=== Cadence Stage-6 new-session / persistence-hardening verify ===')
  for (const r of result.results ?? []) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  → ' + r.detail}`)
  }
  if (result.error) console.log('error:', result.error)

  const allPass = result.ok && code === 0
  console.log(allPass ? '\nNEWSESSION-VERIFY PASS' : '\nNEWSESSION-VERIFY FAIL')
  process.exit(allPass ? 0 : 1)
}
