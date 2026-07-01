// Cadence — Stage-4 tray & window behavior verify.
//
// Run AFTER `npm run build`. Spawns the compiled app (out/) under CADENCE_TRAYTEST=1
// on an ISOLATED userData dir, with the real tray + window behavior wired. The main
// process drives show/hide, close-to-tray, suspend auto-pause, blur-hide,
// second-instance show+reposition, autostart, and content-height clamping, asserting
// observable window + engine state, then writes tray-result.json. This orchestrator
// reads it and exits 0 (pass) / 1 (fail). This is the Stage-4 automated gate that
// backs the live `/verify`.
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import electronPath from 'electron'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(tmpdir(), 'cadence-tray-verify')
const dataDir = join(outDir, 'userData')
const resultFile = join(outDir, 'tray-result.json')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

const child = spawn(electronPath, ['.'], {
  cwd: root,
  env: {
    ...process.env,
    CADENCE_TRAYTEST: '1',
    CADENCE_TRAYTEST_OUT: outDir,
    CADENCE_TRAYTEST_DIR: dataDir,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (d) => (stdout += d))
child.stderr.on('data', (d) => (stderr += d))

const killTimer = setTimeout(() => {
  console.error('tray-verify: timed out after 30s; killing electron')
  child.kill('SIGKILL')
}, 30000)

child.on('exit', (code) => {
  clearTimeout(killTimer)
  finish(code)
})

function finish(code) {
  if (!existsSync(resultFile)) {
    console.error('TRAY-VERIFY FAIL — no result file was written (exit code ' + code + ')')
    if (stdout.trim()) console.error('--- stdout ---\n' + stdout)
    if (stderr.trim()) console.error('--- stderr ---\n' + stderr)
    process.exit(1)
  }

  const result = JSON.parse(readFileSync(resultFile, 'utf8'))
  console.log('\n=== Cadence Stage-4 tray & window verify ===')
  for (const r of result.results ?? []) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  → ' + r.detail}`)
  }
  if (result.error) console.log('error:', result.error)
  if (result.rendererErrors?.length) {
    console.log('rendererErrors:', JSON.stringify(result.rendererErrors))
  }

  const allPass = result.ok && code === 0
  console.log(allPass ? '\nTRAY-VERIFY PASS' : '\nTRAY-VERIFY FAIL')
  process.exit(allPass ? 0 : 1)
}
