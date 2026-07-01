import { useEffect, type JSX } from 'react'
import type { SmokeReport } from '@shared/ipc'
import { Flyout } from './flyout/Flyout'
import { getScenario } from './flyout/fixtures'

const REQUIRED_FONTS = ['Space Grotesk', 'Work Sans', 'Material Symbols Outlined']
// If contextIsolation/nodeIntegration/sandbox hold, every one of these is undefined
// in the renderer. The Stage-1 smoke harness asserts exactly that.
const NODE_GLOBALS = ['require', 'process', 'module', 'global', 'Buffer', '__dirname']

// Stage 3a is the static, pixel-faithful 3a panel BEFORE it is wired to the state
// engine (that is Stage 3b). It renders a fixture StateSnapshot; `?scenario=` picks
// which (populated | empty | long) and `?panel=` pre-opens an inset panel, so the
// verification harness can capture every state deterministically.
function readParams(): { scenario: string | null; panel: 'composer' | 'filter' | undefined } {
  const q = new URLSearchParams(window.location.search)
  const panel = q.get('panel')
  return {
    scenario: q.get('scenario'),
    panel: panel === 'composer' || panel === 'filter' ? panel : undefined
  }
}

function App(): JSX.Element {
  // Stage-1 smoke self-check, carried forward unchanged. A harmless no-op in normal
  // runs (main only listens when CADENCE_SMOKE=1); under the harness it still proves
  // the security posture + self-hosted fonts that the 3a UI now depends on.
  useEffect(() => {
    let alive = true
    async function runSmoke(): Promise<void> {
      try {
        await document.fonts.ready
        if (!alive) return
        const w = globalThis as unknown as Record<string, unknown>
        const nodeReach: Record<string, string> = {}
        for (const g of NODE_GLOBALS) nodeReach[g] = typeof w[g]
        // load() forces the fetch from the local bundle so check() reports true even
        // for a weight the UI never renders — proving the fonts are self-hosted.
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

  const { scenario, panel } = readParams()
  return <Flyout snapshot={getScenario(scenario)} initialPanel={panel ?? 'none'} />
}

export default App
