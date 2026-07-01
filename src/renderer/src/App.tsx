import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { CadenceApi, SmokeReport } from '@shared/ipc'
import type { StateSnapshot } from '@shared/types'
import { Flyout } from './flyout/Flyout'
import type { ManualDraft } from './flyout/Composer'
import { getScenario } from './flyout/fixtures'

/**
 * The typed IPC bridge, or `undefined` when running outside Electron — a plain
 * browser tab (the dev server used for static 3a captures) has no preload, so
 * `window.cadence` is genuinely absent there. The global type declares it always
 * present for the normal Electron runtime, so we read it through this accessor to
 * handle the browser-only absence honestly, without weakening the type everywhere.
 */
function bridge(): CadenceApi | undefined {
  return (window as { cadence?: CadenceApi }).cadence
}

const REQUIRED_FONTS = ['Space Grotesk', 'Work Sans', 'Material Symbols Outlined']
// If contextIsolation/nodeIntegration/sandbox hold, every one of these is undefined
// in the renderer. The Stage-1 smoke harness asserts exactly that.
const NODE_GLOBALS = ['require', 'process', 'module', 'global', 'Buffer', '__dirname']

// `?panel=` pre-opens an inset panel so a capture can show the composer/filter.
// `?scenario=` only applies to the browser fallback (see below).
function readParams(): { scenario: string | null; panel: 'composer' | 'filter' | undefined } {
  const q = new URLSearchParams(window.location.search)
  const panel = q.get('panel')
  return {
    scenario: q.get('scenario'),
    panel: panel === 'composer' || panel === 'filter' ? panel : undefined
  }
}

/**
 * Stage 3b: the flyout is now a live projection of the engine's state.
 *
 * On mount the renderer fetches the current snapshot and subscribes to main's
 * pushes (the 1s tick), then drives operations through the typed bridge — it
 * holds no timing/union/sort logic of its own. When the bridge is absent (a
 * plain browser tab, e.g. the dev server used for the 3a captures) it falls back
 * to a static fixture so the UI still renders outside Electron.
 */
function App(): JSX.Element {
  const params = readParams()

  // Live under Electron (resolved by the effect below); a static fixture in a
  // plain browser tab. Deciding the fallback in the initializer — not the effect
  // — keeps the effect free of a synchronous setState.
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(() =>
    bridge() ? null : getScenario(params.scenario)
  )

  // Snapshots are monotonic in `derivedAt`; drop any that is older than the last
  // one applied, so a slow operation reply resolving after a newer tick push can
  // never roll the displayed timers backward.
  const lastDerivedAt = useRef(-1)
  const applySnapshot = useCallback((s: StateSnapshot) => {
    if (s.derivedAt < lastDerivedAt.current) return
    lastDerivedAt.current = s.derivedAt
    setSnapshot(s)
  }, [])
  const onOpError = useCallback((err: unknown) => {
    console.error('[cadence] IPC operation failed', err)
  }, [])

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

  // Live state: initial fetch + subscribe to pushed updates. With no bridge
  // (browser render outside Electron) the fixture set in the initializer stands.
  useEffect(() => {
    const api = bridge()
    if (!api) return
    let alive = true
    api
      .getState()
      .then((s) => {
        if (alive) applySnapshot(s)
      })
      .catch(onOpError)
    const unsubscribe = api.onStateUpdate(applySnapshot)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [applySnapshot, onOpError])

  // Content-driven window sizing (Phase 4): report the panel's natural height to
  // main, which sizes the transparent window to fit and clamps to the work area
  // (beyond which the PAUSED list scrolls internally). Set up once the flyout is
  // in the DOM; a ResizeObserver on the panel + content picks up every later
  // height change (rows added/removed, composer/filter opened, fonts loaded). A
  // plain browser tab has no `resizeTo`, so this is inert there.
  const ready = snapshot !== null
  useEffect(() => {
    const api = bridge()
    if (!api?.resizeTo || !ready) return

    let raf = 0
    let lastReported = -1
    const measure = (): void => {
      const flyout = document.querySelector<HTMLElement>('.flyout')
      const content = document.querySelector<HTMLElement>('.content')
      if (!flyout || !content) return
      // Chrome (titlebar + footer + borders) is clamp-invariant; content.scrollHeight
      // is the full natural content height even while the list is scrolling — so
      // this reports the height the panel WANTS, and main clamps it.
      const chrome = flyout.offsetHeight - content.offsetHeight
      const natural = chrome + content.scrollHeight
      if (Math.abs(natural - lastReported) <= 1) return // dedup: avoid a resize/report loop
      lastReported = natural
      api.resizeTo(natural)
    }
    // Coalesce bursts of observer callbacks into one measure per frame.
    const schedule = (): void => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }

    const ro = new ResizeObserver(schedule)
    const flyout = document.querySelector('.flyout')
    const content = document.querySelector('.content')
    if (flyout) ro.observe(flyout)
    if (content) ro.observe(content)
    document.fonts?.ready.then(schedule).catch(() => {})

    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [ready])

  // Operation handlers — each drives the engine over IPC and adopts the fresh
  // snapshot it returns (main also pushes on the tick; applySnapshot keeps the
  // newest). No-op without the bridge, so a click in the static fallback is inert.
  const onPlay = useCallback(
    (id: string) => {
      void bridge()?.start(id)?.then(applySnapshot).catch(onOpError)
    },
    [applySnapshot, onOpError]
  )
  const onPause = useCallback(
    (id: string) => {
      void bridge()?.stop(id)?.then(applySnapshot).catch(onOpError)
    },
    [applySnapshot, onOpError]
  )
  const onRemove = useCallback(
    (id: string) => {
      void bridge()?.removeFromList(id)?.then(applySnapshot).catch(onOpError)
    },
    [applySnapshot, onOpError]
  )
  const onAddManual = useCallback(
    (draft: ManualDraft) => {
      void bridge()?.addManualTask(draft)?.then(applySnapshot).catch(onOpError)
    },
    [applySnapshot, onOpError]
  )
  // Window controls (Phase 4): both hide the flyout to the tray — the session
  // stays alive; only the tray's Quit ends it. No-op in the browser fallback.
  const onMinimize = useCallback(() => {
    bridge()?.minimize()
  }, [])
  const onClose = useCallback(() => {
    bridge()?.close()
  }, [])

  // Nothing to render until the first snapshot arrives (a single frame; the
  // window is hidden until ready-to-show in production).
  if (!snapshot) return <div className="stage" />

  return (
    <Flyout
      snapshot={snapshot}
      initialPanel={params.panel ?? 'none'}
      onPlay={onPlay}
      onPause={onPause}
      onRemove={onRemove}
      onAddManual={onAddManual}
      onMinimize={onMinimize}
      onClose={onClose}
    />
  )
}

export default App
