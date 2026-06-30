// Cadence — Stage-1 launch smoke test.
//
// Run AFTER `npm run build`. Spawns the compiled app (out/) under CADENCE_SMOKE=1,
// waits for the renderer to self-report, and asserts a clean, secure launch with
// offline-bundled fonts. The app writes smoke-result.json + smoke.png to a temp dir;
// this orchestrator reads them and exits 0 (pass) / 1 (fail).
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import electronPath from 'electron'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(tmpdir(), 'cadence-smoke')
const resultFile = join(outDir, 'smoke-result.json')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const child = spawn(electronPath, ['.'], {
  cwd: root,
  env: {
    ...process.env,
    CADENCE_SMOKE: '1',
    CADENCE_SMOKE_OUT: outDir,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (d) => (stdout += d))
child.stderr.on('data', (d) => (stderr += d))

const killTimer = setTimeout(() => {
  console.error('smoke: timed out after 30s; killing electron')
  child.kill('SIGKILL')
}, 30000)

child.on('exit', (code) => {
  clearTimeout(killTimer)
  finish(code)
})

function finish(code) {
  if (!existsSync(resultFile)) {
    console.error('SMOKE FAIL — no result file was written (exit code ' + code + ')')
    if (stdout.trim()) console.error('--- stdout ---\n' + stdout)
    if (stderr.trim()) console.error('--- stderr ---\n' + stderr)
    process.exit(1)
  }

  const result = JSON.parse(readFileSync(resultFile, 'utf8'))
  const report = result.report
  const checks = []
  const add = (name, pass, detail = '') => checks.push({ name, pass, detail })

  add(
    'no renderer errors',
    result.rendererErrors.length === 0,
    JSON.stringify(result.rendererErrors)
  )
  if (report) {
    add(
      'renderer cannot reach node',
      Object.values(report.nodeReach).every((t) => t === 'undefined'),
      JSON.stringify(report.nodeReach)
    )
    add(
      'self-hosted fonts loaded',
      Object.values(report.fonts).every(Boolean),
      JSON.stringify(report.fonts)
    )
    add('typed IPC bridge (ping → pong)', report.pong === 'pong', `pong=${report.pong}`)
  } else {
    add('renderer reported self-check', false, 'no report object')
  }
  add('process exit code 0', code === 0, `code=${code}`)

  console.log('\n=== Cadence Stage-1 launch smoke ===')
  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : '  → ' + c.detail}`)
  }
  console.log('versions:', JSON.stringify(result.versions))
  console.log('screenshot:', result.screenshotPath || '(none)')

  const allPass = checks.every((c) => c.pass)
  console.log(allPass ? '\nSMOKE PASS' : '\nSMOKE FAIL')
  process.exit(allPass ? 0 : 1)
}
