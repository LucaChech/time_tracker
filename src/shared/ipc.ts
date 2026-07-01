/**
 * Shared IPC contract between the main process and the renderer (crossed via the
 * typed `contextBridge` preload). This file is the single source of truth for
 * channel names and payload shapes; main, preload and renderer all import it.
 *
 * Stage 1 kept the surface tiny (ping/appinfo/smoke). Stage 3b adds the domain
 * surface: the renderer reads the derived {@link StateSnapshot} and drives the
 * engine's operations — but never runs business logic itself. All timing, union
 * and sort math stays in main; the renderer is a pure projection of the snapshot
 * main sends it.
 */

import type { ManualTaskInput, StateSnapshot } from './types'

export const IpcChannels = {
  /** Renderer → main → 'pong'. Smoke-proof that the typed bridge round-trips. */
  ping: 'cadence:ping',
  /** Renderer → main → AppInfo. App + runtime versions for the shell footer. */
  getAppInfo: 'cadence:get-app-info',
  /** Renderer → main (fire-and-forget). Stage-1 smoke self-check report. */
  smokeReport: 'cadence:smoke-report',

  // ── Stage 3b domain surface ──────────────────────────────────────────────
  /** Renderer → main → current {@link StateSnapshot} (initial load). */
  getState: 'cadence:get-state',
  /** Renderer → main → fresh snapshot after starting a task's timer. */
  start: 'cadence:start',
  /** Renderer → main → fresh snapshot after stopping a task's timer. */
  stop: 'cadence:stop',
  /** Renderer → main → fresh snapshot after adding an ad-hoc task. */
  addManualTask: 'cadence:add-manual-task',
  /** Renderer → main → fresh snapshot after session-hiding a paused row. */
  removeFromList: 'cadence:remove-from-list',
  /** Main → renderer (push). A fresh snapshot on the 1s tick while timers run. */
  stateUpdate: 'cadence:state-update'
} as const

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
}

/**
 * Self-check the renderer pushes to main during the Stage-1 smoke test.
 * Used to machine-verify the security posture and offline fonts without a human.
 */
export interface SmokeReport {
  /**
   * Runtime `typeof` of each Node/Electron global as seen from the renderer.
   * With contextIsolation:true + nodeIntegration:false + sandbox:true every value
   * MUST be 'undefined' — this is the negative proof that the renderer cannot
   * reach Node, not merely that it was configured to.
   */
  nodeReach: Record<string, string>
  /** Whether each required self-hosted font family resolved (document.fonts.check). */
  fonts: Record<string, boolean>
  /** Result of window.cadence.ping() — proves the bridge is wired end to end. */
  pong: string
}

/** The typed surface exposed on `window.cadence` by the preload bridge. */
export interface CadenceApi {
  ping: () => Promise<string>
  getAppInfo: () => Promise<AppInfo>
  /** Stage-1 smoke only: renderer reports its self-check to main. */
  reportSmoke: (report: SmokeReport) => void

  // ── Stage 3b domain surface ──────────────────────────────────────────────
  /** Fetch the current session snapshot (used once on mount). */
  getState: () => Promise<StateSnapshot>
  /** Start a task's timer (paused → active). Resolves with the fresh snapshot. */
  start: (taskId: string) => Promise<StateSnapshot>
  /** Stop a task's timer (active → paused). Resolves with the fresh snapshot. */
  stop: (taskId: string) => Promise<StateSnapshot>
  /** Add an ad-hoc task not in ClickUp. Resolves with the fresh snapshot. */
  addManualTask: (input: ManualTaskInput) => Promise<StateSnapshot>
  /** Session-hide a paused task (reappears next launch). Fresh snapshot back. */
  removeFromList: (taskId: string) => Promise<StateSnapshot>
  /**
   * Subscribe to main's pushed snapshots (the 1s live tick). The callback fires
   * with each new snapshot; returns an unsubscribe that detaches the listener.
   */
  onStateUpdate: (cb: (state: StateSnapshot) => void) => () => void
}
