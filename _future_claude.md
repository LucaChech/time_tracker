# Handoff — for the next Claude session
*Written: 2026-07-01 11:20. Single rolling handoff — overwrites the prior one; reflects current state.*

## Overall goal (anchor)
Build **Cadence** — a Windows 11 system-tray time tracker whose differentiator is tracking multiple
tasks **in parallel**; ClickUp read-only, local-first, pixel-faithful to the `3a` flyout. Hands-off
**dogfood** build. (Charter: `CLAUDE.md`. Plan: `IMPLEMENTATION_PLAN.md`. Spine: `VERIFICATION_SPINE.md`.)

## ✅ Stage 4 (Tray & window behavior — the "flyout" feel) is DONE, reviewed (3-lens panel), all gates green, review fixes applied. Next stop: **Stage 5 — ClickUp READ integration (recommend split 5a/5b).**
Stage 4 gave the signed-off flyout its OS integration: a tray (tooltip = session total), click-to-toggle
positioned above the taskbar clamped to the work area, content-driven window sizing, minimize/close →
hide-to-tray (Quit only via tray), auto-pause on suspend/lock/quit, hide-on-blur with a dev/DevTools
exception, autostart (when packaged), and a single-instance show+reposition. Ended on the **automated
review-panel gate** (no human review) per the spine — this stage's human proof (autostart-after-reboot)
is rolled into the **Stage 6** human gate. Committed + pushed with this handoff.

## What this session accomplished
- **Pure, unit-tested window helpers** (electron-free, run under Vitest):
  - `src/main/window/position.ts` — `computeFlyoutPosition(win, tray, work, display)` +
    `inferTaskbarEdge` + `clamp`. Infers the taskbar edge from the work-area vs display-bounds gap,
    anchors the flyout to the tray along that edge, and **clamps the whole rect into the work area for
    all four edges** (not just bottom). Uses `screen.getPrimaryDisplay()` only (multi-monitor deferred).
  - `src/main/window/format.ts` — `formatDuration` (`Xh YYm`/`Mm`, **tolerant of 3-digit hours**, no
    truncation), `formatTrayTooltip(sessionWorkedMs, runningCount)` (uses the **union** `sessionWorkedMs`,
    never a per-task sum), `shouldHideOnBlur({isDev, devToolsFocused})`.
  - `src/main/window/position.test.ts` (10) + `format.test.ts` (10) — **20 new Vitest tests** (all 4
    taskbar edges, clamping, oversized window, unknown-tray fallback, 100h/999h tooltips, blur guard).
- **IPC contract** (`src/shared/ipc.ts`): added fire-and-forget window channels `minimizeWindow`/
  `closeWindow`/`resizeWindow` + `CadenceApi.minimize()`/`close()`/`resizeTo(panelHeight)`.
  Preload wrappers use `ipcRenderer.send` (`src/preload/index.ts`).
- **Main** (`src/main/index.ts`) — the big one:
  - **Tray**: icon from `resources/icon.png` (nativeImage→16px); tooltip = session total (union),
    refreshed on the 1s tick + every op + auto-pause; menu **Show/Hide + Quit**; left-click =
    `handleTrayClick` (with a **blur-race guard**, `TRAY_REOPEN_GUARD_MS=250`, so a click-to-close on
    Windows doesn't immediately re-open). Tray-creation failure **degrades safely** (un-skip taskbar +
    show — never a hidden, unquittable zombie).
  - **Window**: width **408** (`PANEL_WIDTH 380 + 2×FLYOUT_GUTTER 14`; gutter must match `.stage`
    padding in `flyout.css`). **Content-driven height**: renderer reports panel natural height →
    `applyPanelHeight` sizes the window (clamped to work area, then PAUSED scrolls) and re-anchors.
  - **Positioning**: `positionFlyout` (primary display work area + tray bounds → `computeFlyoutPosition`).
  - **Lifecycle**: `showFlyout`/`hideFlyout`/`toggleFlyout`; minimize/close IPC → `hideFlyout`
    (session alive); **Quit only via tray** → `app.quit`. **We deliberately do NOT veto the window
    `close` event** (vetoing would block/delay Windows shutdown/logout, since `before-quit` isn't
    emitted on Windows session-end) — Alt+F4/OS-close ends the session **gracefully** via
    window-all-closed → `app.quit` → `before-quit` → `engine.quit()`.
  - **Auto-pause**: `powerMonitor` `suspend`/`lock-screen` → `engine.stopAllRunning`; `before-quit` →
    `engine.quit()`. **Closes the two Stage-3b-deferred items** (graceful-quit accuracy + the
    `onMinimize`/`onClose` stubs).
  - **Hide-on-blur**: `handleBlur` gated by `shouldHideOnBlur({isDev: isDevMode, …})`. `isDevMode =
    is.dev && !HARNESS` — because `is.dev = !app.isPackaged` is TRUE when a harness runs the unpackaged
    build via `electron .`, so harnesses must be forced production-like.
  - **Single-instance**: lock acquired (skipped under harness); `second-instance` handler registered
    **unconditionally** → `showFlyout()` (or `pendingShow` if the window isn't built yet — startup race).
  - **Autostart**: `applyAutostart` → `setLoginItemSettings`; enabled in-app only `if (app.isPackaged)`.
- **Renderer** (`src/renderer/src/App.tsx`): wired `onMinimize→bridge.minimize()`,
  `onClose→bridge.close()`, passed to `Flyout`. Added a **content-driven autosize** effect (keyed on
  `ready = snapshot!==null`): a `ResizeObserver` on `.flyout`+`.content` + `fonts.ready` measures the
  panel's natural height (`chrome + content.scrollHeight`, clamp-invariant) and reports it via
  `resizeTo`, with a `≤1px` dedup. Browser fallback (no bridge) stays inert. **No business logic /
  re-summing** — measures DOM only (renderer stays a pure projection).
- **Stage-4 verify harness**: `CADENCE_TRAYTEST` branch in main + `scripts/tray-verify.mjs` +
  `npm run verify:tray`. Boots the built app on an **isolated** userData dir and drives the **REAL
  seams** — `tray.emit('click')`, `ipcMain.emit(closeWindow)`, `powerMonitor.emit('suspend')`,
  `win.emit('blur')`, `app.emit('second-instance')` — asserting hidden start, tray toggle within the
  work area, width=408, close→tray keeps the session, suspend auto-pause, blur-hide, second-instance
  show+reposition, autostart written (snapshot+restore so it never clobbers the real login item), and
  height-clamp. **13/13 PASS.**
- **Review-panel fixes applied** (3 adversarial lenses: positioning/lifecycle edge-cases ·
  integration-reality · spec-conformance): removed the shutdown-blocking close-veto; rewrote the tray
  harness to drive real event seams (was bypassing them via private helpers — a gate-honesty gap);
  tray-failure degradation; autostart snapshot/restore; gated `registerWindowIpc` behind `!SMOKE &&
  !IPCTEST` (autosize was reshaping the SMOKE screenshot); `pendingShow` for the second-instance
  startup race. Two findings **deferred with rationale** (see Open threads).

## Current state
- **Stage 4 complete, reviewed, all gates green, committed + pushed.** Working tree clean after commit.
- **All gates:** `npm run typecheck` clean · `npm run lint` clean · `npm test` **89 passed**
  (57 engine + 12 filter + 20 window) · `npm run build` clean · `npm run smoke` 5/5 ·
  `npm run verify:ipc` **12/12** · `npm run verify:tray` **13/13**.
- The app is now a real tray flyout: hidden by default, tray-driven reveal, content-fit, auto-pausing.
- Phase 0 GREEN. Next human gate is **Stage 6** (T2, clean-install + reboot — which also carries
  Stage-4's autostart-after-reboot proof). Stage 5 ends on the **automated** review-panel gate.

## Next actions (priority order) — Stage 5: ClickUp READ integration (Phase 5)
Read `IMPLEMENTATION_PLAN.md` **Phase 5** + `VERIFICATION_SPINE.md` **Stage 5** first. The spine
**recommends splitting 5a/5b** (one bounded session each): **5a** = auth + per-list traversal + mapping
→ real catalogue verified; **5b** = refresh/resilience/rate-limit/filters/connect-state.
1. **Re-confirm ClickUp v2 request/response shapes against CURRENT docs** (endpoints, params,
   pagination, `custom_id`, rate-limit headers) — third-party APIs drift; don't trust training memory.
2. **Auth & client** (`src/main/clickup.ts`): token from `.env.local` (dev); header
   `Authorization: <pk_token>` (**no `Bearer`**); base `https://api.clickup.com/api/v2`. `GET /user`
   also yields the **current user id** (needed for "Assigned to me").
3. **Per-list traversal**: `GET /user` → `GET /team` → per space `GET /space/{id}/folder` +
   `/space/{id}/list` → per list `GET /list/{id}/task?subtasks=true` (exclude closed/archived; paginate
   `page` to `last_page`, 100/page). **Dedupe by task id, first-breadcrumb-wins.**
4. **Map → `Task`**: `code = task.custom_id ?? null` (chip hidden when null — Free plan → null);
   `color` = **deterministic local palette hashed by list-id** (lists have no API color); carry
   **status + assigneeIds** through to the renderer for the filters. Call `engine.setCatalogue(tasks)`.
5. **Activate the filter**: attach `status`/`assigneeIds` to each catalogue row + thread the current-user
   id into `applyPausedFilter(rows, filter, currentUserId)` (already built + unit-tested in Stage 3b).
6. **Resilience**: show cached catalogue on launch then refresh; **refresh = metadata-only, never
   reorders/interrupts a running card**; throttle to the 100 req/min floor; on `429` honor
   `X-RateLimit-Reset`; no-token → "Connect ClickUp" prompt (not blank). Add an in-app token field
   (encrypted via **`safeStorage`** — the build's secret-at-rest boundary) from the tray menu.
7. **Secret hygiene (public repo, load-bearing)**: real `pk_` only in untracked `.env.local`; raw token
   never on disk/logs; run a secret sweep (working tree + git history) — this is a Stage-6 gate too.
8. **Stage 5 verification** = docs-check + `/verify` (scripted real fetch with the `.env.local` token →
   catalogue/breadcrumbs/dedupe/filters/429-backoff/blank-token-prompt) + review panel
   (integration/resilience + security). Ends on the **automated** gate → summary + "start a new
   session"; auto-`/future-claude` first.

## Open threads / do-not-relitigate (settled)
- **Stage-4 deferred, intentionally (flagged by the review panel, accepted):**
  1. **Multi-monitor positioning** — `positionFlyout` uses `screen.getPrimaryDisplay()`. If the whole
     taskbar/tray lives on a *secondary* monitor, the flyout opens on the primary. This is **explicitly
     deferred** in `IMPLEMENTATION_PLAN.md` ("multi-monitor positioning beyond clamping to the primary
     work area") — do NOT expand scope; leave as primary-display.
  2. **250ms tray-reopen guard** (`TRAY_REOPEN_GUARD_MS`) is timing-based: a blur-hide immediately
     followed (<250ms) by a tray click to re-open is suppressed and needs a second click. Deliberate
     tradeoff for correct click-to-close; acceptable for a flyout. Not a bug.
- **Behavior change to a signed-off harness path (accepted):** under `CADENCE_IPCTEST` the window now
  launches **hidden** (previously `is.dev` showed it). Harmless — `verify:ipc` drives via
  `executeJavaScript` regardless of visibility; still **12/12**. This is more faithful to shipped
  behavior. Don't misread it as a regression.
- **Alt+F4 / OS-close ends the session (accepted).** The `close` event is intentionally **not vetoed**
  (see main index.ts comment) so Windows shutdown/logout is never blocked. The spec's "close (×) → hide
  to tray" is satisfied by the **× control's IPC path** (`closeWindow → hideFlyout`), which is what the
  harness now tests. "Quit only via tray" holds for the UI; Alt+F4 is an OS force-close that quits
  gracefully.
- Still holding from earlier stages: local event log = source of truth + **no ClickUp push in v0**
  (grep-verified none this stage); per-task elapsed = union; tray tooltip = union (never a per-task
  sum); `pausedCount` never shrinks under the filter; `sessionWorkedMs` in ms; self-hosted fonts;
  `sandbox:true`; `*.md` in `.prettierignore`; do NOT re-litigate the `3a` look (Luca signed it off, T3).
- **Carry-forwards (not bugs):** `glyph` carried but not rendered; `initialPanel` launch-time-only; the
  renderer receives a full snapshot each push and never re-sums/re-sorts.

## Pointers
- **Build root must be local** (laptop C:), not `G:\Other computers\…`. Commands: `npm run dev`
  (electron-vite dev; renderer also at `http://localhost:5173/` in a browser → **fixture fallback**, no
  live engine) · `npm test` (89) · `npm run typecheck` · `npm run lint` · `npm run build` ·
  `npm run smoke` · `npm run verify:ipc` · **`npm run verify:tray`** (Stage-4 real-seam drive).
- **Stage-4 code**: `src/main/index.ts` (tray/positioning/sizing/lifecycle/auto-pause/blur/autostart/
  single-instance + the `CADENCE_TRAYTEST` harness branch) · `src/main/window/position.ts` +
  `format.ts` (pure, unit-tested) · `src/renderer/src/App.tsx` (window controls + autosize) ·
  `scripts/tray-verify.mjs`.
- **IPC contract** `src/shared/ipc.ts` (channels + `CadenceApi`; now includes the window surface).
  **Data model** `src/shared/types.ts` (`StateSnapshot` carries `derivedAt`; `sessionWorkedMs` = union).
- **The engine** (`src/main/engine/`) is pure + injected (`EngineDeps = { dir, now }`). Ops:
  `start`/`stop`/`toggle`/`addManualTask`/`removeFromList`/`setCatalogue` (**Phase 5 entry point**)/
  `quit`/`stopAllRunning`/`heartbeat` (Phase 6) + `hasRunning()`/`hasTask(id)`.
- **The 3a UI** lives in `src/renderer/src/flyout/`. `Flyout` is a pure render of a `StateSnapshot`;
  `applyPausedFilter` (pure, unit-tested) is ready — Phase 5 supplies `status`/`assigneeIds`/currentUserId.
- **Verify harnesses**: all mirror the same spawn→result-JSON→exit-code pattern with a `CADENCE_*` env
  branch in `src/main/index.ts` and an isolated userData dir: `scripts/smoke.mjs` (CADENCE_SMOKE),
  `scripts/ipc-verify.mjs` (CADENCE_IPCTEST), `scripts/tray-verify.mjs` (CADENCE_TRAYTEST).
- Plan: `IMPLEMENTATION_PLAN.md` (**Phase 5** next) · Spine: `VERIFICATION_SPINE.md` (**Stage 5**, soft
  automated gate, recommend split 5a/5b) · Charter: `CLAUDE.md`. Doctrine: no human review of routine
  diffs; mandatory autonomous review panel after every non-trivial phase; human gates only at T1/T2/T3
  (next is Stage 6 — T2); one phase = one bounded session; auto-`/future-claude` before every handoff.
- GitHub: `https://github.com/LucaChech/time_tracker` (PUBLIC, `main`, `origin`). gh authed as
  `LucaChech`. Secret hygiene load-bearing: real `pk_` token only in untracked `.env.local`.
- ClickUp (Stage 5): base `https://api.clickup.com/api/v2`; header `Authorization: <pk_token>`
  (**no `Bearer`**); workspace id `90121836206`; Free plan → `custom_id` null, lists have no API color.
