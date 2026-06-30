import { useEffect, useState, type JSX } from 'react'
import type { AppInfo, SmokeReport } from '@shared/ipc'

const REQUIRED_FONTS = ['Space Grotesk', 'Work Sans', 'Material Symbols Outlined']
// If contextIsolation/nodeIntegration/sandbox hold, every one of these is undefined
// in the renderer. The Stage-1 smoke harness asserts exactly that.
const NODE_GLOBALS = ['require', 'process', 'module', 'global', 'Buffer', '__dirname']

function Icon({ name, className }: { name: string; className?: string }): JSX.Element {
  return (
    <span className={`material-symbols-outlined${className ? ` ${className}` : ''}`}>{name}</span>
  )
}

function App(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  // Pull app + runtime info across the typed bridge (also proves IPC invoke works).
  useEffect(() => {
    let alive = true
    window.cadence
      .getAppInfo()
      .then((i) => alive && setInfo(i))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // Stage-1 smoke self-check. A harmless no-op in normal runs (main only listens
  // when CADENCE_SMOKE=1); under the harness it reports the security + font proof.
  useEffect(() => {
    let alive = true
    async function runSmoke(): Promise<void> {
      try {
        await document.fonts.ready
        if (!alive) return
        const w = globalThis as unknown as Record<string, unknown>
        const nodeReach: Record<string, string> = {}
        for (const g of NODE_GLOBALS) nodeReach[g] = typeof w[g]
        // Faces load lazily — a weight the shell never renders (e.g. Space Grotesk 400)
        // is otherwise never fetched, so check() would report false for a font that IS
        // bundled. load() forces the fetch from the local bundle and resolves once it's
        // available, which is exactly what "self-hosted, offline" should prove.
        await Promise.all(REQUIRED_FONTS.map((f) => document.fonts.load(`16px "${f}"`)))
        if (!alive) return
        const fonts: Record<string, boolean> = {}
        for (const f of REQUIRED_FONTS) fonts[f] = document.fonts.check(`16px "${f}"`)
        const pong = await window.cadence.ping()
        const report: SmokeReport = { nodeReach, fonts, pong }
        window.cadence.reportSmoke(report)
      } catch {
        // The main-side watchdog fails the smoke if no report ever arrives.
      }
    }
    void runSmoke()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="app-shell">
      <div className="titlebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="timer" />
          </span>
          <span className="brand-name">Cadence</span>
        </div>
        {/* Window controls are visual only in Stage 1 — wired to the tray/window
            behavior in Phase 4 (minimize → hide, close → hide to tray). */}
        <div className="window-controls">
          <button type="button" aria-label="Minimize">
            <Icon name="remove" />
          </button>
          <button type="button" className="close" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
      </div>

      <div className="shell-body">
        <div className="shell-eyebrow">Shell ready</div>
        <h1 className="shell-headline">Cadence</h1>
        <p className="shell-sub">
          Parallel time tracker — Stage&nbsp;1 scaffold &amp; app shell. The 3a flyout UI lands in
          Phase&nbsp;3.
        </p>

        <dl className="shell-meta">
          <dt>Version</dt>
          <dd>{info?.version ?? '—'}</dd>
          <dt>Electron</dt>
          <dd>{info?.electron ?? '—'}</dd>
          <dt>Chromium</dt>
          <dd>{info?.chrome ?? '—'}</dd>
          <dt>Node</dt>
          <dd>{info?.node ?? '—'}</dd>
        </dl>

        <span className="shell-ok">
          <Icon name="shield" />
          Isolated renderer · typed IPC
        </span>
      </div>
    </div>
  )
}

export default App
