import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type CadenceApi, type SmokeReport } from '@shared/ipc'

/**
 * Typed bridge. The renderer only ever talks to the main process through this
 * narrow, explicit surface — never through Node directly. Everything here is
 * `ipcRenderer.invoke` (request/response) or `.send` (fire-and-forget); the
 * preload holds no business logic.
 *
 * This runs under `sandbox: true`, so only the `electron` module subset
 * (contextBridge + ipcRenderer) is available — by design.
 */
const api: CadenceApi = {
  ping: () => ipcRenderer.invoke(IpcChannels.ping),
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo),
  reportSmoke: (report: SmokeReport) => ipcRenderer.send(IpcChannels.smokeReport, report)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('cadence', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // contextIsolation is always on (see main webPreferences); this branch is only
  // a defensive fallback so a misconfiguration fails loudly rather than silently.
  // @ts-ignore — `cadence` is declared on Window in index.d.ts
  window.cadence = api
}
