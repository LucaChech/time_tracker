import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  screen,
  powerMonitor
} from 'electron'
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IpcChannels, type AppInfo, type SmokeReport } from '@shared/ipc'
import type { EventSource, ManualTaskInput, StateSnapshot } from '@shared/types'
import { CadenceEngine } from './engine'
import { computeFlyoutPosition } from './window/position'
import { formatTrayTooltip, shouldHideOnBlur } from './window/format'

/**
 * Cadence main process.
 *
 * Stage 1 stood up one frameless, transparent, always-on-top window. Stage 3b
 * wired it to the engine over typed IPC. Stage 4 gives it the "flyout" feel: a
 * tray icon whose tooltip is the session total; click-to-toggle positioned above
 * the taskbar; content-driven sizing; minimize/close hide to the tray while the
 * session stays alive (Quit only via the tray); auto-pause on suspend/lock/quit;
 * hide-on-blur (disabled in dev / when DevTools is focused); autostart; and a
 * single-instance lock that shows + repositions the existing flyout.
 */

// Panel is a fixed 380px (`.flyout` is `flex: none`). The transparent window adds
// a gutter on every side so the panel's ambient CSS shadow isn't clipped. GUTTER
// must match `.stage` padding in flyout.css (14px) or the shadow clips / a margin
// shows.
const FLYOUT_GUTTER = 14
const PANEL_WIDTH = 380
const FLYOUT_WIDTH = PANEL_WIDTH + FLYOUT_GUTTER * 2 // 408
// The window height is content-driven (the renderer reports its panel height and
// main sizes to fit, clamping to the work area — then the PAUSED list scrolls).
// These bound the first frame before the renderer's first report arrives.
const FLYOUT_DEFAULT_HEIGHT = 560
const FLYOUT_MIN_HEIGHT = 200

// On Windows, clicking the tray icon blurs the flyout FIRST (so hide-on-blur fires)
// and THEN delivers the tray 'click' — without a guard a click-to-close would
// immediately re-open. If the window was hidden by a blur within this window, the
// tray click is treated as the "close" gesture and leaves it hidden.
const TRAY_REOPEN_GUARD_MS = 250

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

// Stage-4 tray/window harness. When CADENCE_TRAYTEST=1 the app boots on an
// ISOLATED userData dir (CADENCE_TRAYTEST_DIR) with the real tray + window
// behavior wired, then drives show/hide/close-to-tray/suspend-auto-pause/
// blur-hide/autostart/second-instance in the MAIN process and asserts observable
// window+engine state. Driven by scripts/tray-verify.mjs; writes tray-result.json
// to CADENCE_TRAYTEST_OUT. Off in normal use.
const TRAYTEST = process.env.CADENCE_TRAYTEST === '1'
const TRAYTEST_OUT = process.env.CADENCE_TRAYTEST_OUT
const TRAYTEST_DIR = process.env.CADENCE_TRAYTEST_DIR

// Any automated harness. Harnesses run the unpackaged build via `electron .`, so
// `is.dev` (= !app.isPackaged) is TRUE for them — but they must behave like the
// shipped app (hidden start, hide-on-blur). `isDevMode` is the real "developer is
// running `npm run dev`" flag: dev, and not under a harness.
const HARNESS = SMOKE || IPCTEST || TRAYTEST
const isDevMode = is.dev && !HARNESS

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let engineRef: CadenceEngine | null = null
// Epoch ms of the last blur-driven hide — see TRAY_REOPEN_GUARD_MS.
let lastBlurHideAt = 0
// Set if a second launch arrives before the window exists, so ready-to-show reveals
// it (a startup double-launch would otherwise leave the app resident-but-hidden).
let pendingShow = false
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
    height: FLYOUT_DEFAULT_HEIGHT,
    show: false,
    frame: false, // frameless flyout — custom title bar lives in the renderer
    transparent: true, // panel draws its own rounded corners over a transparent window
    backgroundColor: '#00000000', // fully transparent — guards against black corners on Windows
    resizable: false, // no user drag-resize; main still sizes it programmatically
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
    // Production + harnesses launch hidden (the tray reveals the flyout). SMOKE
    // shows it so the shell is observable for the screenshot; a real dev run shows
    // it positioned as a flyout so development mirrors the shipped feel.
    if (SMOKE) {
      mainWindow?.show()
    } else if (isDevMode || pendingShow) {
      // pendingShow: a second launch raced in before the window existed.
      pendingShow = false
      showFlyout()
    }
  })

  // Stage-4 hide-on-blur. Skipped for the SMOKE/IPCTEST harnesses, which drive the
  // bare shell and exit via app.exit. We deliberately do NOT veto the window
  // `close` event: the ×/minimize controls hide-to-tray over IPC (below), and
  // vetoing `close` would block/delay a Windows shutdown or logout — `before-quit`
  // is not emitted on Windows session-end, so a veto has no reliable "let a real
  // quit through" escape. Alt+F4 / OS-close therefore ends the session gracefully
  // (window-all-closed → app.quit → before-quit → engine.quit stops timers).
  if (!SMOKE && !IPCTEST) {
    mainWindow.on('blur', handleBlur)
  }

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

// ── Stage 4: tray + flyout window behavior ───────────────────────────────────

/** Create the tray icon: tooltip = the session total, click toggles the flyout,
 *  right-click menu offers Show/Hide + Quit. Quit is the ONLY way to end a
 *  session. Wrapped so a tray-image failure logs rather than crashes launch. */
function createTray(): void {
  if (tray) return
  try {
    const image = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
    tray = new Tray(image)
  } catch (err) {
    console.error('[cadence] failed to create tray', err)
    // Degrade safely: the tray is the ONLY reveal + Quit affordance, so without it
    // a hidden window is an unquittable zombie. Give the window a taskbar button and
    // show it, so the user can at least see and close it (Alt+F4 → graceful quit).
    mainWindow?.setSkipTaskbar(false)
    showFlyout()
    return
  }
  tray.setToolTip(formatTrayTooltip(0, 0))
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide Cadence', click: () => toggleFlyout() },
    { type: 'separator' },
    // Quit ends the session (before-quit stops running timers via engine.quit()).
    { label: 'Quit Cadence', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  // Left-click toggles (with the blur-race guard); the context menu covers right-click.
  tray.on('click', () => handleTrayClick())
}

/** Position the flyout above the taskbar near the tray, clamped fully into the
 *  primary display's work area (handles top/left/right taskbars, not just bottom). */
function positionFlyout(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const primary = screen.getPrimaryDisplay()
  const trayBounds = tray?.getBounds() ?? null
  const { width, height } = mainWindow.getBounds()
  const { x, y } = computeFlyoutPosition(
    { width, height },
    trayBounds && trayBounds.width > 0 ? trayBounds : null,
    primary.workArea,
    primary.bounds
  )
  mainWindow.setPosition(x, y)
}

/** Reposition, then show + focus. Used by tray click, the second-instance handler,
 *  and (in dev) ready-to-show — all of which must reveal the default-hidden flyout. */
function showFlyout(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  positionFlyout()
  mainWindow.show()
  mainWindow.focus()
}

function hideFlyout(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
}

function toggleFlyout(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isVisible()) hideFlyout()
  else showFlyout()
}

/** Blur → hide, unless in dev or DevTools is focused (else dev is unusable).
 *  Stamps the hide so a tray click that CAUSED the blur doesn't re-open it. */
function handleBlur(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!mainWindow.isVisible()) return
  const devToolsFocused = mainWindow.webContents.isDevToolsFocused()
  if (shouldHideOnBlur({ isDev: isDevMode, devToolsFocused })) {
    lastBlurHideAt = Date.now()
    hideFlyout()
  }
}

/** Tray left-click. Visible → hide. Hidden → show, UNLESS a blur just hid it (the
 *  same click that blurred the window), in which case the click is the "close"
 *  gesture and it stays hidden. */
function handleTrayClick(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isVisible()) {
    hideFlyout()
  } else if (Date.now() - lastBlurHideAt >= TRAY_REOPEN_GUARD_MS) {
    showFlyout()
  }
}

/**
 * Size the transparent window to the panel's natural content height (reported by
 * the renderer), plus the shadow gutter, clamped to the work area — beyond which
 * the PAUSED list scrolls internally. Re-anchors afterwards so the flyout's bottom
 * stays pinned to the taskbar edge as the list grows/shrinks.
 */
function applyPanelHeight(panelHeight: number): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const workAreaHeight = screen.getPrimaryDisplay().workArea.height
  const target = Math.round(panelHeight + FLYOUT_GUTTER * 2)
  const height = Math.max(FLYOUT_MIN_HEIGHT, Math.min(target, workAreaHeight))
  const bounds = mainWindow.getBounds()
  if (Math.abs(bounds.height - height) <= 1) return // no-op guards a resize/report loop
  mainWindow.setSize(FLYOUT_WIDTH, height)
  positionFlyout()
}

/** Auto-pause on system suspend / screen lock: stop every running timer, then
 *  refresh the UI + tray so they reflect the paused state. */
function handleAutoPause(source: Extract<EventSource, 'suspend' | 'lock'>): void {
  if (!engineRef) return
  engineRef.stopAllRunning(source)
  pushState(engineRef.getState())
}

/** Autostart on login. Programmatic write only — the real reboot proof is the
 *  Stage-6 human gate. Enabled in the shipped app; the harness drives it explicitly. */
function applyAutostart(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled })
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

// ── Stage 3b/4: live state wiring (UI ↔ engine over IPC) ─────────────────────

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

/** Keep the tray tooltip in step with the session total (Stage-4). Safe before
 *  the tray exists (idle no-op). */
function updateTray(state: StateSnapshot): void {
  tray?.setToolTip(formatTrayTooltip(state.sessionWorkedMs, state.runningCount))
}

/** Broadcast to the renderer AND refresh the tray tooltip from one snapshot. */
function pushState(state: StateSnapshot): void {
  broadcastState(state)
  updateTray(state)
}

/**
 * Domain IPC. Each operation runs on the engine (which owns all logic and
 * persistence), then returns the freshly derived snapshot so the calling
 * renderer updates immediately — no round-trip wait for the next tick. The tray
 * tooltip is refreshed from the same snapshot. Inputs are validated defensively
 * even though the only caller is our own preload.
 */
function registerDomainIpc(engine: CadenceEngine): void {
  // Accept an id only if it's a non-empty string AND names a task the engine can
  // render — never trust an arbitrary id from IPC. Guarding here means a start
  // can't open a phantom, unstoppable interval for an id with no row to stop it.
  const asKnownId = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 && engine.hasTask(v) ? v : null

  // Derive once, refresh the tray, and hand the same snapshot back to the caller.
  const reply = (): StateSnapshot => {
    const state = engine.getState()
    updateTray(state)
    return state
  }

  ipcMain.handle(IpcChannels.getState, () => reply())

  ipcMain.handle(IpcChannels.start, (_e, taskId: unknown) => {
    const id = asKnownId(taskId)
    if (id) engine.start(id)
    return reply()
  })
  ipcMain.handle(IpcChannels.stop, (_e, taskId: unknown) => {
    const id = asKnownId(taskId)
    if (id) engine.stop(id)
    return reply()
  })
  ipcMain.handle(IpcChannels.removeFromList, (_e, taskId: unknown) => {
    const id = asKnownId(taskId)
    if (id) engine.removeFromList(id)
    return reply()
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
    return reply()
  })
}

/** Stage-4 window controls (fire-and-forget). Minimize + close both hide to the
 *  tray (the session stays alive); resize reports the panel's content height. */
function registerWindowIpc(): void {
  ipcMain.on(IpcChannels.minimizeWindow, () => hideFlyout())
  ipcMain.on(IpcChannels.closeWindow, () => hideFlyout())
  ipcMain.on(IpcChannels.resizeWindow, (_e, panelHeight: unknown) => {
    if (typeof panelHeight === 'number' && Number.isFinite(panelHeight)) {
      applyPanelHeight(panelHeight)
    }
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
    pushState(engine.getState())
  }, 1000)
}

/** Register auto-pause (suspend/lock) + graceful-quit auto-stop. `before-quit`
 *  stops every running timer so a graceful Quit records an accurate final span
 *  (closes the two Stage-3b-deferred items). Fires for every quit path that runs
 *  through `app.quit()` — tray Quit, Cmd+Q, and Alt+F4/OS-close via
 *  window-all-closed. `stopAllRunning` is idempotent, so a suspend-then-quit is
 *  safe; `appendEvent` is synchronous, so the stops flush before the process exits. */
function wirePowerAndQuit(): void {
  powerMonitor.on('suspend', () => handleAutoPause('suspend'))
  powerMonitor.on('lock-screen', () => handleAutoPause('lock'))
  app.on('before-quit', () => {
    engineRef?.quit()
  })
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

function writeTrayResult(ok: boolean, results: VerifyResult[], error: string | null): void {
  if (!TRAYTEST_OUT) return
  mkdirSync(TRAYTEST_OUT, { recursive: true })
  writeFileSync(
    join(TRAYTEST_OUT, 'tray-result.json'),
    JSON.stringify({ ok, results, error, rendererErrors }, null, 2)
  )
}

/**
 * Stage-4 tray/window verify. Drives the real tray + window behavior in the MAIN
 * process (the seams live here, not the renderer) and asserts observable window +
 * engine state: hidden start, tray toggle shows within the work area, hide-to-tray
 * keeps the session alive, suspend auto-pauses, blur hides, second-instance
 * shows+repositions, autostart is written, and the height clamps to the work area.
 */
function registerTrayVerify(engine: CadenceEngine): void {
  if (!TRAYTEST) return
  const win = mainWindow
  if (!win) {
    writeTrayResult(false, [], 'tray-verify: no window')
    app.exit(1)
    return
  }

  let done = false
  const watchdog = setTimeout(() => {
    if (done) return
    done = true
    writeTrayResult(false, [], 'tray-verify timeout: sequence never completed')
    app.exit(1)
  }, 15000)

  win.webContents.once('did-finish-load', () => {
    if (done) return
    done = true
    clearTimeout(watchdog)

    const results: VerifyResult[] = []
    const A = (name: string, cond: boolean, detail: unknown = ''): void => {
      results.push({ name, pass: !!cond, detail: String(detail) })
    }
    try {
      const workArea = screen.getPrimaryDisplay().workArea
      const withinWork = (b: Electron.Rectangle): boolean =>
        b.x >= workArea.x - 1 &&
        b.y >= workArea.y - 1 &&
        b.x + b.width <= workArea.x + workArea.width + 1 &&
        b.y + b.height <= workArea.y + workArea.height + 1

      // Every step drives the REAL seam (tray/window/powerMonitor/ipcMain event),
      // not the private helper, so the fragile glue — tray-click wiring + blur-race
      // guard, the `blur` listener, the powerMonitor event names, the second-instance
      // handler, and the close IPC — is actually exercised, not bypassed.
      A('flyout starts hidden (tray-driven reveal)', !win.isVisible())

      // Real tray left-click (→ handleTrayClick, incl. the blur-race guard).
      tray?.emit('click')
      A('tray click shows the flyout', win.isVisible())
      A(
        'shown flyout sits within the work area',
        withinWork(win.getBounds()),
        JSON.stringify(win.getBounds())
      )
      A(
        'flyout width = panel + shadow gutter (408)',
        win.getBounds().width === FLYOUT_WIDTH,
        win.getBounds().width
      )

      tray?.emit('click')
      A('tray click again hides the flyout', !win.isVisible())

      // Close (×) over the REAL IPC handler — hides to tray, window survives (session alive).
      showFlyout()
      ipcMain.emit(IpcChannels.closeWindow)
      A('close IPC hides to tray, keeps the window alive', !win.isVisible() && !win.isDestroyed())

      // Auto-pause via the REAL powerMonitor 'suspend' event (proves the event name).
      const task = engine.addManualTask({ name: 'traytest-suspend' })
      engine.start(task.id)
      A('precondition: a timer is running before suspend', engine.hasRunning())
      powerMonitor.emit('suspend')
      A('powerMonitor suspend auto-pauses running timers', !engine.hasRunning())

      // Blur via the REAL window 'blur' event (isDevMode false under the harness).
      showFlyout()
      win.emit('blur')
      A('window blur hides the flyout (prod, DevTools unfocused)', !win.isVisible())

      // Second-instance via the REAL app handler (show + reposition the hidden flyout).
      A('precondition: flyout hidden before second-instance', !win.isVisible())
      app.emit('second-instance', {}, [], '')
      A(
        'second-instance shows + repositions the flyout',
        win.isVisible() && withinWork(win.getBounds())
      )

      // Autostart write path (programmatic proxy; real reboot proof is Stage 6).
      // Snapshot + restore the real login item so the harness never clobbers it.
      const priorAutostart = app.getLoginItemSettings().openAtLogin
      applyAutostart(true)
      A('autostart login item is written', app.getLoginItemSettings().openAtLogin === true)
      applyAutostart(priorAutostart) // restore whatever the user had, don't clobber

      // Content-driven height clamps to the work area (then PAUSED scrolls).
      applyPanelHeight(100000)
      A(
        'window height clamps to the work area',
        win.getBounds().height <= workArea.height,
        win.getBounds().height
      )
    } catch (err) {
      A('sequence threw', false, String(err))
    }

    const ok = results.length > 0 && results.every((r) => r.pass) && rendererErrors.length === 0
    writeTrayResult(ok, results, null)
    setTimeout(() => app.exit(ok ? 0 : 1), 200)
  })
}

// Single-instance lock: the flyout is hidden by default, so a second launch must
// SHOW + reposition the existing window (not merely focus an invisible one) — or,
// if it raced in before the window exists, mark it for reveal on ready-to-show.
// Acquiring the lock is skipped under harnesses (they run isolated single instances),
// but the `second-instance` handler is registered unconditionally so the tray
// harness can drive the REAL handler via `app.emit('second-instance', …)`.
const gotSingleInstanceLock = HARNESS ? true : app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}
app.on('second-instance', () => {
  if (mainWindow) showFlyout()
  else pendingShow = true
})

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return

  electronApp.setAppUserModelId('com.lucachech.cadence')

  // Both integration harnesses run on an ISOLATED userData dir so they never read
  // or pollute the real worklog. Fail closed if the isolation dir is missing rather
  // than silently driving against real data. Set before engine.create reads the path.
  if (IPCTEST) {
    if (!IPCTEST_DIR) {
      writeIpcResult(false, [], 'CADENCE_IPCTEST_DIR not set — refusing to touch the real userData')
      app.exit(1)
      return
    }
    app.setPath('userData', IPCTEST_DIR)
  }
  if (TRAYTEST) {
    if (!TRAYTEST_DIR) {
      writeTrayResult(
        false,
        [],
        'CADENCE_TRAYTEST_DIR not set — refusing to touch the real userData'
      )
      app.exit(1)
      return
    }
    app.setPath('userData', TRAYTEST_DIR)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  registerSmoke()

  // Instantiate the engine once, on the real (or isolated) userData dir, with the
  // system clock. create() closes any intervals a prior crash left open and begins
  // a fresh session (0 totals). Everything the UI shows derives from this instance.
  const engine = CadenceEngine.create({ dir: app.getPath('userData'), now: Date.now })
  engineRef = engine
  registerDomainIpc(engine)
  startTick(engine)

  createWindow()

  // Stage-4 tray + window lifecycle. Skipped for SMOKE/IPCTEST, which drive the bare
  // shell — the window-control + resize IPC is gated with them so the renderer's
  // autosize can't reshape the SMOKE screenshot mid-capture.
  if (!SMOKE && !IPCTEST) {
    registerWindowIpc()
    createTray()
    wirePowerAndQuit()
    // Autostart only in the shipped app — a dev/`electron .` run shouldn't register
    // itself for login. The tray harness drives applyAutostart explicitly instead.
    if (app.isPackaged) applyAutostart(true)
  }

  registerIpcVerify()
  registerTrayVerify(engine)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Stop the display tick and remove the tray before exit so neither outlives the
// app. Running timers are auto-stopped by `before-quit` (engine.quit()); crash-
// close still prevents phantom time on the next launch.
app.on('will-quit', () => {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
  tray?.destroy()
  tray = null
})

// The flyout hides to the tray instead of closing, so windows normally stay open
// for the life of the session; this only fires on a genuine quit (window
// destroyed). Kept so dev/smoke without a tray still exit cleanly on non-macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
