// Cadence — Stage-5b token / connect verify.
//
// Run AFTER `npm run build`. Spawns the compiled app (out/) under CADENCE_TOKENTEST=1
// on an ISOLATED userData dir. The (window-less) main process exercises the
// safeStorage token round-trip (raw token NEVER on disk) + the connection state
// machine (connected / invalid-token / offline / no-token) via an INJECTED fetch and
// an isolated token source — no network, no real .env.local, no real token. It writes
// token-result.json; this orchestrator reads it and exits 0 (pass) / 1 (fail).
//
// Load-bearing extra check: the child is given NO CLICKUP_TOKEN, and after it exits
// this script greps the child's ENTIRE stdout/stderr for the fake sentinel token —
// proving the raw token is never logged (the repo is public).
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import electronPath from 'electron'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(tmpdir(), 'cadence-token-verify')
const dataDir = join(outDir, 'userData')
const resultFile = join(outDir, 'token-result.json')

// Must match FAKE in src/main/index.ts runTokenVerify. We grep the child's logs for it.
// Not prefixed `pk_` so secret scanners don't false-positive on this tracked fixture.
const FAKE = 'FAKEtoken_verifyONLY_dontLog_9f8e7d6c5b4a'

rmSync(outDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

// Deliberately strip CLICKUP_TOKEN so the child's no-token path is genuine.
const childEnv = { ...process.env }
delete childEnv.CLICKUP_TOKEN

const child = spawn(electronPath, ['.'], {
  cwd: root,
  env: {
    ...childEnv,
    CADENCE_TOKENTEST: '1',
    CADENCE_TOKENTEST_OUT: outDir,
    CADENCE_TOKENTEST_DIR: dataDir,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (d) => (stdout += d))
child.stderr.on('data', (d) => (stderr += d))

const killTimer = setTimeout(() => {
  console.error('token-verify: timed out after 30s; killing electron')
  child.kill('SIGKILL')
}, 30000)

child.on('exit', (code) => {
  clearTimeout(killTimer)
  finish(code)
})

function finish(code) {
  if (!existsSync(resultFile)) {
    console.error('TOKEN-VERIFY FAIL — no result file was written (exit code ' + code + ')')
    if (stdout.trim()) console.error('--- stdout ---\n' + stdout)
    if (stderr.trim()) console.error('--- stderr ---\n' + stderr)
    process.exit(1)
  }

  const result = JSON.parse(readFileSync(resultFile, 'utf8'))
  console.log('\n=== Cadence Stage-5b token / connect verify ===')
  for (const r of result.results ?? []) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`)
  }
  if (result.error) console.log('error:', result.error)

  // The RAW fake token must never have reached the child's logs.
  const leaked = stdout.includes(FAKE) || stderr.includes(FAKE)
  console.log(`${leaked ? 'FAIL' : 'PASS'}  raw token never printed to stdout/stderr`)

  const allPass = result.ok && code === 0 && !leaked
  console.log(allPass ? '\nTOKEN-VERIFY PASS' : '\nTOKEN-VERIFY FAIL')
  process.exit(allPass ? 0 : 1)
}
