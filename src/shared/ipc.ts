/**
 * Shared IPC contract between the main process and the renderer (crossed via the
 * typed `contextBridge` preload). This file is the single source of truth for
 * channel names and payload shapes; main, preload and renderer all import it.
 *
 * Stage 1 keeps the surface intentionally tiny — just what proves the shell and
 * the bridge work. Real domain operations (timers, catalogue, persistence) are
 * added in later phases against this same pattern.
 */

export const IpcChannels = {
  /** Renderer → main → 'pong'. Smoke-proof that the typed bridge round-trips. */
  ping: 'cadence:ping',
  /** Renderer → main → AppInfo. App + runtime versions for the shell footer. */
  getAppInfo: 'cadence:get-app-info',
  /** Renderer → main (fire-and-forget). Stage-1 smoke self-check report. */
  smokeReport: 'cadence:smoke-report'
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
}
