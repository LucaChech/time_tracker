import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannels, type CadenceApi, type SmokeReport } from '@shared/ipc'
import type { CatalogueMeta, ManualTaskInput, StateSnapshot } from '@shared/types'

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
  reportSmoke: (report: SmokeReport) => ipcRenderer.send(IpcChannels.smokeReport, report),

  // Stage 3b domain surface — thin invoke wrappers; main owns all logic.
  getState: () => ipcRenderer.invoke(IpcChannels.getState),
  start: (taskId: string) => ipcRenderer.invoke(IpcChannels.start, taskId),
  stop: (taskId: string) => ipcRenderer.invoke(IpcChannels.stop, taskId),
  addManualTask: (input: ManualTaskInput) => ipcRenderer.invoke(IpcChannels.addManualTask, input),
  removeFromList: (taskId: string) => ipcRenderer.invoke(IpcChannels.removeFromList, taskId),
  onStateUpdate: (cb: (state: StateSnapshot) => void) => {
    // Wrap so the renderer callback never sees the Electron event object, and
    // hand back an unsubscribe so React effects can detach on unmount.
    const listener = (_event: IpcRendererEvent, state: StateSnapshot): void => cb(state)
    ipcRenderer.on(IpcChannels.stateUpdate, listener)
    return () => ipcRenderer.removeListener(IpcChannels.stateUpdate, listener)
  },

  // Stage 4 window surface — fire-and-forget; main owns all window geometry.
  minimize: () => ipcRenderer.send(IpcChannels.minimizeWindow),
  close: () => ipcRenderer.send(IpcChannels.closeWindow),
  resizeTo: (panelHeight: number) => ipcRenderer.send(IpcChannels.resizeWindow, panelHeight),

  // Stage 5b ClickUp integration surface — thin invoke wrappers + one push sub.
  getCatalogueMeta: () => ipcRenderer.invoke(IpcChannels.getCatalogueMeta),
  refreshCatalogue: () => ipcRenderer.invoke(IpcChannels.refreshCatalogue),
  setClickUpToken: (token: string) => ipcRenderer.invoke(IpcChannels.setClickUpToken, token),
  onCatalogueMeta: (cb: (meta: CatalogueMeta) => void) => {
    const listener = (_event: IpcRendererEvent, meta: CatalogueMeta): void => cb(meta)
    ipcRenderer.on(IpcChannels.catalogueMetaUpdate, listener)
    return () => ipcRenderer.removeListener(IpcChannels.catalogueMetaUpdate, listener)
  },
  onOpenConnect: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(IpcChannels.openConnect, listener)
    return () => ipcRenderer.removeListener(IpcChannels.openConnect, listener)
  }
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
