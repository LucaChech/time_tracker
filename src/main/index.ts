import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IpcChannels, type AppInfo, type SmokeReport } from '@shared/ipc'
import type { ManualTaskInput, StateSnapshot } from '@shared/types'
import { CadenceEngine } from './engine'

/**
 * Cadence main process — Stage 1 (scaffold & app shell).
 *
 * One frameless, transparent, always-on-top flyout window. Tray-driven reveal and
 * content-fit sizing arrive in Phase 4; here the window exists, renders without
 * black corners, and exposes the typed IPC bridge.
 */

const FLYOUT_WIDTH = 380
// Placeholder height. Phase 3/4 make the height content-driven (panel measures
// itself and the window resizes), with internal scroll for a long PAUSED list.
const FLYOUT_HEIGHT = 600

// Stage-1 automated smoke harness. When CADENCE_SMOKE=1 the app launches, lets the
// renderer run its self-check, captures a screenshot, writes a result file, and
// exits with 0 (pass) / 1 (fail). Driven by scripts/smoke.mjs. Never on in normal use.
const SMOKE = process.env.CADENCE_SMOKE === '1'
const SMOKE_OUT = process.env.CADENCE_SMOKE_OUT

// Stage-3b IPC integration harness. When CADENCE_IPCTEST=1 the app boots on an
// ISOLATED userData dir (CADENCE_IPCTEST_DIR), then drives the real
// renderer→preload→main→engine path (start/stop/add/remove) through
// `window.cadence` and asserts membership/ordering/transitions. Driven by
// scripts/ipc-verify.mjs; writes ipc-result.json to CADENCE_IPCTEST_OUT. Off in
// normal use.
const IPCTEST = process.env.CADENCE_IPCTEST === '1'
const IPCTEST_OUT = process.env.CADENCE_IPCTEST_OUT
const IPCTEST_DIR = process.env.CADENCE_IPCTEST_DIR

let mainWindow: BrowserWindow | null = null
let smokeDone = false
const rendererErrors: string[] = []
// The 1s display-tick handle, cleared on quit so the interval never outlives the app.
let tickTimer: ReturnType<typeof setInterval> | null = null

// Only hand http(s) URLs to the OS shell — never file: or an OS-handler scheme,
// which shell.openExternal would otherwise launch (a known Electron footgun). This
// matters once ClickUp-derived strings (task names/URLs) start flowing through.
function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: FLYOUT_WIDTH,
    height: FLYOUT_HEIGHT,
    show: false,
    frame: false, // frameless flyout — custom title bar lives in the renderer
    transparent: true, // panel draws its own rounded corners over a transparent window
    backgroundColor: '#00000000', // fully transparent — guards against black corners on Windows
    resizable: false,
    hasShadow: false, // the design uses a custom CSS ambient shadow, not the OS shadow
    roundedCorners: false, // the panel owns its 16px radius; avoid OS double-rounding
    skipTaskbar: true, // no taskbar button — it is a tray flyout
    alwaysOnTop: true, // floats above the taskbar
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, // renderer world is isolated from the preload/Node world
      nodeIntegration: false, // no Node globals in the renderer
      sandbox: true // strongest posture; the renderer reaches main only via typed IPC
    }
  })

  // Capture renderer-side failures so the smoke gate can assert a clean launch.
  mainWindow.webContents.on('console-message', (details) => {
    if (details.level === 'error') rendererErrors.push(details.message)
  })
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    rendererErrors.push(`preload-error ${preloadPath}: ${error.message}`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, gone) => {
    rendererErrors.push(`render-process-gone: ${gone.reason}`)
  })

  mainWindow.on('ready-to-show', () => {
    // Phase 1: production launches hidden (the tray that reveals it arrives in
    // Phase 4). In dev or under the smoke harness we show it so the shell is
    // actually observable/verifiable.
    if (is.dev || SMOKE) mainWindow?.show()
  })

  // External links open in the user's browser, never inside the app window — and
  // only if they're http(s); any other scheme is dropped, not handed to the shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  // Lock the top frame to the app's own content: nothing in v0 should navigate the
  // main window off the bundled renderer (or the dev server). Block any cross-origin
  // navigation so a stray link / location= can't defeat the local-content + CSP model.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const current = mainWindow?.webContents.getURL()
      if (current && new URL(url).origin !== new URL(current).origin) {
        event.preventDefault()
      }
    } catch {
      event.preventDefault()
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.ping, () => 'pong')
  ipcMain.handle(IpcChannels.getAppInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))
}

// ── Stage 3b: live state wiring (UI ↔ engine over IPC) ───────────────────────

/**
 * Push a fresh snapshot to the renderer (main → renderer). No-op if the window
 * is gone. This is the ONLY way timing reaches the UI: the renderer never
 * recomputes elapsed / union / sort — it renders whatever main derives, so the
 * event log stays the single source of truth.
 */
function broadcastState(state: StateSnapshot): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IpcChannels.stateUpdate, state)
  }
}

/**
 * Domain IPC. Each operation runs on the engine (which owns all logic and
 * persistence), then returns the freshly derived snapshot so the calling
 * renderer updates immediately — no round-trip wait for the next tick. Inputs
 * are validated defensively even though the only caller is our own preload.
 */
function registerDomainIpc(engine: CadenceEngine): void {
  // Accept an id only if it's a non-empty string AND names a task the engine can
  // render — never trust an arbitrary id from IPC. Guarding here means a start
  // can't open a phantom, unstoppable interval for an id with no row to stop it.
  const asKnownId = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 && engine.hasTask(v) ? v : null

  ipcMain.handle(IpcChannels.getState, () => engine.getState())

  ipcMain.handle(IpcChannels.start, (_e, taskId: unknown) => {
    const id = asKnownId(taskId)
    if (id) engine.start(id)
    return engine.getState()
  })
  ipcMain.handle(IpcChannels.stop, (_e, taskId: unknown) => {
    const id = asKnownId(taskId)
    if (id) engine.stop(id)
    return engine.getState()
  })
  ipcMain.handle(IpcChannels.removeFromList, (_e, taskId: unknown) => {
    const id = asKnownId(taskId)
    if (id) engine.removeFromList(id)
    return engine.getState()
  })
  ipcMain.handle(IpcChannels.addManualTask, (_e, input: ManualTaskInput) => {
    // Sanitize at the trust boundary: require a non-empty name, and only forward
    // space/list when they are strings, so the engine's `.trim()` can't be handed
    // a non-string from a malformed payload.
    const name = typeof input?.name === 'string' ? input.name : ''
    if (name.trim().length > 0) {
      engine.addManualTask({
        name,
        space: typeof input.space === 'string' ? input.space : undefined,
        list: typeof input.list === 'string' ? input.list : undefined
      })
    }
    return engine.getState()
  })
}

/**
 * The 1s display tick. It pushes a fresh snapshot only while a timer runs — a
 * fully paused session needs no ticking (the last operation already pushed the
 * final numbers). Checking `hasRunning()` first (O(1)) means an idle, tray-hidden
 * app skips the log re-derive entirely, not just the IPC send.
 */
function startTick(engine: CadenceEngine): void {
  tickTimer = setInterval(() => {
    if (!engine.hasRunning()) return
    broadcastState(engine.getState())
  }, 1000)
}

function writeSmokeResult(ok: boolean, report: SmokeReport | null, screenshotPath: string): void {
  if (!SMOKE_OUT) return
  const result = {
    ok,
    rendererErrors,
    report,
    screenshotPath,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    }
  }
  mkdirSync(SMOKE_OUT, { recursive: true })
  writeFileSync(join(SMOKE_OUT, 'smoke-result.json'), JSON.stringify(result, null, 2))
}

function smokePasses(report: SmokeReport): boolean {
  const nodeHidden = Object.values(report.nodeReach).every((t) => t === 'undefined')
  const fontsOk = Object.values(report.fonts).every(Boolean)
  return rendererErrors.length === 0 && nodeHidden && fontsOk && report.pong === 'pong'
}

function registerSmoke(): void {
  if (!SMOKE) return

  // Watchdog: never hang. If the renderer never reports (e.g. a broken bridge),
  // fail closed after a generous window.
  setTimeout(() => {
    if (smokeDone) return
    smokeDone = true
    rendererErrors.push('smoke timeout: renderer never reported')
    writeSmokeResult(false, null, '')
    app.exit(1)
  }, 12000)

  ipcMain.on(IpcChannels.smokeReport, async (_event, report: SmokeReport) => {
    if (smokeDone) return
    smokeDone = true
    let screenshotPath = ''
    try {
      if (mainWindow && SMOKE_OUT) {
        const img = await mainWindow.webContents.capturePage()
        mkdirSync(SMOKE_OUT, { recursive: true })
        screenshotPath = join(SMOKE_OUT, 'smoke.png')
        writeFileSync(screenshotPath, img.toPNG())
      }
    } catch (err) {
      rendererErrors.push(`capturePage failed: ${String(err)}`)
    }
    const ok = smokePasses(report)
    writeSmokeResult(ok, report, screenshotPath)
    // Let the file flush, then exit with a meaningful code.
    setTimeout(() => app.exit(ok ? 0 : 1), 200)
  })
}

interface VerifyResult {
  name: string
  pass: boolean
  detail: string
}

// Runs INSIDE the renderer (where `window.cadence` lives), driving the real
// preload→main→engine path. Assertions are on membership / ordering / counts /
// transitions only — never exact ms, since the engine uses the real clock here.
const IPC_VERIFY_SCRIPT = `(async () => {
  const c = window.cadence
  const out = []
  const A = (name, cond, detail) => out.push({ name, pass: !!cond, detail: detail === undefined ? '' : String(detail) })
  const find = (s, n) => [...s.active, ...s.paused].find((t) => t.name === n)

  let s = await c.getState()
  A('fresh session: 0 active / 0 paused', s.active.length === 0 && s.paused.length === 0, s.active.length + '/' + s.paused.length)

  s = await c.addManualTask({ name: 'Alpha' })
  A('addManual Alpha -> 1 paused / 0 active / pausedCount 1', s.paused.length === 1 && s.active.length === 0 && s.pausedCount === 1)
  const alpha = find(s, 'Alpha')
  A('Alpha is a manual paused row (source manual, code null)', !!alpha && alpha.source === 'manual' && alpha.code === null)

  s = await c.addManualTask({ name: 'Beta' })
  A('addManual Beta -> 2 paused / pausedCount 2', s.paused.length === 2 && s.pausedCount === 2)
  const beta = find(s, 'Beta')

  s = await c.start(alpha.id)
  A('start Alpha -> active 1 / paused 1 / running 1 / idle 1', s.active.length === 1 && s.paused.length === 1 && s.runningCount === 1 && s.pausedCount === 1)
  A('start Alpha -> Alpha is active and running', !!s.active[0] && s.active[0].name === 'Alpha' && s.active[0].running === true)

  s = await c.start(beta.id)
  A('start Beta (parallel) -> active 2 / paused 0 / running 2', s.active.length === 2 && s.paused.length === 0 && s.runningCount === 2)
  A('ACTIVE order = most-recently-started first (Beta, Alpha)', s.active[0].name === 'Beta' && s.active[1].name === 'Alpha')
  A('union session total >= max single-task elapsed (no double-count)', s.sessionWorkedMs >= Math.max(s.active[0].sessionElapsedMs, s.active[1].sessionElapsedMs))

  s = await c.start(beta.id)
  A('start already-running Beta is idempotent (active stays 2)', s.active.length === 2 && s.runningCount === 2)

  s = await c.stop(alpha.id)
  A('stop Alpha -> active 1 (Beta) / paused 1 (Alpha)', s.active.length === 1 && s.active[0].name === 'Beta' && s.paused.length === 1 && s.paused[0].name === 'Alpha')

  s = await c.removeFromList(alpha.id)
  A('remove paused Alpha -> paused 0 / pausedCount 0; Beta stays active', s.paused.length === 0 && s.pausedCount === 0 && s.active.length === 1 && s.active[0].name === 'Beta')

  return out
})()`

function writeIpcResult(ok: boolean, results: VerifyResult[], error: string | null): void {
  if (!IPCTEST_OUT) return
  mkdirSync(IPCTEST_OUT, { recursive: true })
  writeFileSync(
    join(IPCTEST_OUT, 'ipc-result.json'),
    JSON.stringify({ ok, results, error, rendererErrors }, null, 2)
  )
}

function registerIpcVerify(): void {
  if (!IPCTEST) return
  const win = mainWindow

  if (!win) {
    writeIpcResult(false, [], 'ipc-verify: no window')
    app.exit(1)
    return
  }

  let done = false
  const watchdog = setTimeout(() => {
    if (done) return
    done = true
    writeIpcResult(false, [], 'ipc-verify timeout: sequence never completed')
    app.exit(1)
  }, 15000)

  win.webContents.once('did-finish-load', () => {
    void (async () => {
      try {
        const results = (await win.webContents.executeJavaScript(
          IPC_VERIFY_SCRIPT
        )) as VerifyResult[]
        if (done) return
        done = true
        clearTimeout(watchdog)
        // Require a non-empty result set so an accidental empty array can't read
        // as a vacuous pass.
        const ok =
          Array.isArray(results) &&
          results.length > 0 &&
          results.every((r) => r.pass) &&
          rendererErrors.length === 0
        writeIpcResult(ok, results, null)
        setTimeout(() => app.exit(ok ? 0 : 1), 200)
      } catch (err) {
        if (done) return
        done = true
        clearTimeout(watchdog)
        writeIpcResult(false, [], `executeJavaScript threw: ${String(err)}`)
        app.exit(1)
      }
    })()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.lucachech.cadence')

  // IPC integration harness runs on an ISOLATED userData dir so it never reads or
  // pollutes the real worklog. Fail closed if the isolation dir is missing rather
  // than silently driving the harness against real data. Set before engine.create
  // reads the path.
  if (IPCTEST) {
    if (!IPCTEST_DIR) {
      writeIpcResult(false, [], 'CADENCE_IPCTEST_DIR not set — refusing to touch the real userData')
      app.exit(1)
      return
    }
    app.setPath('userData', IPCTEST_DIR)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  registerSmoke()

  // Instantiate the engine once, on the real userData dir, with the system clock.
  // create() closes any intervals a prior crash left open and begins a fresh
  // session (0 totals). Everything the UI shows derives from this instance.
  const engine = CadenceEngine.create({ dir: app.getPath('userData'), now: Date.now })
  registerDomainIpc(engine)
  startTick(engine)

  createWindow()
  registerIpcVerify()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Stop the display tick before exit so it never outlives the app (auto-pause of
// running timers on quit/suspend/lock is Phase 4; crash-close already prevents
// phantom time on the next launch).
app.on('will-quit', () => {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
})

// Stage 1: no tray yet, so quitting on all-windows-closed keeps dev/smoke sane.
// Phase 4 switches this to minimise-to-tray (close hides; only the tray Quit exits).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
