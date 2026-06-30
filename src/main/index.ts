import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IpcChannels, type AppInfo, type SmokeReport } from '@shared/ipc'

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

let mainWindow: BrowserWindow | null = null
let smokeDone = false
const rendererErrors: string[] = []

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

  // External links open in the user's browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(IpcChannels.ping, () => 'pong')
  ipcMain.handle(
    IpcChannels.getAppInfo,
    (): AppInfo => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    })
  )
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.lucachech.cadence')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()
  registerSmoke()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Stage 1: no tray yet, so quitting on all-windows-closed keeps dev/smoke sane.
// Phase 4 switches this to minimise-to-tray (close hides; only the tray Quit exits).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
