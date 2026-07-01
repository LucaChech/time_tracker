// Cadence — Stage-3b IPC integration verify.
//
// Run AFTER `npm run build`. Spawns the compiled app (out/) under CADENCE_IPCTEST=1
// on an ISOLATED userData dir, waits while the app drives the real
// renderer→preload→main→engine path (start/stop/add/remove) through window.cadence
// and asserts membership/ordering/transitions, then reads ipc-result.json and
// exits 0 (pass) / 1 (fail). This is the Stage-3b "wire UI ↔ engine over IPC" gate.
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import electronPath from 'electron'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(tmpdir(), 'cadence-ipc-verify')
const dataDir = join(outDir, 'userData')
const resultFile = join(outDir, 'ipc-result.json')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const child = spawn(electronPath, ['.'], {
  cwd: root,
  env: {
    ...process.env,
    CADENCE_IPCTEST: '1',
    CADENCE_IPCTEST_OUT: outDir,
    CADENCE_IPCTEST_DIR: dataDir,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (d) => (stdout += d))
child.stderr.on('data', (d) => (stderr += d))

const killTimer = setTimeout(() => {
  console.error('ipc-verify: timed out after 30s; killing electron')
  child.kill('SIGKILL')
}, 30000)

child.on('exit', (code) => {
  clearTimeout(killTimer)
  finish(code)
})

function finish(code) {
  if (!existsSync(resultFile)) {
    console.error('IPC-VERIFY FAIL — no result file was written (exit code ' + code + ')')
    if (stdout.trim()) console.error('--- stdout ---\n' + stdout)
    if (stderr.trim()) console.error('--- stderr ---\n' + stderr)
    process.exit(1)
  }

  const result = JSON.parse(readFileSync(resultFile, 'utf8'))
  console.log('\n=== Cadence Stage-3b IPC integration verify ===')
  for (const r of result.results ?? []) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  → ' + r.detail}`)
  }
  if (result.error) console.log('error:', result.error)
  if (result.rendererErrors?.length) console.log('rendererErrors:', JSON.stringify(result.rendererErrors))

  const allPass = result.ok && code === 0
  console.log(allPass ? '\nIPC-VERIFY PASS' : '\nIPC-VERIFY FAIL')
  process.exit(allPass ? 0 : 1)
}
