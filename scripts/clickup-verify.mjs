// Cadence — Stage-5a ClickUp READ verify (live).
//
// Run AFTER `npm run build`. Reads the pk_ token from the untracked .env.local,
// passes it to the compiled app (out/) via the CLICKUP_TOKEN env var, and spawns
// electron under CADENCE_CLICKUPTEST=1 on an ISOLATED userData dir. The (window-less)
// main process fetches the REAL catalogue through src/main/clickup.ts, runs it
// through the engine, asserts the Stage-5 contract on live data, and writes
// clickup-result.json. This orchestrator reads that and exits 0 (pass) / 1 (fail).
//
// The token is passed only in-process to the child's env — never printed, never
// written to the result file. If no token is available the check SKIPS loudly
// (exit 0) rather than failing, so CI without the secret is not a hard error; in a
// real build session with .env.local present it runs against the live workspace.
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import electronPath from 'electron'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(tmpdir(), 'cadence-clickup-verify')
const dataDir = join(outDir, 'userData')
const resultFile = join(outDir, 'clickup-result.json')

// Resolve the token: prefer the ambient env, else parse .env.local. Never printed.
// This parse MIRRORS parseTokenFromEnv in src/main/clickup.ts (this .mjs runs before
// the TS build and can't import it) — keep the two rules in sync.
function resolveToken() {
  const fromEnv = process.env.CLICKUP_TOKEN?.trim()
  if (fromEnv) return fromEnv
  const envFile = join(root, '.env.local')
  if (!existsSync(envFile)) return null
  const m = readFileSync(envFile, 'utf8').match(/^\s*CLICKUP_TOKEN\s*=\s*(.*)\s*$/m)
  if (!m) return null
  const raw = m[1]
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
  return raw.length > 0 ? raw : null
}

const token = resolveToken()
if (!token) {
  console.log(
    'CLICKUP-VERIFY SKIP — no CLICKUP_TOKEN in env or .env.local (nothing to verify against).'
  )
  console.log('  Provide a pk_ token in .env.local (CLICKUP_TOKEN=pk_…) to run the live check.')
  process.exit(0)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const child = spawn(electronPath, ['.'], {
  cwd: root,
  env: {
    ...process.env,
    CLICKUP_TOKEN: token,
    CADENCE_CLICKUPTEST: '1',
    CADENCE_CLICKUPTEST_OUT: outDir,
    CADENCE_CLICKUPTEST_DIR: dataDir,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (d) => (stdout += d))
child.stderr.on('data', (d) => (stderr += d))

// Network fetch across all spaces/lists — allow a generous window.
const killTimer = setTimeout(() => {
  console.error('clickup-verify: timed out after 60s; killing electron')
  child.kill('SIGKILL')
}, 60000)

child.on('exit', (code) => {
  clearTimeout(killTimer)
  finish(code)
})

function finish(code) {
  if (!existsSync(resultFile)) {
    console.error('CLICKUP-VERIFY FAIL — no result file was written (exit code ' + code + ')')
    // Safe to dump the child's streams: the CADENCE_CLICKUPTEST main path never
    // prints the token (it records 'present'/'MISSING', never the value). That
    // invariant is LOAD-BEARING for a public-repo CI log — keep it that way.
    if (stdout.trim()) console.error('--- stdout ---\n' + stdout)
    if (stderr.trim()) console.error('--- stderr ---\n' + stderr)
    process.exit(1)
  }

  const result = JSON.parse(readFileSync(resultFile, 'utf8'))
  console.log('\n=== Cadence Stage-5a ClickUp READ verify ===')
  for (const r of result.results ?? []) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`)
  }
  if (result.error) console.log('error:', result.error)

  const allPass = result.ok && code === 0
  console.log(allPass ? '\nCLICKUP-VERIFY PASS' : '\nCLICKUP-VERIFY FAIL')
  process.exit(allPass ? 0 : 1)
}
